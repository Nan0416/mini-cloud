export interface InternalTaskDynamics {
  readonly taskId: string;
  // always false for service task.
  readonly active: boolean;
  readonly targetAgentIds: string[];
}
