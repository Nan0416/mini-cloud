export interface InternalTaskInstance {
  readonly instanceId: string;
  readonly taskId: string;
  readonly version: number;
  readonly agentId: string;
  readonly pid?: number;
  readonly status: string;
}
