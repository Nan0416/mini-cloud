export interface InternalTask {
  readonly taskId: string;
  readonly version: number;

  readonly name: string;
  readonly description?: string;

  readonly type: string;
  readonly cmd: string;
  readonly cwd: string;

  readonly duration?: number;
  // undefined for service and no auto launch job
  readonly firstLaunchAt?: number;

  readonly stdout?: string;
  readonly stderr?: string;
  readonly blob: string; // serialized blob
}
