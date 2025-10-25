import { AgentSideTaskStatus, NewTaskEvent } from '../task-agent';

/**
 * service's side facade to handle agent request.
 */
export interface AgentHandler {
  handleTaskEvent(event: NewTaskEvent): Promise<void>;
  handleTaskInstanceStatus(taskInstanceId: string, status: AgentSideTaskStatus): Promise<void>;
  handleTaskInstancePid(taskInstanceId: string, pid: number): Promise<void>;
  handleAgentStatus(agentId: string, name: string): Promise<void>;
}
