import { LaunchInstruction, LoggerFactory, REPORTER_ENV } from '@mini-cloud/shared';
import { SpawnOptions, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Writable } from 'node:stream';

const logger = LoggerFactory.getLogger('TaskLauncher');

/**
 * Variables from the agent's own environment that a launched task inherits.
 *
 * An allowlist rather than a copy of `process.env`: the agent's environment holds
 * the service token and its own identity, and a task should not silently inherit
 * either. Everything else a task needs comes from its own `env`.
 */
const INHERITED_ENV_KEYS: ReadonlyArray<string> = ['PATH', 'HOME', 'SHELL', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'TZ'];

export interface LaunchOptions {
  readonly agentId: string;
  readonly agentUrl: string;
  readonly offlineReportPath: string;
  /** Set when the task has a passive health check, so the reporter knows the cadence. */
  readonly healthCheckPeriodMs?: number;
}

export interface LaunchOutcome {
  /** Pid of the spawned shell. The task reports its own pid, which may differ. */
  readonly pid?: number;
}

export class TaskLauncher {
  /**
   * Spawns the task detached, with stdio redirected to files.
   *
   * Detaching is what lets a task outlive the agent: restarting or upgrading the
   * agent must not take down the services it is supervising. The consequence is that
   * the agent cannot observe the exit itself, which is why a task reports its own
   * lifecycle through `@mini-cloud/reporter`.
   */
  async launch(instruction: LaunchInstruction, options: LaunchOptions): Promise<LaunchOutcome> {
    logger.info(`Launching instance ${instruction.instanceId}: ${instruction.cmd} ${(instruction.arguments ?? []).join(' ')} (cwd ${instruction.cwd})`);

    const [stdout, stderr] = await Promise.all([this.openStdio(instruction.stdout), this.openStdio(instruction.stderr)]);

    const env: Record<string, string> = {};
    for (const key of INHERITED_ENV_KEYS) {
      const value = process.env[key];
      if (typeof value === 'string') {
        env[key] = value;
      }
    }
    Object.assign(env, instruction.env ?? {});

    // Injected last so a task cannot overwrite its own identity through `env`.
    env[REPORTER_ENV.instanceId] = instruction.instanceId;
    env[REPORTER_ENV.taskId] = instruction.taskId;
    env[REPORTER_ENV.taskVersion] = String(instruction.version);
    env[REPORTER_ENV.agentId] = options.agentId;
    env[REPORTER_ENV.agentUrl] = options.agentUrl;
    env[REPORTER_ENV.offlineReportPath] = options.offlineReportPath;
    if (options.healthCheckPeriodMs !== undefined) {
      env[REPORTER_ENV.healthCheckPeriodMs] = String(options.healthCheckPeriodMs);
    }

    const spawnOptions: SpawnOptions = {
      cwd: instruction.cwd,
      // A shell gives tasks the `cmd arg arg` form people already write in scripts.
      shell: true,
      stdio: ['ignore', stdout ?? 'ignore', stderr ?? 'ignore'],
      detached: true,
      env,
    };

    const child = spawn(instruction.cmd, [...(instruction.arguments ?? [])], spawnOptions);

    // Release the child from the agent's event loop; without this the agent could
    // not exit while any task it started was still running.
    child.unref();

    child.on('error', (err) => {
      logger.error(`Failed to spawn instance ${instruction.instanceId}.`, err);
    });

    logger.info(`Spawned instance ${instruction.instanceId} as pid ${child.pid}.`);
    return { pid: child.pid };
  }

  private async openStdio(filePath?: string): Promise<Writable | undefined> {
    if (filePath === undefined) {
      return undefined;
    }
    await mkdir(path.dirname(filePath), { recursive: true });
    const stream = createWriteStream(filePath, { flags: 'a' });
    // Wait for the fd: passing an unopened stream to spawn loses early output.
    await new Promise<void>((resolve, reject) => {
      stream.once('open', () => resolve());
      stream.once('error', (err) => reject(err));
    });
    return stream;
  }
}
