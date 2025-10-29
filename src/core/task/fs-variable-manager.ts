import { LoggerFactory } from '@ultrasa/dev-kit';
import { HealthCheck, ReplacementVariables, Task } from '@ultrasa/mini-cloud-models';
import { readFileSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import lodash from 'lodash';
import path from 'path';
import { VariableManager } from './variable-manager';

export interface KeyValuePair {
  readonly key: string;
  readonly value: string;
}

export interface RegKeyValuePair {
  readonly key: RegExp;
  readonly value: string;
}

const logger = LoggerFactory.getLogger('FsVariableManager');
export class FsVariableManager implements VariableManager {
  private replacementVariables: ReplacementVariables;
  private regexVariables: RegKeyValuePair[];
  private readonly variablesPath: string;

  constructor(variablesPath: string) {
    this.variablesPath = variablesPath;
    this.replacementVariables = {};
    this.regexVariables = [];

    try {
      const data = readFileSync(this.variablesPath, { encoding: 'utf-8' });
      this.replacementVariables = JSON.parse(data);
      this.regexVariables = this.buildRegexVariables(this.replacementVariables);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        logger.error(`Failed to read in variables from path ${this.variablesPath}`);
        throw err;
      } else {
        // the file doesn't exist, the path may also doesn't exit.
        mkdirSync(path.dirname(this.variablesPath), { recursive: true });
      }
    }
  }

  async reset(variables: ReplacementVariables): Promise<void> {
    logger.info('Reset variables.');
    await writeFile(this.variablesPath, JSON.stringify(variables, null, 2), {
      encoding: 'utf-8',
      // default mode is to create if doesn't exist.
    });

    this.replacementVariables = { ...variables };
    this.regexVariables = this.buildRegexVariables(variables);
  }

  async list(): Promise<ReplacementVariables> {
    return this.replacementVariables;
  }

  private buildRegexVariables(variables: ReplacementVariables): RegKeyValuePair[] {
    const results: RegKeyValuePair[] = [];
    lodash.forOwn(variables, (v, k) => {
      results.push({
        key: new RegExp('\\$\\{' + k + '\\}', 'g'), // g matches all.
        value: v,
      });
    });
    return results;
  }

  async replace(task: Task): Promise<Task> {
    const newArguments = task.arguments?.map((arg) => this.replaceString(arg));
    const newEnv: { [key: string]: string } = {};

    if (task.env) {
      lodash.forOwn(task.env, (v, k) => {
        newEnv[k] = this.replaceString(v);
      });
    }

    if (task.type === 'job') {
      return {
        ...task,
        cmd: this.replaceString(task.cmd),
        cwd: this.replaceString(task.cwd),
        arguments: newArguments,
        stderr: task.stderr ? this.replaceString(task.stderr) : undefined,
        stdout: task.stdout ? this.replaceString(task.stdout) : undefined,
        env: newEnv,
      };
    } else if (task.type === 'service') {
      return {
        ...task,
        cmd: this.replaceString(task.cmd),
        cwd: this.replaceString(task.cwd),
        arguments: newArguments,
        stderr: task.stderr ? this.replaceString(task.stderr) : undefined,
        stdout: task.stdout ? this.replaceString(task.stdout) : undefined,
        env: newEnv,
        healthCheck: task.healthCheck ? this.replaceHealthCheck(task.healthCheck) : undefined,
      };
    } else {
      logger.warn(`Failed to replace variable due to unknown task type ${(task as any).type}.`);
      return task;
    }
  }

  private replaceHealthCheck(healthCheck: HealthCheck) {
    if (healthCheck.type === 'ping') {
      return {
        ...healthCheck,
        domain: this.replaceString(healthCheck.domain),
        path: healthCheck.path ? this.replaceString(healthCheck.path) : undefined,
      };
    } else {
      return healthCheck;
    }
  }

  private replaceString(input: string): string {
    let result = input;
    for (let i = 0; i < this.regexVariables.length; i++) {
      result = result.replace(this.regexVariables[i].key, this.regexVariables[i].value);
    }
    return result;
  }
}
