import { EnvironmentVariables } from '../../models/models/task-types/common';
import { HealthCheck } from '../task/service';

export interface LaunchTaskInstanceRequest {
  readonly taskId: string;
  readonly version: number;
  readonly taskInstanceId: string;
  readonly cmd: string; // support ${keyword} replacement
  readonly cwd: string;
  readonly arguments?: string[];
  readonly env?: EnvironmentVariables;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly healthCheck?: HealthCheck;
}

/**
 *
 * service -> task agent
 * used by task service
 */
export interface AgentController {
  /**
   * send (broadcast) request to the agent to launch the task
   * @param agentId
   * @param request
   */
  launch(agentId: string, request: LaunchTaskInstanceRequest): Promise<void>;

  terminate(agentId: string, taskInstanceId: string, pid: number): Promise<void>;

  terminateAgent(agentId: string): Promise<void>;

  /**
   *
   * @param agentId if undefined, then request all
   */
  requestAgentStatus(agentId?: string): Promise<void>;
}
