import { LoggerFactory } from '@sparrow/logging-js';
import { AgentSideTaskStatus, ExitCode, HealthCheck, OfflineTaskReport, TaskClientForAgent, TaskEventLevel, TaskIdentifier, TaskInstance } from '../../models';
import { InternalLaunchTaskInstanceRequest } from './models';
import { PassiveHealthCheckManager } from './passive-health-check-manager';
import { PingHealthCheckManager } from './ping-health-check-manager';
import { TaskLauncher } from './task-launcher';
import { VariableReplacement } from './variable-replacement';
import { readFile, unlink } from 'fs/promises';
import { HealthCheckResult } from './health-check-manager';
import { healthCheckResultsDelta } from './utilities';
import { TaskAgentHandler } from './task-agent-handler';

const logger = LoggerFactory.getLogger('TaskAgentHandlerImpl');

export interface TaskAgentHandlerProps {
  readonly client: TaskClientForAgent;
  readonly taskLauncher: TaskLauncher;
  readonly variableReplacement: VariableReplacement;
  readonly passiveHealthCheckManager: PassiveHealthCheckManager;
  readonly pingHealthCheckManager: PingHealthCheckManager;
  readonly offlineReportPath: string;
}

export class TaskAgentHandlerImpl implements TaskAgentHandler {
  private readonly client: TaskClientForAgent;
  private readonly taskLauncher: TaskLauncher;
  private readonly variableReplacement: VariableReplacement;
  private readonly instanceIdToHealthCheck: Map<string, HealthCheck>;
  private healthCheckResults: Map<string, 'failed' | 'success'>;
  private readonly passiveHealthCheckManager: PassiveHealthCheckManager;
  private readonly pingHealthCheckManager: PingHealthCheckManager;
  private readonly offlineReportPath: string;
  private backgroundHandle?: NodeJS.Timeout;

  constructor(props: TaskAgentHandlerProps) {
    this.client = props.client;
    this.taskLauncher = props.taskLauncher;
    this.variableReplacement = props.variableReplacement;
    this.instanceIdToHealthCheck = new Map();
    this.healthCheckResults = new Map();
    this.passiveHealthCheckManager = props.passiveHealthCheckManager;
    this.pingHealthCheckManager = props.pingHealthCheckManager;
    this.offlineReportPath = props.offlineReportPath;
  }

  async init(): Promise<void> {
    logger.info(`loading event when the agent is offline`);
    const offlineReports = await this.loadOfflineReports();
    logger.info(`found ${offlineReports.length} reports`);
    await this.populateOfflineReports(offlineReports);
    await this.cleanOfflineReports();

    logger.info('initialize task agent facade, loading current running instances on the agent');
    const runningInstances = await this.client.listRunningInstances();
    logger.info(`found ${runningInstances.length} running instances, intialize their health check`);
    await this.initializeRunningInstanceHealthCheck(runningInstances);

    logger.info('setup recurrent agent status report and task health checks');
    this.backgroundHandle = setInterval(async () => {
      await this.backgroundTask();
    }, 5_000);
  }

  async terminate(): Promise<void> {
    if (this.backgroundHandle !== undefined) {
      clearInterval(this.backgroundHandle);
      this.backgroundHandle = undefined;
    }
    this.healthCheckResults.clear();
    this.instanceIdToHealthCheck.clear();
  }

  async terminateAgent(): Promise<void> {
    logger.info('perform self termination');
    process.kill(process.pid, 'SIGINT');
  }

  /**
   * replace variables, launch the task, track health check, report instance status.
   * @param launchRequest
   */
  async handleLaunchRequest(launchRequest: LaunchTaskInstanceRequest): Promise<void> {
    try {
      logger.info(`launch task ${launchRequest.taskId} version ${launchRequest.version} with assigned task instance id ${launchRequest.taskInstanceId}`);
      const internalRequest = this.convertLaunchTaskInstanceRequestToInternalLaunchTaskInstanceRequest(launchRequest);
      const requestAfterReplacement = await this.variableReplacement.replace(internalRequest);
      await this.taskLauncher.launch(requestAfterReplacement);
      const message = `successfully launched task instance ${launchRequest.taskInstanceId}`;
      logger.info(message);
      await this.reportStatusAndEvent(launchRequest.taskInstanceId, 'launched', 'success', message);

      if (launchRequest.healthCheck) {
        this.instanceIdToHealthCheck.set(launchRequest.taskInstanceId, launchRequest.healthCheck);
      }
    } catch (err: any) {
      const message = `Failed to launch task instance ${launchRequest.taskInstanceId}.`;
      logger.error(message, err);
      await this.reportStatusAndEvent(launchRequest.taskInstanceId, 'failed_to_launch', 'error', message);
    }
  }

