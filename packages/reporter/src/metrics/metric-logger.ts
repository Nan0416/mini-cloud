import {
  EMF_LIMITS,
  EmfDocument,
  EmfMetricDefinition,
  LoggerFactory,
  MetricDimensions,
  MetricUnit,
  REPORTER_ENV,
  StorageResolution,
  isWithinDocumentSize,
  validateEmfDocument,
} from '@mini-cloud/shared';
import os from 'node:os';
import path from 'node:path';
import { ConsoleSink, MetricSink, SpoolSink } from './metric-sink';

const logger = LoggerFactory.getLogger('MetricLogger');

const DEFAULT_NAMESPACE = 'MiniCloud';

export interface MetricLoggerProps {
  readonly sink: MetricSink;
  readonly namespace?: string;
  /** Applied to every flush unless `setDimensions`/`resetDimensions` removes them. */
  readonly defaultDimensions?: MetricDimensions;
  /** Context attached to every document, such as the instance that produced it. */
  readonly defaultProperties?: Record<string, unknown>;
}

interface PendingMetric {
  readonly values: number[];
  readonly unit?: MetricUnit;
  readonly storageResolution?: StorageResolution;
}

/**
 * Records metrics in the AWS embedded metric format.
 *
 * The method names and their semantics are deliberately those of the
 * `aws-embedded-metrics` package, so that moving to the real library later is a
 * change of import rather than a change of instrumentation. What differs is the rule
 * this package lives by, the same one `TaskReporter` states: **no method ever
 * throws**. Upstream rejects a bad metric with `InvalidMetricError`; here it is
 * dropped with a warning naming the reason, because a metrics library that can kill
 * the program it measures is worse than no metrics at all.
 */
export class MetricLogger {
  private readonly sink: MetricSink;
  private readonly defaultDimensions: MetricDimensions;
  private readonly defaultProperties: Record<string, unknown>;

  private namespace: string;
  private dimensionSets: MetricDimensions[] = [];
  private useDefaultDimensions = true;
  private properties: Record<string, unknown> = {};
  private metrics = new Map<string, PendingMetric>();
  private timestamp?: number;

  /** Whether custom dimensions survive a flush. Matches the upstream field. */
  flushPreserveDimensions = true;

  /** Serialises writes, so an auto-flush cannot interleave with an explicit one. */
  private pending: Promise<void> = Promise.resolve();

  constructor(props: MetricLoggerProps) {
    this.sink = props.sink;
    this.namespace = props.namespace ?? DEFAULT_NAMESPACE;
    this.defaultDimensions = props.defaultDimensions ?? {};
    this.defaultProperties = props.defaultProperties ?? {};
  }

  /**
   * Builds a logger from the environment the agent injected, or returns undefined
   * when the program was not started by mini-cloud — so it is safe to call
   * unconditionally in a program you also run by hand.
   */
  static fromEnvironment(namespace?: string): MetricLogger | undefined {
    const spoolDir = process.env[REPORTER_ENV.metricsSpoolDir];
    const instanceId = process.env[REPORTER_ENV.instanceId];
    if (typeof spoolDir !== 'string' || spoolDir.length === 0) {
      logger.debug('Not running under a mini-cloud agent; metrics are disabled.');
      return undefined;
    }

    // The identifiers are high-cardinality, so they travel as properties rather than
    // dimensions: a dimension value creates a series, and one per instance would
    // create a new series on every launch.
    const defaultProperties: Record<string, unknown> = {};
    for (const key of ['instanceId', 'taskId', 'agentId'] as const) {
      const value = process.env[REPORTER_ENV[key]];
      if (typeof value === 'string' && value.length > 0) {
        defaultProperties[key] = value;
      }
    }

    return new MetricLogger({
      sink: new SpoolSink({ spoolDir, writerId: instanceId ?? String(process.pid) }),
      namespace,
      defaultProperties,
    });
  }

