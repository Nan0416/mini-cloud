import { MiniCloudClient, WsSubscriber } from '@mini-cloud/client';
import {
  AGENT_BROADCAST_TOPIC,
  AgentCommand,
  AgentReportedStatus,
  AsyncQueue,
  EventEnvelope,
  HealthCheck,
  LaunchInstruction,
  LoggerFactory,
  ReplacementVariables,
  TaskEventLevel,
  agentTopic,
  substituteLaunchFields,
} from '@mini-cloud/shared';
import { mkdir } from 'fs/promises';
import os from 'os';
import path from 'path';
import { AgentConfig, offlineReportPath, stderrDir, stdoutDir } from './agent-config';
import { HealthMonitor, healthCheckPeriodMs } from './health/health-monitor';
import { OfflineReportReplayer } from './offline-report-replayer';
import { ReporterServer } from './reporter-endpoints';
import { TaskLauncher } from './task-launcher';

const logger = LoggerFactory.getLogger('Agent');

/**
 * The mini-cloud worker process.
 *
 * Commands arrive over a WebSocket and reports go back over HTTP. That split is
 * deliberate: commands are one-way and need push delivery, while a report needs an
 * acknowledgement it can retry, which request/response gives and a publish does not.
 */
export class MiniCloudAgent {
  private readonly config: AgentConfig;
  private readonly client: MiniCloudClient;
  private readonly subscriber: WsSubscriber;
  private readonly launcher = new TaskLauncher();
  private readonly healthMonitor: HealthMonitor;
  private readonly reporterServer: ReporterServer;
  private readonly replayer: OfflineReportReplayer;
  private readonly commandQueue: AsyncQueue<AgentCommand>;

  /** Health checks for instances that have launched but not yet reported a pid. */
  private readonly pendingHealthChecks = new Map<string, HealthCheck>();

  private agentUrl = '';
  private heartbeatTimer?: NodeJS.Timeout;
  private healthTimer?: NodeJS.Timeout;
  private stopping = false;
  private onShutdownRequest?: () => void;

  constructor(config: AgentConfig) {
    this.config = config;
    this.client = new MiniCloudClient({ baseUrl: config.serviceUrl, token: config.token });
    this.healthMonitor = new HealthMonitor({
      passiveToleranceMs: config.passiveToleranceMs,
      pingFailureThreshold: config.pingFailureThreshold,
    });
    this.reporterServer = new ReporterServer({
      onPid: (instanceId, pid) => this.handleTaskPid(instanceId, pid),
      onTermination: (instanceId) => this.handleTaskTermination(instanceId),
      onExit: (instanceId, code) => this.handleTaskExit(instanceId, code),
      onEvent: (instanceId, level, payload, timestamp) => this.handleTaskEvent(instanceId, level, payload, timestamp),
      onHealthCheck: async (instanceId) => this.healthMonitor.recordHeartbeat(instanceId),
    });
    this.replayer = new OfflineReportReplayer(offlineReportPath(config));

    // Commands are applied one at a time and in order: a terminate that overtook its
    // own launch would try to signal a pid that did not exist yet.
    this.commandQueue = new AsyncQueue<AgentCommand>((command) => this.applyCommand(command));

    const wsUrl = `${config.serviceUrl.replace(/^http/, 'ws').replace(/\/+$/, '')}/ws`;
    this.subscriber = new WsSubscriber({
      url: wsUrl,
      token: config.token,
      onEvent: (envelope) => this.onEnvelope(envelope),
      onStateChange: (state) => logger.info(`Connection to the service is ${state}.`),
    });
  }

  static async start(config: AgentConfig): Promise<MiniCloudAgent> {
    const agent = new MiniCloudAgent(config);
    await agent.start();
    return agent;
  }

