import { LoggerFactory } from '@sparrow/logging-js';
import { ExitCode, OfflineTaskReport, TaskEventLevel, TaskReporterClient } from '../../models';
import { appendFile } from 'fs/promises';
import { promises as fs } from 'fs';
import path from 'path';
import { TaskReporterClientImpl } from './task-reporter-client-impl';
import { AxiosHttpClient } from '@sparrow/axios-http-client';

const logger = LoggerFactory.getLogger('TaskReporter');

/**
 * Run inside task process.
 */

export class TaskReporter {
  private readonly taskInstanceId?: string;
  private readonly passiveHealthCheckDuration?: number;
  private readonly offlineReportPath?: string;
  private readonly taskReporterClient: TaskReporterClient;

  constructor(agentUrl: string) {
    logger.info(`Task agent url ${agentUrl}.`);
    this.taskReporterClient = new TaskReporterClientImpl(new AxiosHttpClient({ baseUrl: agentUrl, timeout: 5000 }));
    this.taskInstanceId = process.env['TASK_INSTANCE_ID'];
    if (typeof this.taskInstanceId === 'string') {
      logger.info(`Task instance id ${this.taskInstanceId}.`);
    } else {
      logger.warn(`Didn't find task instance id, the process is not launched by task agent.`);
    }

    this.offlineReportPath = process.env['OFFLINE_REPORT_PATH'];
    if (typeof this.offlineReportPath === 'string') {
      logger.info(`Offline report path is ${this.offlineReportPath}.`);
    } else {
      logger.warn(`Didn't find offline report path, ignore report when task agent is offline.`);
    }

    const _passiveHealthCheckDuration = process.env['PASSIVE_HEALTH_CHECK_DURATION'];
    if (typeof _passiveHealthCheckDuration === 'string') {
      const duration = Number(_passiveHealthCheckDuration);
      if (!Number.isNaN(duration) && Math.round(duration) === duration && duration >= 5_000) {
        logger.info(`Configured passive health check duration ${duration}.`);
        this.passiveHealthCheckDuration = duration;
        if (typeof this.taskInstanceId === 'string') {
          setInterval(() => {
            this.healthCheck();
          }, this.passiveHealthCheckDuration);
        }
      } else {
        logger.warn(`Invalid passive health check duration ${_passiveHealthCheckDuration}.`);
      }
    } else {
      logger.info('No passive health check configured.');
    }
  }

  async reportPid(): Promise<void> {
    if (typeof this.taskInstanceId !== 'string') {
      return;
    }

    const pid = process.pid;
    await this.saveLocalTaskInstanceFile(this.taskInstanceId, pid);
    logger.info(`Report task instance pid ${pid}.`);

    try {
      await this.taskReporterClient.reportPid({
        taskInstanceId: this.taskInstanceId,
        pid: pid,
      });
    } catch (err: any) {
      logger.info('Failed to report instance pid.', err);
      await this.saveOfflineReport({
        type: 'pid',
        version: '1.0.0',
        instanceId: this.taskInstanceId,
        timestamp: Date.now(),
        pid: pid,
      });
    }
  }

  async reportTermination(): Promise<void> {
    if (typeof this.taskInstanceId !== 'string') {
      return;
    }
    await this.deleteLocalTaskInstanceFile(this.taskInstanceId);
    logger.info('Report task instance termination.');

    try {
      await this.taskReporterClient.reportTermination({
        taskInstanceId: this.taskInstanceId,
      });
    } catch (err: any) {
      logger.info('Failed to report instance termination.', err);
      await this.saveOfflineReport({
        type: 'termination',
        version: '1.0.0',
        instanceId: this.taskInstanceId,
        timestamp: Date.now(),
      });
    }
  }

  async reportExit(code?: ExitCode): Promise<void> {
    if (typeof this.taskInstanceId !== 'string') {
      return;
    }
    await this.deleteLocalTaskInstanceFile(this.taskInstanceId);
    logger.info(`Report task instance exit, code ${code}.`);

    try {
      await this.taskReporterClient.reportExit({
        taskInstanceId: this.taskInstanceId,
        code: code,
      });
    } catch (err: any) {
      logger.info('Failed to report instance exit.', err);
      await this.saveOfflineReport({
        type: 'exit',
        version: '1.0.0',
        instanceId: this.taskInstanceId,
        timestamp: Date.now(),
        code: code,
      });
    }
  }

  private async saveLocalTaskInstanceFile(instanceId: string, pid: number) {
    const path = this.buildLocalTaskInstanceFilePath(instanceId);
    try {
      logger.debug(`Save local task instance file ${path}.`);
      await fs.writeFile(
        path,
        JSON.stringify({
          pid: pid,
        }),
      );
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return;
      } else {
        logger.warn(`Failed to save local task instance file ${path}.`, err);
      }
    }
  }

  private async deleteLocalTaskInstanceFile(instanceId: string) {
    const path = this.buildLocalTaskInstanceFilePath(instanceId);
    try {
      logger.debug(`Delete local task instance file ${path}.`);
      await fs.unlink(path);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return;
      } else {
        logger.warn(`Failed to delete local task instance file ${path}.`, err);
      }
    }
  }

  private buildLocalTaskInstanceFilePath(instanceId: string): string {
    return path.join('/tmp', `task-${instanceId}.json`);
  }

  async log(level: TaskEventLevel, payload: any): Promise<void> {
    if (typeof this.taskInstanceId !== 'string') {
      return;
    }
    logger.info('Report task instance event.');

    try {
      await this.taskReporterClient.reportEvent({
        taskInstanceId: this.taskInstanceId,
        level: level,
        payload: payload,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      logger.info('Failed to report event.', err);
      await this.saveOfflineReport({
        type: 'event',
        version: '1.0.0',
        instanceId: this.taskInstanceId,
        timestamp: Date.now(),
        level: level,
        payload: payload,
      });
    }
  }

  private async healthCheck(): Promise<void> {
    if (typeof this.taskInstanceId !== 'string') {
      return;
    }
    logger.debug('Task reporter passive health check.');

    try {
      await this.taskReporterClient.reportPassiveHealthCheck({
        taskInstanceId: this.taskInstanceId,
      });
    } catch (err) {
      logger.debug('Task reporter passive health check failed.');
    }
  }

  private async saveOfflineReport(report: OfflineTaskReport) {
    if (this.offlineReportPath !== undefined) {
      logger.info(`append offline report ${report.type}`);
      await appendFile(this.offlineReportPath, JSON.stringify(report) + '\n', { encoding: 'utf-8' });
    }
  }
}
