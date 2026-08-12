import { TaskDynamics } from '@mini-cloud/shared';

export interface TaskDynamicsDao {
  getDynamics(taskId: string): Promise<TaskDynamics | null>;

  /** Creates the row with defaults if absent, then applies `active`. */
  setActive(taskId: string, active: boolean): Promise<TaskDynamics>;

  /** Creates the row with defaults if absent, then applies `targetAgentIds`. */
  setTargetAgents(taskId: string, targetAgentIds: ReadonlyArray<string>): Promise<TaskDynamics>;
}
