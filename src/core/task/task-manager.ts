import { AgentSideTaskStatus, LaunchTaskInstanceResult, NewTaskEvent, ReplacementVariables, TaskAgent } from '../../models';

export interface AgentHandler {
  handleTaskEvent(event: NewTaskEvent): Promise<void>;
  handleTaskInstanceStatus(taskInstanceId: string, status: AgentSideTaskStatus): Promise<void>;
  handleTaskInstancePid(taskInstanceId: string, pid: number): Promise<void>;
  handleAgentStatus(agentId: string, name: string): Promise<void>;
}

export interface TaskManager extends AgentHandler {
  init(): Promise<void>;

  terminate(): Promise<void>;

  /**
   * externally request to launch a task, it can be a job or a service.
   * @param taskId
   * @param taskAgentIds
   * @param arguments_ launch the task with additional arguments
   */
  launchTask(taskId: string, taskAgentIds: string[], arguments_?: string[]): Promise<LaunchTaskInstanceResult[]>;

  /**
   * externally request to terminate a task instance, it can be a job instance or a service instance
   * @param instanceId
   */
  terminateTaskInstance(instanceId: string): Promise<void>;

  listTaskAgents(): Promise<TaskAgent[]>;
  /**
   * externally request to terminate a task agent.
   * @param agentId
   */
  terminateTaskAgent(agentId: string): Promise<void>;

  /**
   * the method is periodically called to launch jobs whose derived next launch fall between the window.
   * @param window the window size must be less than or equal to the minimum job duration.
   */
  launchJobs(window: [number, number]): Promise<LaunchTaskInstanceResult[]>;

  resetReplacementVariables(variables: ReplacementVariables): Promise<void>;

  listReplacementVariables(): Promise<ReplacementVariables>;
}
