import { LoggerFactory, Monitor, evaluateMonitor, hashDimensions } from '@mini-cloud/shared';
import { MetricDao } from '../data/metric-dao';
import { MonitorDao } from '../data/monitor-dao';
import { metricReadWindow, metricResolutionFor } from '../utils/metric-read';
import { alarmMessage } from '../utils/notification-message';
import { NotificationDispatcher } from './notification-dispatcher';

const logger = LoggerFactory.getLogger('MonitorEvaluator');

export interface MonitorEvaluatorConfig {
  /** How often every monitor is evaluated. */
  readonly tickMs: number;
  /** The metrics' own, so a monitor reads the periods a graph would draw and no newer. */
  readonly queryLagMs: number;
  readonly rawRetentionDays: number;
  /** Where a notification links to the monitor; empty for no link. */
  readonly consoleUrl: string;
}

export interface MonitorEvaluatorProps {
  readonly monitorDao: MonitorDao;
  readonly metricDao: MetricDao;
  readonly dispatcher: NotificationDispatcher;
  readonly config: MonitorEvaluatorConfig;
}

/**
 * Evaluates every monitor once a tick and records each change of state, then sends
 * the change to the monitor's notifiers.
 *
 * The window ends where a graph's read would: at the last period every agent has had
 * time to report. Judging a period only some agents have reported would alarm on a dip
 * that corrects itself a minute later.
 */
export class MonitorEvaluator {
  private readonly props: MonitorEvaluatorProps;
  private timer?: NodeJS.Timeout;

  // A slow tick must not overlap the next: both would judge the same monitor, and the
  // second's change would be refused by the state guard after the first had notified.
  private running = false;

  constructor(props: MonitorEvaluatorProps) {
    this.props = props;
  }

  start(): void {
    logger.info(`Starting monitor evaluation every ${this.props.config.tickMs}ms.`);
    this.timer = setInterval(() => void this.runTick(), this.props.config.tickMs);
  }

  stop(): void {
    if (this.timer !== undefined) {
      logger.info('Stopping monitor evaluation.');
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async runTick(now: number = Date.now()): Promise<void> {
    if (this.running) {
      logger.warn('Skipping a monitor evaluation: the previous one is still running.');
      return;
    }
    this.running = true;
    try {
      const { monitors } = await this.props.monitorDao.listMonitors({});
      logger.debug(`Evaluating ${monitors.length} monitor(s).`);
      for (const monitor of monitors) {
        // One monitor failing, say on a series it cannot read, must not cost the rest their evaluation.
        try {
          await this.evaluate(monitor, now);
        } catch (err) {
          logger.error(`Monitor "${monitor.name}" could not be evaluated; it will be tried again on the next tick.`, err);
        }
      }
    } catch (err) {
      logger.error('Monitor evaluation failed; it will be retried on the next tick.', err);
    } finally {
      this.running = false;
    }
  }

  private async evaluate(monitor: Monitor, now: number): Promise<void> {
    const { monitorDao, metricDao, config } = this.props;
    const { metric, periodMs, evaluationPeriods } = monitor;

    // Both ends are on period boundaries, so the window is exactly N periods.
    const { from, to } = metricReadWindow({ from: now - config.queryLagMs - evaluationPeriods * periodMs, periodMs, now, queryLagMs: config.queryLagMs });
    const resolution = metricResolutionFor({ statistic: metric.statistic, periodMs, from, now, rawRetentionDays: config.rawRetentionDays });
    const { datapoints } = await metricDao.readSeries({
      namespace: metric.namespace,
      metricName: metric.metricName,
      dimensionsHash: hashDimensions(metric.dimensions),
      resolution,
      statistic: metric.statistic,
      periodMs,
      from,
      to,
      limit: evaluationPeriods,
    });

    const evaluation = evaluateMonitor({ definition: monitor, currentState: monitor.state, datapoints, windowEnd: to });
    if (evaluation.state === monitor.state) {
      await monitorDao.markEvaluated({ name: monitor.name, evaluatedAt: now });
      return;
    }

    const { change } = await monitorDao.changeState({
      name: monitor.name,
      fromState: monitor.state,
      version: monitor.version,
      toState: evaluation.state,
      reason: evaluation.reason,
      datapoints: evaluation.datapoints,
      threshold: monitor.threshold,
      changedAt: now,
    });
    if (change === undefined) {
      logger.info(`Monitor "${monitor.name}" changed or was deleted while it was being evaluated; its next evaluation will judge it afresh.`);
      return;
    }
    logger.info(`Monitor "${monitor.name}" moved from ${change.fromState} to ${change.toState}.`);

    if (!monitor.notify) {
      logger.debug(`Monitor "${monitor.name}" is muted, so the change is only recorded.`);
      return;
    }
    if (monitor.notifierIds.length === 0) {
      logger.debug(`Monitor "${monitor.name}" has no notifiers, so the change is only recorded.`);
      return;
    }
    // Not retried, and never thrown: the change is recorded either way, and the history shows it.
    const message = alarmMessage({
      monitor: { ...monitor, state: change.toState, stateReason: change.reason, stateChangedAt: change.changedAt },
      change,
      consoleUrl: config.consoleUrl,
    });
    const { delivered, failed, missing } = await this.props.dispatcher.dispatch({ notifierIds: monitor.notifierIds, message });
    logger.info(`Monitor "${monitor.name}" is ${change.toState}: sent to ${delivered.length} notifier(s), ${failed.length} failed, ${missing.length} missing.`);
  }
}
