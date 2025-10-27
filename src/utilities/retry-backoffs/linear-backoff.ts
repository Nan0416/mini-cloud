import { LoggerFactory } from '@sparrow/logging-js';
import { RetryBackoff } from './models';
import { asleep } from './utilities';

export interface LinearBackoffProps {
  readonly minimumBackoff: number;
  readonly maxmiumBackoff: number;
  readonly factor: number;
}

const logger = LoggerFactory.getLogger('LinearBackoff');
/**
 * The backoff strategy starts from the minimumBackoff, and the next wait will times the factor, until reach the maximum wait time.
 *
 * For example, minimumBackoff = 500, maxmiumBackoff = 3000, factor = 1.5,
 *
 * It will sleep 500ms, 750, 1125, 1688, 2532, 3000, 3000 ...
 */
export class LinearBackoff implements RetryBackoff {
  private readonly props: LinearBackoffProps;
  private waitTimeInSecond: number;
  constructor(props: LinearBackoffProps) {
    this.props = props;
    this.waitTimeInSecond = props.minimumBackoff;
  }

  async backoff(): Promise<void> {
    logger.info(`linear backoff sleep ${this.waitTimeInSecond}ms`);
    await asleep(this.waitTimeInSecond);
    this.waitTimeInSecond = Math.min(Math.round(this.waitTimeInSecond * this.props.factor), this.props.maxmiumBackoff);
  }

  reset() {
    logger.info('reset linear backoff');
    this.waitTimeInSecond = this.props.minimumBackoff;
  }
}
