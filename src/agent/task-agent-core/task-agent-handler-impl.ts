import { LoggerFactory } from '@sparrow/logging-js';
import {
  AgentSideTaskStatus,
  HealthCheck,
  OfflineTaskReport,
  ReportEventRequest,
  ReportEventResponse,
  ReportExitRequest,
  ReportExitResponse,
  ReportPassiveHealthCheckRequest,
  ReportPassiveHealthCheckResponse,
  ReportPidRequest,
  ReportPidResponse,
  ReportTerminationRequest,
  ReportTerminationResponse,
  TaskClientForAgent,
  TaskEventLevel,
  TaskIdentifier,
  TaskInstance,
} from '../../models';
import { InternalLaunchTaskInstanceRequest } from './internal-models';
import { PassiveHealthCheckManager } from './passive-health-check-manager';
import { PingHealthCheckManager } from './ping-health-check-manager';
import { TaskLauncher } from './task-launcher';
import { VariableReplacement } from './variable-replacement';
import { readFile, unlink } from 'fs/promises';
import { HealthCheckResult } from './health-check-manager';
import { healthCheckResultsDelta } from './utilities';
import { TaskAgentHandler } from './task-agent-handler';
import {
  GetAgentStatusRequest,
  GetAgentStatusResponse,
  LaunchTaskInstanceRequest,
  LaunchTaskInstanceResponse,
  TerminateAgentRequest,
  TerminateAgentResponse,
  TerminateTaskInstanceRequest,
  TerminateTaskInstanceResponse,
} from '../../models/clients/task-agent-client';

const logger = LoggerFactory.getLogger('TaskAgentHandlerImpl');

export interface TaskAgentHandlerProps {
  readonly agentId: string;
  readonly agentName: string;
  readonly client: TaskClientForAgent;
  readonly taskLauncher: TaskLauncher;
  readonly variableReplacement: VariableReplacement;
  readonly passiveHealthCheckManager: PassiveHealthCheckManager;
  readonly pingHealthCheckManager: PingHealthCheckManager;
  readonly offlineReportPath: string;
}

export class TaskAgentHandlerImpl implements TaskAgentHandler {
  private readonly agentId: string;
  private readonly agentName: string;
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
    this.agentId = props.agentId;
    this.agentName = props.agentName;
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
    logger.info(`Loading event when the agent is offline.`);
    const offlineReports = await this.loadOfflineReports();
    logger.info(`Found ${offlineReports.length} reports.`);
    await this.populateOfflineReports(offlineReports);
    await this.cleanOfflineReports();

    logger.info('Initialize task agent facade, loading current running instances on the agent.');
    const { taskInstances } = await this.client.listRunningInstances({ agentId: this.agentId });
    logger.info(`Found ${taskInstances.length} running instances, intialize their health check.`);
    await this.initializeRunningInstanceHealthCheck(taskInstances);

    logger.info('Set up recurrent agent status report and task health checks.');
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

  async terminateAgent(request: TerminateAgentRequest): Promise<TerminateAgentResponse> {
    logger.info('Perform self termination.');
    process.kill(process.pid, 'SIGINT');
    return {};
  }

