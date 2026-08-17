import { TaskDynamics } from '@mini-cloud/shared';

export interface GetDynamicsInput {
  readonly taskId: string;
}

export interface GetDynamicsOutput {
  readonly dynamics: TaskDynamics | null;
}

export interface SetActiveInput {
  readonly taskId: string;
  readonly active: boolean;
}

export interface SetActiveOutput {
  readonly dynamics: TaskDynamics;
}

export interface SetTargetAgentsInput {
  readonly taskId: string;
  readonly targetAgentIds: ReadonlyArray<string>;
}

export interface SetTargetAgentsOutput {
  readonly dynamics: TaskDynamics;
}

export interface TaskDynamicsDao {
  getDynamics(input: GetDynamicsInput): Promise<GetDynamicsOutput>;

  /** Creates the row with defaults if absent, then applies `active`. */
  setActive(input: SetActiveInput): Promise<SetActiveOutput>;

  /** Creates the row with defaults if absent, then applies `targetAgentIds`. */
  setTargetAgents(input: SetTargetAgentsInput): Promise<SetTargetAgentsOutput>;
}
