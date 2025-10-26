import { InternalLaunchTaskInstanceRequest } from './models';
import lodash from 'lodash';

export interface VariableReplacementConfig {
  readonly home: string;
  readonly projectDir: string;
  readonly stdoutDir: string;
  readonly stderrDir: string;
}
export class VariableReplacement {
  private readonly config: VariableReplacementConfig;

  constructor(config: VariableReplacementConfig) {
    this.config = config;
  }

  async replace(request: InternalLaunchTaskInstanceRequest): Promise<InternalLaunchTaskInstanceRequest> {
    const _arguments = request.arguments?.map((segment) => this.replaceString(segment));
    const newEnv: { [key: string]: string } = {};

    if (request.env) {
      lodash.forOwn(request.env, (v, k) => {
        newEnv[k] = this.replaceString(v);
      });
    }
    return {
      taskId: request.taskId,
      version: request.version,
      instanceId: request.instanceId,
      cmd: this.replaceString(request.cmd),
      cwd: this.replaceString(request.cwd),
      arguments: _arguments,
      env: newEnv,
      stderr: request.stderr ? this.replaceString(request.stderr) : undefined,
      stdout: request.stdout ? this.replaceString(request.stdout) : undefined,
      passiveHealthCheckDuration: request.passiveHealthCheckDuration,
      offlineReportPath: request.offlineReportPath,
    };
  }

  private replaceString(input: string): string {
    let result = input;
    result = result.replace(/\$\{HOME\}/g, this.config.home);
    result = result.replace(/\$\{PROJECT_DIR\}/g, this.config.projectDir);
    result = result.replace(/\$\{STDOUT_DIR\}/g, this.config.stdoutDir);
    result = result.replace(/\$\{STDERR_DIR\}/g, this.config.stderrDir);
    return result;
  }
}
