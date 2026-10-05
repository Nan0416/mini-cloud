import { AsyncQueue, LoggerFactory, Monitor, evaluateMonitor, hashDimensions } from '@mini-cloud/shared';
import { MetricDao } from '../data/metric-dao';
import { MonitorDao } from '../data/monitor-dao';
import { metricReadWindow, metricResolutionFor } from '../utils/metric-read';
import { alarmMessage } from '../utils/notification-message';
import { DispatchInput, NotificationDispatcher } from './notification-dispatcher';

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

/** A change of state waiting to be sent, and the monitor it is about, for the log. */
interface PendingNotification extends DispatchInput {
  readonly monitorName: string;
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
  // Held rather than flagged, so stopping can wait for it.
  private tick?: Promise<void>;
  private stopped = false;

  // Sends are queued rather than awaited, so a Discord that is slow or unreachable cannot
  // hold a tick past the next one. One queue rather than a send each, so a slow ALARM
  // cannot arrive after the OK that followed it.
  private readonly notifications: AsyncQueue<PendingNotification>;

  constructor(props: MonitorEvaluatorProps) {
    this.props = props;
    this.notifications = new AsyncQueue((pending) => this.send(pending));
  }

  start(): void {
    logger.info(`Starting monitor evaluation every ${this.props.config.tickMs}ms.`);
    this.timer = setInterval(() => void this.runTick(), this.props.config.tickMs);
  }

  /**
   * Stops ticking, then waits up to `graceMs` for the tick under way and the queued
   * notifications, which read the database and so must finish before it closes. What
   * is still unsent after that is dropped and logged, rather than holding shutdown past
   * the point a service manager kills the process.
   */
  async stop(graceMs: number = 0): Promise<void> {
    if (this.timer !== undefined) {
      logger.info('Stopping monitor evaluation.');
      clearInterval(this.timer);
      this.timer = undefined;
    }

    let expiry: NodeJS.Timeout | undefined;
    const settled = (async () => {
      await this.tick;
      await this.notifications.drain();
      return true;
    })();
    const expired = new Promise<false>((resolve) => (expiry = setTimeout(() => resolve(false), graceMs)));
    const finished = await Promise.race([settled, expired]);
    clearTimeout(expiry);
    this.stopped = true;

    if (!finished) {
      logger.warn(
        `Stopped monitor evaluation after ${graceMs}ms with ${this.notifications.size} notification(s) still queued${this.tick === undefined ? '' : ' and an evaluation still running'}; the queued ones are dropped. Their changes are recorded in each monitor's history.`,
      );
    }
  }

  /** Resolves once every change recorded so far has been handed to its notifiers. */
  async notificationsSent(): Promise<void> {
    await this.notifications.drain();
  }

  async runTick(now: number = Date.now()): Promise<void> {
    if (this.stopped) {
      return;
    }
    if (this.tick !== undefined) {
      logger.warn('Skipping a monitor evaluation: the previous one is still running.');
      return;
    }
    this.tick = this.evaluateAll(now);
    try {
      await this.tick;
    } finally {
      this.tick = undefined;
    }
  }

  private async evaluateAll(now: number): Promise<void> {
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
    const message = alarmMessage({
      monitor: { ...monitor, state: change.toState, stateReason: change.reason, stateChangedAt: change.changedAt },
      change,
      consoleUrl: config.consoleUrl,
    });
    this.notifications.enqueue({ monitorName: monitor.name, notifierIds: monitor.notifierIds, message });
    // `size` counts what waits, not the send in flight, so a nonzero size means this one waits behind as many.
    if (this.notifications.size > 0) {
      logger.info(`Queued "${message.title}" behind ${this.notifications.size} other notification(s).`);
    }
  }

  /** Not retried, and never thrown: the change is recorded either way, and the history shows it. */
  private async send({ monitorName, notifierIds, message }: PendingNotification): Promise<void> {
    if (this.stopped) {
      logger.debug(`Dropped "${message.title}" for monitor "${monitorName}": monitor evaluation has stopped.`);
      return;
    }
    const { delivered, failed, missing } = await this.props.dispatcher.dispatch({ notifierIds, message });
    logger.info(`Notified "${message.title}" for monitor "${monitorName}": sent to ${delivered.length} notifier(s), ${failed.length} failed, ${missing.length} missing.`);
  }
}