  /** Resolves when the service asks this agent to shut down. */
  waitForShutdownRequest(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.onShutdownRequest = resolve;
    });
  }

  private async start(): Promise<void> {
    const { config } = this;
    logger.info(`Starting agent ${config.agentId} ("${config.name}") against ${config.serviceUrl}.`);

    await Promise.all([mkdir(stdoutDir(config), { recursive: true }), mkdir(stderrDir(config), { recursive: true }), mkdir(config.workDir, { recursive: true })]);

    const boundPort = await this.reporterServer.start(config.port);
    this.agentUrl = `http://127.0.0.1:${boundPort}`;

    // Subscribe before announcing ourselves. The service treats "no subscriber on
    // the agent's topic" as offline, so heartbeating first would open a window where
    // it believes we are available and a launch is dispatched into nothing.
    await this.subscriber.connect();
    await this.subscriber.subscribe(agentTopic(config.agentId));
    await this.subscriber.subscribe(AGENT_BROADCAST_TOPIC);

    await this.replayer.replay({
      onPid: (instanceId, pid) => this.handleTaskPid(instanceId, pid),
      onTermination: (instanceId) => this.handleTaskTermination(instanceId),
      onExit: (instanceId, code) => this.handleTaskExit(instanceId, code),
      onEvent: (instanceId, level, payload, timestamp) => this.handleTaskEvent(instanceId, level, payload, timestamp),
    });

    await this.sendHeartbeat();
    await this.resumeHealthChecks();

    this.heartbeatTimer = setInterval(() => void this.sendHeartbeat(), config.heartbeatIntervalMs);
    this.healthTimer = setInterval(() => void this.runHealthChecks(), config.healthCheckTickMs);

    logger.info(`Agent ${config.agentId} is ready.`);
  }

  async stop(): Promise<void> {
    if (this.stopping) {
      return;
    }
    this.stopping = true;
    logger.info('Stopping agent.');

    for (const timer of [this.heartbeatTimer, this.healthTimer]) {
      if (timer !== undefined) {
        clearInterval(timer);
      }
    }
    // Finish any command already in flight rather than abandoning a half-done launch.
    await this.commandQueue.drain();
    await this.subscriber.close();
    await this.reporterServer.stop();
    logger.info('Agent stopped. Tasks it launched keep running.');
  }

  // ---- commands from the service ----

  private onEnvelope(envelope: EventEnvelope): void {
    const command = this.toCommand(envelope.payload);
    if (command === undefined) {
      logger.warn(`Ignoring an unrecognised message on topic ${envelope.topic}.`);
      return;
    }
    this.commandQueue.enqueue(command);
  }

  private toCommand(payload: unknown): AgentCommand | undefined {
    if (typeof payload !== 'object' || payload === null) {
      return undefined;
    }
    const record: Record<string, unknown> = { ...payload };
    const type = record['type'];
    if (type === 'launch-instance' || type === 'terminate-instance' || type === 'terminate-agent' || type === 'request-heartbeat') {
      // Narrowed by the discriminant; the service is the only publisher on these
      // topics and both sides share the AgentCommand definition.
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- transport boundary, discriminant checked above.
      return payload as AgentCommand;
    }
    return undefined;
  }

  private async applyCommand(command: AgentCommand): Promise<void> {
    switch (command.type) {
      case 'launch-instance':
        await this.launchInstance(command.instruction);
        return;
      case 'terminate-instance':
        await this.terminateInstance(command.instanceId, command.pid);
        return;
      case 'request-heartbeat':
        await this.sendHeartbeat();
        return;
      case 'terminate-agent':
        logger.info('The service asked this agent to shut down.');
        this.onShutdownRequest?.();
        return;
    }
  }

  private async launchInstance(instruction: LaunchInstruction): Promise<void> {
    const resolved = this.resolveHostVariables(instruction);
    try {
      await this.launcher.launch(resolved, {
        agentId: this.config.agentId,
        agentUrl: this.agentUrl,
        offlineReportPath: offlineReportPath(this.config),
        healthCheckPeriodMs: resolved.healthCheck?.type === 'passive' ? healthCheckPeriodMs(resolved.healthCheck) : undefined,
      });

      if (resolved.healthCheck !== undefined) {
        // Held until the task reports a pid: checking a process that has not
        // finished starting would report it unhealthy for doing nothing wrong.
        this.pendingHealthChecks.set(resolved.instanceId, resolved.healthCheck);
      }

      await this.report(resolved.instanceId, 'launched', 'success', `Agent ${this.config.agentId} spawned the process.`);
    } catch (err) {
      const message = `Agent ${this.config.agentId} could not spawn the process: ${err instanceof Error ? err.message : String(err)}`;
      logger.error(message, err);
      await this.report(resolved.instanceId, 'failed_to_launch', 'error', message);
    }
  }

  private async terminateInstance(instanceId: string, pid: number): Promise<void> {
    this.stopWatching(instanceId);
    try {
      // SIGINT rather than SIGKILL: tasks are expected to shut down cleanly and
      // report their own termination.
      process.kill(pid, 'SIGINT');
      await this.report(instanceId, 'terminating', 'success', `Sent SIGINT to pid ${pid}.`);
    } catch (err) {
      const code = typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined;
      if (code === 'ESRCH') {
        // No such process: it already exited, so the requested end state holds.
        await this.report(instanceId, 'terminated', 'success', `Pid ${pid} was already gone.`);
        return;
      }
      const message = `Could not signal pid ${pid}: ${code ?? (err instanceof Error ? err.message : String(err))}`;
      logger.error(message);
      await this.report(instanceId, 'agent_termination_failed', 'error', message);
    }
  }

  // ---- reports from tasks ----

  private async handleTaskPid(instanceId: string, pid: number): Promise<void> {
    await this.safely(`report pid for ${instanceId}`, async () => {
      await this.client.reportInstancePid({ instanceId, pid });
      await this.client.reportInstanceStatus({ instanceId, status: 'running' });
    });

    const check = this.pendingHealthChecks.get(instanceId);
    if (check !== undefined) {
      this.pendingHealthChecks.delete(instanceId);
      this.healthMonitor.watch(instanceId, check);
    }
  }

  private async handleTaskTermination(instanceId: string): Promise<void> {
    this.stopWatching(instanceId);
    await this.safely(`report termination for ${instanceId}`, () => this.client.reportInstanceStatus({ instanceId, status: 'terminated' }).then(() => undefined));
  }

  private async handleTaskExit(instanceId: string, code: number): Promise<void> {
    this.stopWatching(instanceId);
    const status: AgentReportedStatus = code === 0 ? 'exit_success' : 'exit_failure';
    await this.report(instanceId, status, code === 0 ? 'success' : 'error', `Process exited with code ${code}.`);
  }

  private async handleTaskEvent(instanceId: string, level: TaskEventLevel, payload: unknown, timestamp: number): Promise<void> {
    await this.safely(`forward an event for ${instanceId}`, async () => {
      await this.client.reportTaskEvent({
        instanceId,
        source: 'task',
        timestamp,
        level,
        format: typeof payload === 'string' ? 'string' : 'json',
        payload,
      });
    });
  }

  // ---- background work ----

  private async sendHeartbeat(): Promise<void> {
    await this.safely('send a heartbeat', async () => {
      await this.client.heartbeat({ agentId: this.config.agentId, name: this.config.name });
    });
  }

  private async runHealthChecks(): Promise<void> {
    const transitions = await this.healthMonitor.check();
    for (const transition of transitions) {
      if (transition.health === 'unhealthy') {
        await this.report(transition.instanceId, 'health_check_failure', 'error', 'The instance stopped passing its health check.');
      } else {
        await this.report(transition.instanceId, 'running', 'success', 'The instance is passing its health check again.');
      }
    }
  }

  /**
   * After a restart the agent has forgotten what it was watching, but the tasks are
   * still running — they were spawned detached. Ask the service which instances it
   * believes are ours and resume checking the ones that have a health check.
   */
  private async resumeHealthChecks(): Promise<void> {
    await this.safely('resume health checks', async () => {
      const { instances } = await this.client.listTaskInstances({ agentId: this.config.agentId, status: 'running' });
      if (instances.length === 0) {
        return;
      }
      logger.info(`Resuming supervision of ${instances.length} instance(s) that survived the restart.`);

      const { healthChecks } = await this.client.listHealthChecks({
        taskIdentifiers: instances.map((instance) => ({ taskId: instance.taskId, version: instance.taskVersion })),
      });

      for (const instance of instances) {
        const match = healthChecks.find((check) => check.taskId === instance.taskId && check.version === instance.taskVersion);
        if (match !== undefined) {
          this.healthMonitor.watch(instance.instanceId, match.healthCheck);
        }
      }
    });
  }

  // ---- helpers ----

  /**
   * Host-local `${...}` values, applied on top of the fleet-wide substitution the
   * service already performed. This is what lets one task definition target machines
   * with different home directories.
   */
  private resolveHostVariables(instruction: LaunchInstruction): LaunchInstruction {
    const variables: ReplacementVariables = {
      HOME: os.homedir(),
      HOSTNAME: os.hostname(),
      AGENT_ID: this.config.agentId,
      AGENT_NAME: this.config.name,
      AGENT_DIR: this.config.workDir,
      STDOUT_DIR: stdoutDir(this.config),
      STDERR_DIR: stderrDir(this.config),
      INSTANCE_ID: instruction.instanceId,
      TASK_ID: instruction.taskId,
    };

    const resolved = substituteLaunchFields(instruction, variables);
    // Default the stdio destinations rather than discarding output: a task that
    // fails at startup is impossible to debug if its stderr went to /dev/null.
    return {
      ...resolved,
      stdout: resolved.stdout ?? path.join(stdoutDir(this.config), `${instruction.taskId}-${instruction.instanceId}.log`),
      stderr: resolved.stderr ?? path.join(stderrDir(this.config), `${instruction.taskId}-${instruction.instanceId}.log`),
    };
  }

  private stopWatching(instanceId: string): void {
    this.healthMonitor.unwatch(instanceId);
    this.pendingHealthChecks.delete(instanceId);
  }

  private async report(instanceId: string, status: AgentReportedStatus, level: TaskEventLevel, message: string): Promise<void> {
    await this.safely(`report "${status}" for ${instanceId}`, async () => {
      await this.client.reportInstanceStatus({ instanceId, status });
      await this.client.reportTaskEvent({ instanceId, source: 'agent', timestamp: Date.now(), level, format: 'string', payload: message });
    });
  }

  /**
   * The service being unreachable must never take the agent down or abort a launch
   * that already succeeded locally — the running process is the source of truth, and
   * the service catches up on the next report.
   */
  private async safely(description: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      logger.warn(`Failed to ${description}.`, err);
    }
  }
}