  /** A logger that prints to stdout, for a program running outside mini-cloud. */
  static toConsole(namespace?: string): MetricLogger {
    return new MetricLogger({ sink: new ConsoleSink(), namespace });
  }

  setNamespace(namespace: string): void {
    if (namespace.length === 0 || namespace.length > EMF_LIMITS.namespaceLength) {
      logger.warn(`Ignoring a namespace of ${namespace.length} characters; it must be 1 to ${EMF_LIMITS.namespaceLength}.`);
      return;
    }
    this.namespace = namespace;
  }

  setTimestamp(timestamp: Date | number): void {
    this.timestamp = timestamp instanceof Date ? timestamp.getTime() : timestamp;
  }

  /**
   * Adds a metric value. Repeated calls for one name accumulate into an array, and
   * reaching the format's limit of 100 values flushes rather than dropping any.
   */
  putMetric(name: string, value: number, unit?: MetricUnit, storageResolution?: StorageResolution): void {
    if (name.length === 0 || name.length > EMF_LIMITS.metricNameLength) {
      logger.warn(`Ignoring a metric name of ${name.length} characters; it must be 1 to ${EMF_LIMITS.metricNameLength}.`);
      return;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      logger.warn(`Ignoring metric ${name}: ${String(value)} is not a finite number, and CloudWatch would reject it.`);
      return;
    }

    const existing = this.metrics.get(name);
    if (existing === undefined) {
      this.metrics.set(name, { values: [value], unit, storageResolution });
    } else {
      if (unit !== undefined && existing.unit !== undefined && unit !== existing.unit) {
        logger.warn(`Metric ${name} was recorded as ${existing.unit} and then as ${unit}; keeping ${existing.unit} for this flush.`);
      }
      existing.values.push(value);
      if (existing.values.length >= EMF_LIMITS.valuesPerMetric) {
        void this.flush();
      }
    }
  }

  /**
   * Adds a dimension set. Every distinct set becomes a separate series.
   *
   * A set already present is not added again. Custom dimensions survive a flush, so
   * calling this once per iteration of a loop — the obvious way to write it — would
   * otherwise grow the document without bound and publish the same series many times.
   */
  putDimensions(dimensions: MetricDimensions): void {
    if (!this.validDimensions(dimensions)) {
      return;
    }
    const identity = identify(dimensions);
    if (this.dimensionSets.some((existing) => identify(existing) === identity)) {
      return;
    }
    this.dimensionSets.push(dimensions);
  }

  /** Replaces every custom dimension set, dropping the defaults unless asked to keep them. */
  setDimensions(dimensions: MetricDimensions | ReadonlyArray<MetricDimensions>, useDefault: boolean = false): void {
    const sets = Array.isArray(dimensions) ? dimensions : [dimensions];
    const accepted = sets.filter((set) => this.validDimensions(set));
    this.dimensionSets = accepted;
    this.useDefaultDimensions = useDefault;
  }

  resetDimensions(useDefault: boolean): void {
    this.dimensionSets = [];
    this.useDefaultDimensions = useDefault;
  }

  /**
   * Attaches context that is searchable but is not part of a metric's identity.
   *
   * Use this rather than a dimension for anything high-cardinality — a request id, an
   * instance id — because every distinct dimension value creates another series.
   */
  setProperty(key: string, value: unknown): void {
    this.properties[key] = value;
  }

  /**
   * Writes everything recorded so far and starts a new context.
   *
   * The namespace, the default dimensions and an explicitly set timestamp survive;
   * metrics and properties do not, and custom dimensions do unless
   * `flushPreserveDimensions` is false.
   */
  async flush(): Promise<void> {
    const document = this.build();
    this.reset();
    if (document === undefined) {
      return;
    }

    this.pending = this.pending.then(() => this.sink.write(document));
    await this.pending;
  }