  /**
   * replace variables, launch the task, track health check, report instance status.
   * @param launchRequest
   */
  async launchTaskInstance(request: LaunchTaskInstanceRequest): Promise<LaunchTaskInstanceResponse> {
    try {
      logger.info(`Launch task ${request.taskId} version ${request.version} with assigned task instance id ${request.taskInstanceId}`);
      const internalRequest = this.convertLaunchTaskInstanceRequestToInternalLaunchTaskInstanceRequest(request);
      const requestAfterReplacement = await this.variableReplacement.replace(internalRequest);
      await this.taskLauncher.launch(requestAfterReplacement);
      const message = `Successfully launched task instance ${request.taskInstanceId}`;
      logger.info(message);
      await this.reportStatusAndEvent(request.taskInstanceId, 'launched', 'success', message);

      if (request.healthCheck) {
        this.instanceIdToHealthCheck.set(request.taskInstanceId, request.healthCheck);
      }
    } catch (err: any) {
      const message = `Failed to launch task instance ${request.taskInstanceId}.`;
      logger.error(message, err);
      await this.reportStatusAndEvent(request.taskInstanceId, 'failed_to_launch', 'error', message);
    }

    return {};
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
  async terminateTaskInstance(request: TerminateTaskInstanceRequest): Promise<TerminateTaskInstanceResponse> {
    logger.info(`terminate task instance ${request.taskInstanceId} pid ${request.pid}`);
    try {
      process.kill(request.pid, 'SIGINT');
      this.stopInstanceHealthCheck(request.taskInstanceId);
      const message = `successfully send SIGINT signal to pid ${request.pid}`;
      logger.info(message);
      await this.reportStatusAndEvent(request.taskInstanceId, 'terminating', 'success', message);
    } catch (err: any) {
      // no permission, etc.
      if (err.code === 'ESRCH') {
        // assume the process is successfully terminated if no such process.
        this.stopInstanceHealthCheck(request.taskInstanceId);
        const message = `pid ${request.pid} doesn't exist`;
        logger.info(message);
        await this.reportStatusAndEvent(request.taskInstanceId, 'terminated', 'success', message);
      } else {
        const message = `failed to send SIGINT signal to pid ${request.pid} due to ${err.code}`;
        logger.error(message);
        await this.reportStatusAndEvent(request.taskInstanceId, 'agent_termination_failed', 'error', message);
      }
    }

    return {};
  }

  async getAgentStatus(request: GetAgentStatusRequest): Promise<GetAgentStatusResponse> {
    logger.info('Received agent status request.');
    await this.client.reportAgentStatus({
      agentId: this.agentId,
      name: this.agentName,
    });
    return {};
  }

  /**
   * Task instance's task reporter calls the method to report its pid, and this method will report it to the task service.
   * @param instanceId
   * @param pid
   */
  async reportPid(request: ReportPidRequest): Promise<ReportPidResponse> {
    logger.info(`Received instance ${request.taskInstanceId} pid report, ${request.pid}, update task status to running and start health check`);
    await this.client.reportTaskInstancePid({
      taskInstanceId: request.taskInstanceId,
      pid: request.pid,
    });
    await this.client.reportTaskInstanceStatus({
      taskInstanceId: request.taskInstanceId,
      status: 'running',
    });

    const healthCheck = this.instanceIdToHealthCheck.get(request.taskInstanceId);
    if (healthCheck !== undefined) {
      logger.info(`Start instance ${request.taskInstanceId} health check`);
      if (healthCheck.type === 'passive') {
        this.passiveHealthCheckManager.watchInstance(request.taskInstanceId, healthCheck);
      } else if (healthCheck.type === 'ping') {
        this.pingHealthCheckManager.watchInstance(request.taskInstanceId, healthCheck);
      } else {
        logger.warn(`Unknown health check type ${(healthCheck as any).type} associated with task instance ${request.taskInstanceId}`);
      }
    }

    return {};
  }

  async reportTermination(request: ReportTerminationRequest): Promise<ReportTerminationResponse> {
    logger.info(`Report instance ${request.taskInstanceId} termination to task service.`);
    this.stopInstanceHealthCheck(request.taskInstanceId);
    await this.client.reportTaskInstanceStatus({
      taskInstanceId: request.taskInstanceId,
      status: 'terminated',
    });
    return {};
  }

  async reportExit(request: ReportExitRequest): Promise<ReportExitResponse> {
    logger.info(`Report instance ${request.taskInstanceId} exit, code ${request.code}, to task service`);
    this.stopInstanceHealthCheck(request.taskInstanceId);
    await this.client.reportTaskInstanceStatus({
      taskInstanceId: request.taskInstanceId,
      status: request.code === -1 ? 'exit(1)' : 'exit(0)',
    });
    return {};
  }

  private stopInstanceHealthCheck(instanceId: string) {
    this.passiveHealthCheckManager.removeInstance(instanceId);
    this.pingHealthCheckManager.removeInstance(instanceId);
    this.instanceIdToHealthCheck.delete(instanceId);
    this.healthCheckResults.delete(instanceId);
  }

  async reportEvent(request: ReportEventRequest): Promise<ReportEventResponse> {
    logger.info(`Report instance ${request.taskInstanceId} ${request.level} event to task service.`);
    await this.client.reportTaskEvent({
      taskInstanceId: request.taskInstanceId,
      timestamp: request.timestamp,
      source: 'task-instance',
      level: request.level,
      format: typeof request.payload === 'string' ? 'string' : 'json',
      payload: request.payload,
    });

    return {};
  }

  async reportPassiveHealthCheck(request: ReportPassiveHealthCheckRequest): Promise<ReportPassiveHealthCheckResponse> {
    logger.info(`Record task instance ${request.taskInstanceId} passive health check.`);
    this.passiveHealthCheckManager.handlePing(request.taskInstanceId);
    return {};
  }

  private async reportStatusAndEvent(taskInstanceId: string, status: AgentSideTaskStatus, level: TaskEventLevel, message: string) {
    logger.info(`Report task instance ${taskInstanceId} ${status} status and ${level} event.`);
    await this.client.reportTaskInstanceStatus({
      taskInstanceId: taskInstanceId,
      status: status,
    });
    await this.client.reportTaskEvent({
      taskInstanceId: taskInstanceId,
      source: 'task-agent',
      timestamp: Date.now(),
      level: level,
      format: 'string',
      payload: message,
    });
  }

  private async backgroundTask() {
    logger.debug('Running health check.');
    let latestHealthCheckResults: ReadonlyArray<HealthCheckResult> = [];
    latestHealthCheckResults = latestHealthCheckResults.concat(await this.passiveHealthCheckManager.healthCheck(this.healthCheckResults));
    latestHealthCheckResults = latestHealthCheckResults.concat(await this.pingHealthCheckManager.healthCheck(this.healthCheckResults));

    const delta = healthCheckResultsDelta(this.healthCheckResults, latestHealthCheckResults);
    const newHealthCheckResults = new Map();
    latestHealthCheckResults.forEach((v) => newHealthCheckResults.set(v.instanceId, v.result));
    this.healthCheckResults = newHealthCheckResults;

    logger.debug(`Found ${delta.instancesBecomeFailed.length} new instances failed health check and ${delta.instancesBecomeSuccessful.length} instances back online`);

    for (let i = 0; i < delta.instancesBecomeFailed.length; i++) {
      const message = `Task instance ${delta.instancesBecomeFailed[i]} health check failed`;
      logger.info(message);
      await this.reportStatusAndEvent(delta.instancesBecomeFailed[i], 'health_check_failure', 'error', message);
    }

    for (let i = 0; i < delta.instancesBecomeSuccessful.length; i++) {
      const message = `Task instance ${delta.instancesBecomeSuccessful[i]} back online`;
      logger.info(message);
      await this.reportStatusAndEvent(delta.instancesBecomeSuccessful[i], 'running', 'success', message);
    }
  }

  private async loadOfflineReports(): Promise<OfflineTaskReport[]> {
    logger.info(`Read file ${this.offlineReportPath}`);
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
        await this.client.reportTaskInstancePid({
          taskInstanceId: report.instanceId,
          pid: report.pid,
        });
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
          taskInstanceId: report.instanceId,
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

    const { results: healthChecks } = await this.client.listHealthChecks({ taskIdentifiers: taskIdentifiers });
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
