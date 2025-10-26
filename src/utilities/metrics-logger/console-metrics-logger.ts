import { Dimension, Dimensions, Metrics, MetricsLogger } from '../../models';
import { convertDimensionsToDimensionArray, deduplicateDimensions } from './utilities';
import { MetricsImpl } from './metrics-impl';

export class ConsoleMetricsLogger implements MetricsLogger {
  readonly namespace: string;
  readonly reporter: (message?: string) => void;
  private readonly global?: Dimensions | ReadonlyArray<Dimension>;

  constructor(namespace: string, global?: Dimensions | ReadonlyArray<Dimension>) {
    this.namespace = namespace;
    this.global = global;
    this.reporter = (message?: string) => {
      if (typeof message === 'string') {
        console.log(message);
      }
    };
  }

  create(dimensions?: Dimensions | ReadonlyArray<Dimension>): Metrics {
    let _dimensions: Dimensions | ReadonlyArray<Dimension> | undefined = undefined;

    if (dimensions === undefined) {
      _dimensions = this.global;
    } else if (this.global === undefined) {
      _dimensions = dimensions;
    } else {
      _dimensions = convertDimensionsToDimensionArray(this.global);
      _dimensions = deduplicateDimensions(_dimensions.concat(convertDimensionsToDimensionArray(dimensions)));
    }

    return new MetricsImpl(this, _dimensions);
  }

  async close(): Promise<void> {}
}