  private convertLaunchTaskInstanceRequestToInternalLaunchTaskInstanceRequest(request: LaunchTaskInstanceRequest): InternalLaunchTaskInstanceRequest {
    const passiveHealthCheckDuration = request.healthCheck?.type === 'passive' ? this.passiveHealthCheckManager.getPeriodInMs(request.healthCheck) : undefined;

    const temp: InternalLaunchTaskInstanceRequest = {
      taskId: request.taskId,
      version: request.version,
      instanceId: request.taskInstanceId,
      cmd: request.cmd,
      cwd: request.cwd,
      arguments: request.arguments,
      env: request.env,
      stdout: request.stdout,
      stderr: request.stderr,
      passiveHealthCheckDuration: passiveHealthCheckDuration,
      offlineReportPath: this.offlineReportPath,
    };
    return temp;
  }

  /**
   * terminate pid and report status.
   */
  async handleTerminationRequest(instanceId: string, pid: number): Promise<void> {
    logger.info(`terminate task instance ${instanceId} pid ${pid}`);
    try {
      process.kill(pid, 'SIGINT');
      this.stopInstanceHealthCheck(instanceId);
      const message = `successfully send SIGINT signal to pid ${pid}`;
      logger.info(message);
      await this.reportStatusAndEvent(instanceId, 'terminating', 'success', message);
    } catch (err: any) {
      // no permission, etc.
      if (err.code === 'ESRCH') {
        // assume the process is successfully terminated if no such process.
        this.stopInstanceHealthCheck(instanceId);
        const message = `pid ${pid} doesn't exist`;
        logger.info(message);
        await this.reportStatusAndEvent(instanceId, 'terminated', 'success', message);
      } else {
        const message = `failed to send SIGINT signal to pid ${pid} due to ${err.code}`;
        logger.error(message);
        await this.reportStatusAndEvent(instanceId, 'agent_termination_failed', 'error', message);
      }
    }
  }

  async handleAgentStatusRequest(): Promise<void> {
    logger.info('received agent status request');
    await this.client.reportAgentStatus();
  }

  /**
   * report to task service.
   * @param instanceId
   * @param pid
   */
  async reportPid(instanceId: string, pid: number): Promise<void> {
    logger.info(`received instance ${instanceId} pid report, ${pid}, update task status to running and start health check`);
    await this.client.reportPid(instanceId, pid);
    await this.client.reportStatus(instanceId, 'running');

    const healthCheck = this.instanceIdToHealthCheck.get(instanceId);
    if (healthCheck !== undefined) {
      logger.info(`start instance ${instanceId} health check`);
      if (healthCheck.type === 'passive') {
        this.passiveHealthCheckManager.watchInstance(instanceId, healthCheck);
      } else if (healthCheck.type === 'ping') {
        this.pingHealthCheckManager.watchInstance(instanceId, healthCheck);
      } else {
        logger.warn(`unknown health check type ${(healthCheck as any).type} associated with task instance ${instanceId}`);
      }
    }
  }

  async reportTermination(instanceId: string): Promise<void> {
    logger.info(`report instance ${instanceId} termination to task service`);
    this.stopInstanceHealthCheck(instanceId);
    await this.client.reportStatus(instanceId, 'terminated');
  }

  async reportExit(instanceId: string, code?: ExitCode): Promise<void> {
    logger.info(`report instance ${instanceId} exit, code ${code}, to task service`);
    this.stopInstanceHealthCheck(instanceId);
    await this.client.reportStatus(instanceId, code === -1 ? 'exit(1)' : 'exit(0)');
  }

  private stopInstanceHealthCheck(instanceId: string) {
    this.passiveHealthCheckManager.removeInstance(instanceId);
    this.pingHealthCheckManager.removeInstance(instanceId);
    this.instanceIdToHealthCheck.delete(instanceId);
    this.healthCheckResults.delete(instanceId);
  }

  async reportEvent(event: InstanceEvent): Promise<void> {
    logger.info(`report instance ${event.instanceId} ${event.level} event to task service`);
    await this.client.reportTaskEvent({
      instanceId: event.instanceId,
      timestamp: event.timestamp,
      source: 'task-instance',
      level: event.level,
      format: typeof event.payload === 'string' ? 'string' : 'json',
      payload: event.payload,
    });
  }

  async handleHealthCheck(instanceId: string): Promise<void> {
    logger.info(`record task instance ${instanceId} passive health check`);
    this.passiveHealthCheckManager.handlePing(instanceId);
  }

  private async reportStatusAndEvent(instanceId: string, status: AgentSideTaskStatus, level: TaskEventLevel, message: string) {
    logger.info(`report task instance ${instanceId} ${status} status and ${level} event`);
    await this.client.reportStatus(instanceId, status);
    await this.client.reportTaskEvent({
      instanceId: instanceId,
      source: 'task-agent',
      timestamp: Date.now(),
      level: level,
      format: 'string',
      payload: message,
    });
  }

