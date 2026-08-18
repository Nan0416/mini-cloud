import { LoggerFactory, OfflineReport, REPORTER_ENV, TaskEventLevel } from '@mini-cloud/shared';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const logger = LoggerFactory.getLogger('TaskReporter');

export interface TaskReporterProps {
  readonly instanceId: string;
  /** Base URL of the local agent, e.g. `http://127.0.0.1:3100`. */
  readonly agentUrl: string;
  /** Where to buffer reports the agent could not accept. */
  readonly offlineReportPath?: string;
  /** Heartbeat interval for passive health checks. Omit to disable. */
  readonly healthCheckPeriodMs?: number;
  readonly timeoutMs?: number;
}

/**
 * Imported by programs mini-cloud launches, to report their own lifecycle.
 *
 * Two rules shape this class. First, **no method ever throws**: a monitoring library
 * that can crash the program it monitors is worse than no monitoring. Second, a
 * report that cannot be delivered is appended to a local file instead of being lost,
 * so restarting the agent recovers the history rather than leaving instances stuck
 * at their last known status.
 */
export class TaskReporter {
  private readonly props: TaskReporterProps;
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(props: TaskReporterProps) {
    this.props = props;
  }

  /**
   * Builds a reporter from the environment the agent injected, or returns undefined
   * when the program was not started by mini-cloud — which is what makes it safe to
   * call unconditionally in a program you also run by hand.
   */
  static fromEnvironment(): TaskReporter | undefined {
    const instanceId = process.env[REPORTER_ENV.instanceId];
    const agentUrl = process.env[REPORTER_ENV.agentUrl];
    if (typeof instanceId !== 'string' || instanceId.length === 0 || typeof agentUrl !== 'string' || agentUrl.length === 0) {
      logger.debug('Not running under a mini-cloud agent; reporting is disabled.');
      return undefined;
    }

    const rawPeriod = process.env[REPORTER_ENV.healthCheckPeriodMs];
    const period = rawPeriod === undefined ? undefined : Number(rawPeriod);

    return new TaskReporter({
      instanceId,
      agentUrl,
      offlineReportPath: process.env[REPORTER_ENV.offlineReportPath],
      healthCheckPeriodMs: period !== undefined && Number.isFinite(period) && period > 0 ? period : undefined,
    });
  }

  /** Reports the pid and starts the passive heartbeat if one is configured. */
  async start(): Promise<void> {
    await this.reportPid();
    if (this.props.healthCheckPeriodMs !== undefined) {
      logger.info(`Sending a passive health check every ${this.props.healthCheckPeriodMs}ms.`);
      this.heartbeatTimer = setInterval(() => void this.sendHeartbeat(), this.props.healthCheckPeriodMs);
      // Do not hold the event loop open on the reporter's account: the program
      // should be free to exit when its own work is done.
      this.heartbeatTimer.unref();
    }
  }

  async reportPid(): Promise<void> {
    const pid = process.pid;
    const delivered = await this.post('/pid', { instanceId: this.props.instanceId, pid });
    if (!delivered) {
      await this.buffer({ version: 1, type: 'pid', instanceId: this.props.instanceId, timestamp: Date.now(), pid });
    }
  }

  /** Call from a SIGINT/SIGTERM handler, once shutdown is complete. */
  async reportTermination(): Promise<void> {
    this.stopHeartbeat();
    const delivered = await this.post('/termination', { instanceId: this.props.instanceId });
    if (!delivered) {
      await this.buffer({ version: 1, type: 'termination', instanceId: this.props.instanceId, timestamp: Date.now() });
    }
  }

  /** Call just before exiting. A non-zero code marks the instance failed. */
  async reportExit(code: number = 0): Promise<void> {
    this.stopHeartbeat();
    const delivered = await this.post('/exit', { instanceId: this.props.instanceId, code });
    if (!delivered) {
      await this.buffer({ version: 1, type: 'exit', instanceId: this.props.instanceId, timestamp: Date.now(), code });
    }
  }

  /** Adds an entry to the instance's event log. */
  async log(level: TaskEventLevel, payload: unknown): Promise<void> {
    const timestamp = Date.now();
    const delivered = await this.post('/event', { instanceId: this.props.instanceId, level, payload, timestamp });
    if (!delivered) {
      await this.buffer({ version: 1, type: 'event', instanceId: this.props.instanceId, timestamp, level, payload });
    }
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private async sendHeartbeat(): Promise<void> {
    // A missed heartbeat is the health check's whole signal, so it is deliberately
    // not buffered: replaying a stale one later would say nothing useful.
    await this.post('/health-check', { instanceId: this.props.instanceId });
  }

  /** Returns whether the agent accepted the report. Never throws. */
  private async post(path_: string, body: unknown): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.props.timeoutMs ?? 3_000);
    try {
      const response = await fetch(`${this.props.agentUrl}${path_}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        logger.warn(`Agent rejected ${path_} with HTTP ${response.status}.`);
        return false;
      }
      return true;
    } catch (err) {
      logger.warn(`Could not reach the agent at ${this.props.agentUrl}${path_}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async buffer(report: OfflineReport): Promise<void> {
    const target = this.props.offlineReportPath;
    if (target === undefined) {
      logger.warn(`Dropping a ${report.type} report: no offline report path is configured.`);
      return;
    }
    try {
      await mkdir(path.dirname(target), { recursive: true });
      await appendFile(target, `${JSON.stringify(report)}\n`, { encoding: 'utf-8' });
      logger.info(`Buffered a ${report.type} report for the agent to pick up.`);
    } catch (err) {
      // Nothing further to try; swallowing keeps the promise that reporting cannot
      // take down the task.
      logger.error(`Failed to buffer a ${report.type} report to ${target}.`, err);
    }
  }
}
