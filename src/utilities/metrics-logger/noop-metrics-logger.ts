import { Dimension, Dimensions, Metrics, MetricsLogger } from '../../models';
import { convertDimensionsToDimensionArray } from './utilities';

export class NoopMetrics implements Metrics {
  readonly dimensions?: ReadonlyArray<Dimension>;

  constructor(dimensions?: Dimensions | ReadonlyArray<Dimension>) {
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

  time(name: string, value: number, dimensions?: Dimensions | ReadonlyArray<Dimension>): void {}

  timer<T>(func: () => T, name: string, dimensions?: Dimensions | ReadonlyArray<Dimension>): T {
    return func();
  }
  asyncTimer<T>(func: () => Promise<T>, name: string, dimensions?: Dimensions | ReadonlyArray<Dimension>): Promise<T> {
    return func();
  }
  asyncCall<T>(func: () => Promise<T>, name: string, dimensions?: Dimensions | ReadonlyArray<Dimension>): Promise<T> {
    return func();
  }
  count(name: string, value: number, dimensions?: Dimensions | ReadonlyArray<Dimension>): void {}
  incrementCounter(name: string, dimensions?: Dimensions | ReadonlyArray<Dimension>): void {}
  dollar(name: string, value: number, dimensions?: Dimensions | ReadonlyArray<Dimension>): void {}
  percent(name: string, value: number, dimensions?: Dimensions | ReadonlyArray<Dimension> | undefined): void {}
  number(name: string, value: number, dimensions?: Dimensions | ReadonlyArray<Dimension> | undefined): void {}
  async close(): Promise<void> {}
}

export class NoopMetricsLogger implements MetricsLogger {
  readonly namespace: string;
  readonly reporter: (message?: string) => void;

  constructor(namespace: string) {
    this.namespace = namespace;
    this.reporter = () => {};
  }

  create(dimensions?: Dimensions | ReadonlyArray<Dimension>): Metrics {
    return new NoopMetrics(dimensions);
  }

  async close(): Promise<void> {}
}