  private async backgroundTask() {
    logger.debug('running health check');
    let latestHealthCheckResults: ReadonlyArray<HealthCheckResult> = [];
    latestHealthCheckResults = latestHealthCheckResults.concat(await this.passiveHealthCheckManager.healthCheck(this.healthCheckResults));
    latestHealthCheckResults = latestHealthCheckResults.concat(await this.pingHealthCheckManager.healthCheck(this.healthCheckResults));

    const delta = healthCheckResultsDelta(this.healthCheckResults, latestHealthCheckResults);
    const newHealthCheckResults = new Map();
    latestHealthCheckResults.forEach((v) => newHealthCheckResults.set(v.instanceId, v.result));
    this.healthCheckResults = newHealthCheckResults;

    logger.debug(`found ${delta.instancesBecomeFailed.length} new instances failed health check and ${delta.instancesBecomeSuccessful.length} instances back online`);

    for (let i = 0; i < delta.instancesBecomeFailed.length; i++) {
      const message = `task instance ${delta.instancesBecomeFailed[i]} health check failed`;
      logger.info(message);
      await this.reportStatusAndEvent(delta.instancesBecomeFailed[i], 'health_check_failure', 'error', message);
    }

    for (let i = 0; i < delta.instancesBecomeSuccessful.length; i++) {
      const message = `task instance ${delta.instancesBecomeSuccessful[i]} back online`;
      logger.info(message);
      await this.reportStatusAndEvent(delta.instancesBecomeSuccessful[i], 'running', 'success', message);
    }
  }

  private async loadOfflineReports(): Promise<OfflineTaskReport[]> {
    logger.info(`read file ${this.offlineReportPath}`);
    try {
      const data = await readFile(this.offlineReportPath, { encoding: 'utf-8' });
      return data
        .split('\n')
        .filter((item) => item.length > 0)
        .map((item) => JSON.parse(item));
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        logger.warn(`failed to read offline report file ${this.offlineReportPath} due to ${err.code}`);
        throw err;
      } else {
        logger.info(`offline report file ${this.offlineReportPath} doesn't exist`);
        return [];
      }
    }
  }

  private async populateOfflineReports(reports: OfflineTaskReport[]): Promise<void> {
    for (let i = 0; i < reports.length; i++) {
      // assume all report versions are 1.0.0
      const report = reports[i];
      if (report.type === 'pid') {
        const message = `backfill pid report happened at ${new Date(report.timestamp).toISOString()}`;
        logger.info(message);
        await this.client.reportPid(report.instanceId, report.pid);
        await this.reportStatusAndEvent(report.instanceId, 'running', 'success', message);
      } else if (report.type === 'exit') {
        const status = report.code === -1 ? 'exit(1)' : 'exit(0)';
        const message = `backfill ${status} report happened at ${new Date(report.timestamp).toISOString()}`;
        logger.info(message);
        await this.reportStatusAndEvent(report.instanceId, status, 'success', message);
      } else if (report.type === 'termination') {
        const message = `backfill termination report happened at ${new Date(report.timestamp).toISOString()}`;
        logger.info(message);
        await this.reportStatusAndEvent(report.instanceId, 'terminated', 'success', message);
      } else if (report.type === 'event') {
        await this.client.reportTaskEvent({
          instanceId: report.instanceId,
          source: 'task-instance',
          timestamp: report.timestamp,
          level: report.level,
          format: typeof report.payload === 'string' ? 'string' : 'json',
          payload: report.payload,
        });
      } else {
        logger.warn(`unknown offline report type ${(report as any).type}`);
      }
    }
  }

  private async cleanOfflineReports(): Promise<void> {
    logger.info('remove offline reports');
    try {
      await unlink(this.offlineReportPath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
  }

  private async initializeRunningInstanceHealthCheck(instances: TaskInstance[]): Promise<void> {
    const taskIdentifiers: TaskIdentifier[] = instances.map((i) => ({
      taskId: i.taskId,
      version: i.taskVersion,
    }));

    const healthChecks = await this.client.listHealthChecks(taskIdentifiers);
    for (let i = 0; i < healthChecks.length; i++) {
      const healthCheck = healthChecks[i];
      const instanceId = instances.find((i) => i.taskId === healthCheck.taskId && i.taskVersion === healthCheck.version)?.instanceId;

      if (instanceId !== undefined) {
        this.instanceIdToHealthCheck.set(instanceId, healthCheck.healthCheck);
        logger.info(`start instance ${instanceId} health check`);
        if (healthCheck.healthCheck.type === 'passive') {
          this.passiveHealthCheckManager.watchInstance(instanceId, healthCheck.healthCheck);
        } else if (healthCheck.healthCheck.type === 'ping') {
          this.pingHealthCheckManager.watchInstance(instanceId, healthCheck.healthCheck);
        } else {
          logger.warn(`unknown health check type ${(healthCheck.healthCheck as any).type} associated with task instance ${instanceId}`);
        }
      } else {
        // should never happen.
        logger.error(`failed to find instance for health check on task ${healthCheck.taskId} version ${healthCheck.version}`);
      }
    }
  }
}
