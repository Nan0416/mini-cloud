import { MetricsImpl } from './metrics-impl';
import { Dimension, Dimensions, Metrics, MetricsLogger } from '../../models';
import { convertDimensionsToDimensionArray, deduplicateDimensions } from './utilities';
import * as winston from 'winston';
import 'winston-daily-rotate-file';
const { MESSAGE } = require('triple-beam');

const simpleJsonFormatBuilder = winston.format((info) => {
  info[MESSAGE] = info.message;
  return info;
});

export interface Props {
  readonly maxFiles?: string;
  readonly global?: Dimensions | ReadonlyArray<Dimension>;
}

export class FileMetricsLogger implements MetricsLogger {
  private readonly logger: winston.Logger;
  private readonly outputDir: string;
  private readonly maxFiles: string;
  private readonly global?: Dimensions | ReadonlyArray<Dimension>;

  readonly namespace: string;
  readonly reporter: (message?: string) => void;

  constructor(namespace: string, outputDir: string, props?: Props) {
    this.namespace = namespace;
    this.global = props?.global;
    this.outputDir = outputDir;
    this.maxFiles = props?.maxFiles ?? '3d';
    const transport = new winston.transports.DailyRotateFile({
      dirname: this.outputDir,
      utc: true,
      filename: `${namespace}-%DATE%.metrics`,
      level: 'info',
      datePattern: 'YYYY-MM-DD-HH',
      maxFiles: this.maxFiles,
    });

    this.logger = winston.createLogger({
      level: 'info',
      format: simpleJsonFormatBuilder(),
      transports: transport,
    });

    this.reporter = (message) => this.logger.info(message);
  }

  async close(): Promise<void> {}

  create(dimensions?: Dimensions): Metrics {
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
}