  private validDimensions(dimensions: MetricDimensions): boolean {
    const names = Object.keys(dimensions);
    if (names.length > EMF_LIMITS.dimensionsPerSet) {
      logger.warn(`Ignoring a dimension set with ${names.length} keys; the format allows ${EMF_LIMITS.dimensionsPerSet}.`);
      return false;
    }
    for (const name of names) {
      if (name.length === 0 || name.length > EMF_LIMITS.dimensionNameLength) {
        logger.warn(`Ignoring a dimension set: name "${name}" must be 1 to ${EMF_LIMITS.dimensionNameLength} characters.`);
        return false;
      }
      const value = dimensions[name];
      if (typeof value !== 'string' || value.length > EMF_LIMITS.dimensionValueLength) {
        logger.warn(`Ignoring a dimension set: ${name} must be a string of at most ${EMF_LIMITS.dimensionValueLength} characters.`);
        return false;
      }
    }
    return true;
  }

  /** The sets to publish. One empty set is still a series, and the format requires at least one. */
  private resolveDimensionSets(): ReadonlyArray<MetricDimensions> {
    const base = this.useDefaultDimensions ? this.defaultDimensions : {};
    if (this.dimensionSets.length === 0) {
      return [base];
    }
    return this.dimensionSets.map((set) => ({ ...base, ...set }));
  }

  private build(): EmfDocument | undefined {
    if (this.metrics.size === 0) {
      return undefined;
    }

    const sets = this.resolveDimensionSets();
    const definitions: EmfMetricDefinition[] = [];
    const root: Record<string, unknown> = { ...this.defaultProperties, ...this.properties };

    for (const set of sets) {
      for (const [name, value] of Object.entries(set)) {
        root[name] = value;
      }
    }

    for (const [name, metric] of this.metrics) {
      if (root[name] !== undefined) {
        // A metric and a dimension or property sharing a name would need the same
        // root member to be a number and a string at once.
        logger.warn(`Dropping metric ${name}: a dimension or property already uses that name on the root node.`);
        continue;
      }
      definitions.push({ Name: name, Unit: metric.unit, StorageResolution: metric.storageResolution });
      root[name] = metric.values.length === 1 ? metric.values[0] : metric.values;
    }

    if (definitions.length === 0) {
      return undefined;
    }

    const document: EmfDocument = {
      ...root,
      _aws: {
        Timestamp: this.timestamp ?? Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: this.namespace,
            Dimensions: sets.map((set) => Object.keys(set)),
            Metrics: definitions,
          },
        ],
      },
    };

    const validation = validateEmfDocument(document);
    if (!validation.valid) {
      logger.warn(`Dropping a metric document: ${validation.reason}`);
      return undefined;
    }
    if (!isWithinDocumentSize(JSON.stringify(document))) {
      logger.warn('Dropping a metric document: it exceeds the 1 MB a log event may occupy.');
      return undefined;
    }

    return document;
  }

  private reset(): void {
    this.metrics = new Map();
    this.properties = {};
    if (!this.flushPreserveDimensions) {
      this.dimensionSets = [];
    }
  }
}

/**
 * Runs `handler` with a logger and flushes it afterwards, even if the handler throws.
 *
 * The same shape as the upstream decorator, so instrumentation written against
 * `aws-embedded-metrics` moves across unchanged.
 */
export function metricScope<T, A extends unknown[]>(handler: (metrics: MetricLogger) => (...args: A) => Promise<T>, logger_?: MetricLogger): (...args: A) => Promise<T> {
  return async (...args: A): Promise<T> => {
    const metrics = logger_ ?? MetricLogger.fromEnvironment() ?? MetricLogger.toConsole();
    try {
      return await handler(metrics)(...args);
    } finally {
      await metrics.flush();
    }
  };
}

/** Two sets are the same series when they carry the same names and values. */
function identify(dimensions: MetricDimensions): string {
  return JSON.stringify(Object.entries(dimensions).sort((left, right) => (left[0] < right[0] ? -1 : 1)));
}

/** Where a spool lives when nothing configures one. */
export function defaultSpoolDir(): string {
  return path.join(os.homedir(), '.mini-cloud', 'metrics');
}
