import { EMF_LIMITS, EmfDocument, EmfMetricDefinition, EmfMetricDirective, METRIC_UNITS, MetricDimensions, MetricUnit, STORAGE_RESOLUTIONS } from '../models/metric';

/**
 * Reading and checking embedded-metric-format documents.
 *
 * Everything here is pure and total: `validateEmfDocument` reports a reason rather
 * than throwing, because its callers are a metrics logger that must never be able to
 * kill the program it measures, and an ingest path that must not let one malformed
 * document discard a machine's whole minute.
 */

export type EmfValidationResult = { readonly valid: true } | { readonly valid: false; readonly reason: string };

/** One metric, one dimension set, resolved out of a document's indirection. */
export interface MetricObservation {
  readonly namespace: string;
  readonly metricName: string;
  readonly dimensions: MetricDimensions;
  readonly unit: MetricUnit;
  readonly timestamp: number;
  readonly values: ReadonlyArray<number>;
}

const VALID = { valid: true } as const;

function invalid(reason: string): EmfValidationResult {
  return { valid: false, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isMetricUnit(value: unknown): value is MetricUnit {
  return typeof value === 'string' && METRIC_UNITS.some((unit) => unit === value);
}

/**
 * A metric target is a number or an array of numbers. CloudWatch rejects NaN and the
 * infinities outright, so they are not a value we can usefully round-trip.
 */
function readMetricValues(target: unknown): ReadonlyArray<number> | undefined {
  if (isFiniteNumber(target)) {
    return [target];
  }
  if (!Array.isArray(target) || target.length === 0) {
    return undefined;
  }
  const values: number[] = [];
  for (const entry of target) {
    if (!isFiniteNumber(entry)) {
      return undefined;
    }
    values.push(entry);
  }
  return values;
}

function validateDefinition(definition: unknown, root: Record<string, unknown>): EmfValidationResult {
  if (!isRecord(definition)) {
    return invalid('_aws.CloudWatchMetrics[].Metrics[] must be an object');
  }
  const name = definition['Name'];
  if (typeof name !== 'string' || name.length === 0 || name.length > EMF_LIMITS.metricNameLength) {
    return invalid(`metric Name must be a string of 1 to ${EMF_LIMITS.metricNameLength} characters`);
  }
  if (definition['Unit'] !== undefined && !isMetricUnit(definition['Unit'])) {
    return invalid(`metric ${name} has unit ${String(definition['Unit'])}, which is not a CloudWatch unit`);
  }
  const resolution = definition['StorageResolution'];
  if (resolution !== undefined && !STORAGE_RESOLUTIONS.some((allowed) => allowed === resolution)) {
    return invalid(`metric ${name} has StorageResolution ${String(resolution)}, which must be 1 or 60`);
  }

  const values = readMetricValues(root[name]);
  if (values === undefined) {
    return invalid(`metric ${name} has no finite numeric value on the root node`);
  }
  if (values.length > EMF_LIMITS.valuesPerMetric) {
    return invalid(`metric ${name} has ${values.length} values, more than the ${EMF_LIMITS.valuesPerMetric} the format allows`);
  }
  return VALID;
}

function validateDimensionSet(set: unknown, root: Record<string, unknown>): EmfValidationResult {
  if (!Array.isArray(set)) {
    return invalid('_aws.CloudWatchMetrics[].Dimensions[] must be an array of dimension names');
  }
  if (set.length > EMF_LIMITS.dimensionsPerSet) {
    return invalid(`a dimension set has ${set.length} keys, more than the ${EMF_LIMITS.dimensionsPerSet} the format allows`);
  }
  for (const name of set) {
    if (typeof name !== 'string' || name.length === 0 || name.length > EMF_LIMITS.dimensionNameLength) {
      return invalid(`a dimension name must be a string of 1 to ${EMF_LIMITS.dimensionNameLength} characters`);
    }
    const value = root[name];
    if (typeof value !== 'string') {
      return invalid(`dimension ${name} has no string value on the root node`);
    }
    if (value.length > EMF_LIMITS.dimensionValueLength) {
      return invalid(`dimension ${name} has a value longer than ${EMF_LIMITS.dimensionValueLength} characters`);
    }
  }
  return VALID;
}

function validateDirective(directive: unknown, root: Record<string, unknown>): EmfValidationResult {
  if (!isRecord(directive)) {
    return invalid('_aws.CloudWatchMetrics[] must be an object');
  }

  const namespace = directive['Namespace'];
  if (typeof namespace !== 'string' || namespace.length === 0 || namespace.length > EMF_LIMITS.namespaceLength) {
    return invalid(`Namespace must be a string of 1 to ${EMF_LIMITS.namespaceLength} characters`);
  }

  const dimensions = directive['Dimensions'];
  if (!Array.isArray(dimensions) || dimensions.length === 0) {
    return invalid('Dimensions must be a non-empty array of dimension sets');
  }
  for (const set of dimensions) {
    const result = validateDimensionSet(set, root);
    if (!result.valid) {
      return result;
    }
  }

  const metrics = directive['Metrics'];
  if (!Array.isArray(metrics)) {
    return invalid('Metrics must be an array');
  }
  if (metrics.length > EMF_LIMITS.metricDefinitionsPerDirective) {
    return invalid(`a directive defines ${metrics.length} metrics, more than the ${EMF_LIMITS.metricDefinitionsPerDirective} the format allows`);
  }
  for (const definition of metrics) {
    const result = validateDefinition(definition, root);
    if (!result.valid) {
      return result;
    }
  }

  return VALID;
}

/** Checks a value against the specification, including every documented limit. */
export function validateEmfDocument(document: unknown): EmfValidationResult {
  if (!isRecord(document)) {
    return invalid('an EMF document must be a JSON object');
  }

  const metadata = document['_aws'];
  if (!isRecord(metadata)) {
    return invalid('_aws is required and must be an object');
  }
  if (!isFiniteNumber(metadata['Timestamp'])) {
    return invalid('_aws.Timestamp is required and must be milliseconds since the epoch');
  }

  const directives = metadata['CloudWatchMetrics'];
  if (!Array.isArray(directives) || directives.length === 0) {
    return invalid('_aws.CloudWatchMetrics is required and must be a non-empty array');
  }
  for (const directive of directives) {
    const result = validateDirective(directive, document);
    if (!result.valid) {
      return result;
    }
  }

  return VALID;
}

/** Narrows a parsed JSON value to a document. Use it before `expandEmfDocument`. */
export function isEmfDocument(value: unknown): value is EmfDocument {
  return validateEmfDocument(value).valid;
}

/**
 * Whether a document is within the 1 MB a CloudWatch Logs event may occupy.
 *
 * `TextEncoder` rather than `Buffer`, because `shared` is bundled into the browser.
 */
export function isWithinDocumentSize(serialized: string): boolean {
  return new TextEncoder().encode(serialized).length <= EMF_LIMITS.documentBytes;
}

function readDirectives(document: EmfDocument): ReadonlyArray<EmfMetricDirective> {
  return document._aws.CloudWatchMetrics;
}

function readDimensions(document: EmfDocument, names: ReadonlyArray<string>): MetricDimensions | undefined {
  const dimensions: Record<string, string> = {};
  for (const name of names) {
    const value = document[name];
    if (typeof value !== 'string') {
      return undefined;
    }
    dimensions[name] = value;
  }
  return dimensions;
}

function readDefinition(document: EmfDocument, definition: EmfMetricDefinition): ReadonlyArray<number> | undefined {
  return readMetricValues(document[definition.Name]);
}

/**
 * Flattens a document into one observation per metric per dimension set.
 *
 * This is the only place that understands the format's indirection — the metadata
 * naming root members that hold the actual numbers and strings — so everything
 * downstream works with plain observations.
 *
 * Call `validateEmfDocument` first. Anything that does not resolve is skipped rather
 * than reported, so a partially broken document still yields the metrics it got right.
 */
export function expandEmfDocument(document: EmfDocument): ReadonlyArray<MetricObservation> {
  const timestamp = document._aws.Timestamp;
  const observations: MetricObservation[] = [];

  for (const directive of readDirectives(document)) {
    for (const definition of directive.Metrics) {
      const values = readDefinition(document, definition);
      if (values === undefined) {
        continue;
      }
      // Each *distinct* dimension set is one series, so a set repeated within a
      // directive is still one observation. Counting it twice would multiply a
      // metric by however many times its set was declared.
      const seen = new Set<string>();
      for (const names of directive.Dimensions) {
        const dimensions = readDimensions(document, names);
        if (dimensions === undefined) {
          continue;
        }
        const identity = Object.keys(dimensions).sort().join('\u001f');
        if (seen.has(identity)) {
          continue;
        }
        seen.add(identity);
        observations.push({
          namespace: directive.Namespace,
          metricName: definition.Name,
          dimensions,
          unit: definition.Unit ?? 'None',
          timestamp,
          values,
        });
      }
    }
  }

  return observations;
}
