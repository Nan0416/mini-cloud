import { Dimension, Dimensions, MetricItem, Metrics, MetricsLogger } from '../../models';
import jsonStringify from 'json-stable-stringify';
import { convertDimensionsToDimensionArray, deduplicateDimensions } from './utilities';

export class MetricsImpl implements Metrics {
  readonly metricsLogger: MetricsLogger;
  readonly dimensions?: ReadonlyArray<Dimension>;

  constructor(metricsLogger: MetricsLogger, dimensions?: Dimensions | ReadonlyArray<Dimension>) {
    this.metricsLogger = metricsLogger;
    if (dimensions) {
      if (Array.isArray(dimensions)) {
        this.dimensions = Array.from(dimensions);
      } else {
        this.dimensions = convertDimensionsToDimensionArray(dimensions);
      }
    } else {
      this.dimensions = undefined;
    }
  }

  async close(): Promise<void> {}

  time(name: string, value: number, dimensions?: Dimensions | ReadonlyArray<Dimension>): void {
    const item: MetricItem = {
      namespace: this.metricsLogger.namespace,
      dimensions: this.mergeDimensions(dimensions),
      name,
      value,
      unit: 'ms',
      timestamp: Date.now(),
    };
    this.metricsLogger.reporter(jsonStringify(item));
  }

  timer<T>(func: () => T, name: string, dimensions?: Dimensions | ReadonlyArray<Dimension>): T {
    const startTimestamp = Date.now();
    const result = func();
    const item: MetricItem = {
      namespace: this.metricsLogger.namespace,
      dimensions: this.mergeDimensions(dimensions),
      name,
      value: Date.now() - startTimestamp,
      unit: 'ms',
      timestamp: Date.now(),
    };
    this.metricsLogger.reporter(jsonStringify(item));
    return result;
  }

  async asyncTimer<T>(func: () => Promise<T>, name: string, dimensions?: Dimensions | ReadonlyArray<Dimension>): Promise<T> {
    const startTimestamp = Date.now();
    const result = await func();
    const item: MetricItem = {
      namespace: this.metricsLogger.namespace,
      dimensions: this.mergeDimensions(dimensions),
      name,
      value: Date.now() - startTimestamp,
      unit: 'ms',
      timestamp: Date.now(),
    };
    this.metricsLogger.reporter(jsonStringify(item));
    return result;
  }

  count(name: string, value: number, dimensions?: Dimensions | ReadonlyArray<Dimension>): void {
    const item: MetricItem = {
      namespace: this.metricsLogger.namespace,
      dimensions: this.mergeDimensions(dimensions),
      name,
      value,
      unit: 'count',
      timestamp: Date.now(),
    };
    this.metricsLogger.reporter(jsonStringify(item));
  }

  incrementCounter(name: string, dimensions?: Dimensions | ReadonlyArray<Dimension>): void {
    const item: MetricItem = {
      namespace: this.metricsLogger.namespace,
      dimensions: this.mergeDimensions(dimensions),
      name,
      value: 1,
      unit: 'count',
      timestamp: Date.now(),
    };
    this.metricsLogger.reporter(jsonStringify(item));
  }

  async asyncCall<T>(func: () => Promise<T>, name: string, dimensions?: Dimensions | ReadonlyArray<Dimension>): Promise<T> {
    const startTimestamp = Date.now();

    const item: MetricItem = {
      namespace: this.metricsLogger.namespace,
      dimensions: this.mergeDimensions(dimensions),
      name: `${name}.Count`,
      value: 1,
      unit: 'count',
      timestamp: Date.now(),
    };
    this.metricsLogger.reporter(jsonStringify(item));

    try {
      const result = await func();
      const item: MetricItem = {
        namespace: this.metricsLogger.namespace,
        dimensions: this.mergeDimensions(dimensions),
        name: `${name}.Error`,
        value: 0,
        unit: 'count',
        timestamp: Date.now(),
      };
      this.metricsLogger.reporter(jsonStringify(item));
      return result;
    } catch (err) {
      const item: MetricItem = {
        namespace: this.metricsLogger.namespace,
        dimensions: this.mergeDimensions(dimensions),
        name: `${name}.Error`,
        value: 1,
        unit: 'count',
        timestamp: Date.now(),
      };
      this.metricsLogger.reporter(jsonStringify(item));
      throw err;
    } finally {
      const item: MetricItem = {
        namespace: this.metricsLogger.namespace,
        dimensions: this.mergeDimensions(dimensions),
        name: `${name}.Latency`,
        value: Date.now() - startTimestamp,
        unit: 'ms',
        timestamp: Date.now(),
      };
      this.metricsLogger.reporter(jsonStringify(item));
    }
  }

  dollar(name: string, value: number, dimensions?: Dimensions | ReadonlyArray<Dimension>): void {
    const item: MetricItem = {
      namespace: this.metricsLogger.namespace,
      dimensions: this.mergeDimensions(dimensions),
      name,
      value: this.roundDollar(value),
      unit: 'dollar',
      timestamp: Date.now(),
    };
    this.metricsLogger.reporter(jsonStringify(item));
  }

  number(name: string, value: number, dimensions?: Dimensions | ReadonlyArray<Dimension> | undefined): void {
    const item: MetricItem = {
      namespace: this.metricsLogger.namespace,
      dimensions: this.mergeDimensions(dimensions),
      name,
      value: value,
      unit: 'unitless',
      timestamp: Date.now(),
    };
    this.metricsLogger.reporter(jsonStringify(item));
  }

  percent(name: string, value: number, dimensions?: Dimensions | ReadonlyArray<Dimension> | undefined): void {
    const item: MetricItem = {
      namespace: this.metricsLogger.namespace,
      dimensions: this.mergeDimensions(dimensions),
      name,
      value: Math.round(value * 1000) / 1000,
      unit: 'percent',
      timestamp: Date.now(),
    };
    this.metricsLogger.reporter(jsonStringify(item));
  }

  private roundDollar(dollar: number): number {
    if (dollar < 10) {
      // 4 digit
      return Math.round(dollar * 10000) / 10000;
    } else if (dollar < 100) {
      return Math.round(dollar * 1000) / 1000;
    } else {
      return Math.round(dollar * 100) / 100;
    }
  }

  private mergeDimensions(dims?: Dimensions | ReadonlyArray<Dimension>): ReadonlyArray<Dimension> | undefined {
    if (this.dimensions === undefined && dims === undefined) {
      return undefined;
    } else if (dims === undefined) {
      return this.dimensions;
    } else if (this.dimensions === undefined) {
      if (Array.isArray(dims)) {
        return dims;
      } else {
        return convertDimensionsToDimensionArray(dims);
      }
    } else {
      if (Array.isArray(dims)) {
        return deduplicateDimensions(this.dimensions.concat(dims));
      } else {
        return deduplicateDimensions(this.dimensions.concat(convertDimensionsToDimensionArray(dims)));
      }
    }
  }
}
