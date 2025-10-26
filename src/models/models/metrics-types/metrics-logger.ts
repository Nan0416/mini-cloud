import { Dimension, Dimensions } from '../../models';

export interface Metrics {
  readonly dimensions?: ReadonlyArray<Dimension>;

  time(name: string, value: number, dimensions?: Dimensions | ReadonlyArray<Dimension>): void;

  timer<T>(func: () => T, name: string, dimensions?: Dimensions | ReadonlyArray<Dimension>): T;

  asyncTimer<T>(func: () => Promise<T>, name: string, dimensions?: Dimensions | ReadonlyArray<Dimension>): Promise<T>;

  /**
   * timer + error counter.
   * @param func
   * @param name
   */
  asyncCall<T>(func: () => Promise<T>, name: string, dimensions?: Dimensions | ReadonlyArray<Dimension>): Promise<T>;

  count(name: string, value: number, dimensions?: Dimensions | ReadonlyArray<Dimension>): void;

  incrementCounter(name: string, dimensions?: Dimensions | ReadonlyArray<Dimension>): void;

  dollar(name: string, value: number, dimensions?: Dimensions | ReadonlyArray<Dimension>): void;

  percent(name: string, value: number, dimensions?: Dimensions | ReadonlyArray<Dimension>): void;

  // unitless
  number(name: string, value: number, dimensions?: Dimensions | ReadonlyArray<Dimension>): void;

  close(): Promise<void>;
}

/**
 * Metrics logger creates and manages metrics objects.
 * One service typically has one global metrics logger.
 */
export interface MetricsLogger {
  readonly namespace: string;
  readonly reporter: (message?: string) => void;
  create(dimensions?: Dimensions | ReadonlyArray<Dimension>): Metrics;
  close(): Promise<void>;
}
