import { EnvironmentVariables } from '../../models';

export interface InternalLaunchTaskInstanceRequest {
  readonly taskId: string;
  readonly version: number;
  readonly instanceId: string;
  readonly cmd: string; // support ${keyword} replacement
  readonly cwd: string;
  readonly arguments?: string[];
  readonly env?: EnvironmentVariables;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly passiveHealthCheckDuration?: number;
  readonly offlineReportPath: string;
}
