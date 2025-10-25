import { ExitCode } from '../task-reporter';
import { LaunchTaskInstanceMessage, TaskEventLevel } from '../models';

export interface InstanceEvent {
  readonly instanceId: string;
  readonly timestamp: number;
  readonly level: TaskEventLevel;
  readonly payload: any;
}

/**
 * Implemented by task agent, and run in task agent.
 *
 * The facade receives
 * * requests from local task instances.
 * * requests from remote task service through websocket
 */
export interface TaskAgentFacade {
  init(): Promise<void>;

  terminate(): Promise<void>;

  // from task service
  handleLaunchRequest(launchRequest: LaunchTaskInstanceMessage): Promise<void>;

  handleTerminationRequest(instanceId: string, pid: number): Promise<void>;

  handleAgentStatusRequest(): Promise<void>;

  terminateAgent(): Promise<void>;

  // from task instance
  reportPid(instanceId: string, pid: number): Promise<void>;

  reportTermination(instanceId: string): Promise<void>;

  reportExit(instanceId: string, code?: ExitCode): Promise<void>;

  reportEvent(event: InstanceEvent): Promise<void>;

  handleHealthCheck(instanceId: string): Promise<void>;
}
