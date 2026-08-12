import { CreateTaskRequest, HealthCheck, InvalidRequestError, Task, UpdateTaskRequest } from '@mini-cloud/shared';
import { Command } from 'commander';
import { collect, parseDuration, parseKeyValues, parsePositiveInteger, parseTimestamp } from '../args';
import { GlobalOptions, createClient } from '../client-factory';
import { Column, formatDuration, formatTimestamp, printJson, printTable, truncate } from '../output';

const TASK_COLUMNS: ReadonlyArray<Column<Task>> = [
  { header: 'TASK ID', value: (task) => task.taskId },
  { header: 'V', value: (task) => String(task.version) },
  { header: 'TYPE', value: (task) => task.type },
  { header: 'NAME', value: (task) => truncate(task.name, 28) },
  { header: 'SCHEDULE', value: (task) => (task.type === 'job' ? describeSchedule(task.duration, task.firstLaunchAt) : '-') },
  { header: 'COMMAND', value: (task) => truncate([task.cmd, ...(task.arguments ?? [])].join(' '), 44) },
];

function describeSchedule(duration?: number, firstLaunchAt?: number): string {
  if (firstLaunchAt === undefined) {
    return 'manual';
  }
  if (duration === undefined) {
    return `once at ${formatTimestamp(firstLaunchAt)}`;
  }
  return `every ${formatDuration(duration)}`;
}

function describeHealthCheck(check: HealthCheck): string {
  if (check.type === 'ping') {
    return `ping ${check.url} every ${formatDuration(check.periodInMs ?? 5_000)}`;
  }
  return `passive heartbeat every ${formatDuration(check.periodInMs ?? 5_000)}`;
}

interface WriteTaskOptions {
  readonly name: string;
  readonly description?: string;
  readonly type: string;
  readonly cmd: string;
  readonly cwd: string;
  readonly arg: string[];
  readonly env: string[];
  readonly stdout?: string;
  readonly stderr?: string;
  readonly every?: string;
  readonly at?: string;
  readonly healthPing?: string;
  readonly healthPassive?: string;
  readonly healthPeriod?: string;
}

/** The create and update flags are identical, so they are declared once. */
function addWriteTaskOptions(command: Command): Command {
  return command
    .requiredOption('--name <name>', 'human-readable name')
    .requiredOption('--cmd <command>', 'executable or shell command to run')
    .option('--type <type>', 'job (runs to completion) or service (stays up)', 'job')
    .option('--cwd <dir>', 'working directory', process.cwd())
    .option('--arg <value>', 'argument to pass; repeat for several', collect, [])
    .option('--env <KEY=VALUE>', 'environment variable; repeat for several', collect, [])
    .option('--stdout <path>', 'append stdout here (default: a per-instance file on the agent)')
    .option('--stderr <path>', 'append stderr here (default: a per-instance file on the agent)')
    .option('--description <text>', 'what this task is for')
    .option('--every <duration>', 'job only: relaunch on this interval, e.g. 30s, 5m, 1d')
    .option('--at <when>', 'job only: when the first launch happens (ISO, epoch ms, or "now")')
    .option('--health-ping <url>', 'service only: health-check by polling this URL')
    .option('--health-passive <duration>', 'service only: health-check by heartbeat at this interval')
    .option('--health-period <duration>', 'service only: how often to poll, for --health-ping');
}

function buildTaskFields(options: WriteTaskOptions): CreateTaskRequest {
  if (options.type !== 'job' && options.type !== 'service') {
    throw new InvalidRequestError('--type must be "job" or "service"');
  }

  const common = {
    name: options.name,
    description: options.description,
    cmd: options.cmd,
    cwd: options.cwd,
    arguments: options.arg,
    env: parseKeyValues(options.env, '--env'),
    stdout: options.stdout,
    stderr: options.stderr,
  };

  if (options.type === 'job') {
    if (options.healthPing !== undefined || options.healthPassive !== undefined) {
      throw new InvalidRequestError('health checks apply to services, not jobs. Use --type service.');
    }
    const duration = options.every === undefined ? undefined : parseDuration(options.every, 'every');
    // An interval needs an anchor to repeat from; default it to now so the common
    // case ("run this every 5 minutes") needs one flag rather than two.
    const firstLaunchAt = options.at !== undefined ? parseTimestamp(options.at, 'at') : duration !== undefined ? Date.now() : undefined;
    return { ...common, type: 'job', duration, firstLaunchAt };
  }

  if (options.every !== undefined || options.at !== undefined) {
    throw new InvalidRequestError('--every and --at apply to jobs, not services. A service is launched once and kept running.');
  }
  return { ...common, type: 'service', healthCheck: buildHealthCheck(options) };
}

function buildHealthCheck(options: WriteTaskOptions): HealthCheck | undefined {
  if (options.healthPing !== undefined && options.healthPassive !== undefined) {
    throw new InvalidRequestError('--health-ping and --health-passive are mutually exclusive');
  }
  if (options.healthPing !== undefined) {
    return {
      type: 'ping',
      url: options.healthPing,
      periodInMs: options.healthPeriod === undefined ? undefined : parseDuration(options.healthPeriod, 'health-period'),
    };
  }
  if (options.healthPassive !== undefined) {
    return { type: 'passive', periodInMs: parseDuration(options.healthPassive, 'health-passive') };
  }
  return undefined;
}

export function buildTaskCommand(): Command {
  const task = new Command('task').description('define, inspect and launch tasks');

  task
    .command('list')
    .description('list every task at its latest version')
    .action(async function (this: Command) {
      const global: GlobalOptions = this.optsWithGlobals();
      const { tasks } = await createClient(global).listTasks();
      if (global.json === true) {
        printJson(tasks);
        return;
      }
      printTable(tasks, TASK_COLUMNS, 'No tasks defined yet. Create one with: mini-cloud task create --name ... --cmd ...');
    });

  task
    .command('get')
    .description('show one task, its schedule and its target agents')
    .argument('<taskId>')
    // A positional rather than `--version`: commander reserves `--version` for the
    // program's own version, so a flag by that name would silently print "1.0.0".
    .argument('[version]', 'a specific version instead of the latest', (value) => parsePositiveInteger(value, 'version'))
    .action(async function (this: Command, taskId: string, version: number | undefined) {
      const global: GlobalOptions = this.optsWithGlobals();
      const client = createClient(global);
      const [{ task: found }, { dynamics }] = await Promise.all([client.getTask({ taskId, version }), client.getTaskDynamics({ taskId })]);

      if (global.json === true) {
        printJson({ task: found, dynamics });
        return;
      }

      console.log(`${found.name}  (${found.type} ${found.taskId} v${found.version})`);
      if (found.description !== undefined) {
        console.log(`  ${found.description}`);
      }
      console.log(`  command       ${[found.cmd, ...(found.arguments ?? [])].join(' ')}`);
      console.log(`  directory     ${found.cwd}`);
      console.log(`  stdout        ${found.stdout ?? '(agent default)'}`);
      console.log(`  stderr        ${found.stderr ?? '(agent default)'}`);
      if (found.env !== undefined && Object.keys(found.env).length > 0) {
        console.log(
          `  environment   ${Object.entries(found.env)
            .map(([key, value]) => `${key}=${value}`)
            .join(' ')}`,
        );
      }
      if (found.type === 'job') {
        console.log(`  schedule      ${describeSchedule(found.duration, found.firstLaunchAt)}`);
      } else if (found.healthCheck !== undefined) {
        console.log(`  health check  ${describeHealthCheck(found.healthCheck)}`);
      }
      console.log(`  scheduling    ${dynamics.active ? 'enabled' : 'disabled'}`);
      console.log(`  target agents ${dynamics.targetAgentIds.length > 0 ? dynamics.targetAgentIds.join(', ') : '(none)'}`);
      console.log(`  created       ${formatTimestamp(found.createdAt)}`);
      console.log(`  updated       ${formatTimestamp(found.lastUpdatedAt)}`);
    });

  addWriteTaskOptions(task.command('create').description('define a new task')).action(async function (this: Command, options: WriteTaskOptions) {
    const global: GlobalOptions = this.optsWithGlobals();
    const request = buildTaskFields(options);
    const response = await createClient(global).createTask(request);
    if (global.json === true) {
      printJson(response);
      return;
    }
    console.log(`Created ${request.type} "${request.name}" as task ${response.taskId} (version ${response.version}).`);
    console.log(`Next: mini-cloud task agents ${response.taskId} --agent <agentId>`);
  });

  addWriteTaskOptions(task.command('update').description('write a new version of a task').argument('<taskId>')).action(async function (
    this: Command,
    taskId: string,
    options: WriteTaskOptions,
  ) {
    const global: GlobalOptions = this.optsWithGlobals();
    const request: UpdateTaskRequest = { ...buildTaskFields(options), taskId };
    const response = await createClient(global).updateTask(request);
    console.log(`Updated task ${response.taskId} to version ${response.version}.`);
  });

  task
    .command('delete')
    .description('delete a task and all of its versions')
    .argument('<taskId>')
    .action(async function (this: Command, taskId: string) {
      await createClient(this.optsWithGlobals()).deleteTask({ taskId });
      console.log(`Deleted task ${taskId}. Its instance history is kept until retention prunes it.`);
    });

  task
    .command('launch')
    .description('launch now, on the task’s agents or the ones given')
    .argument('<taskId>')
    .argument('[extraArgs...]', 'extra arguments for this run only; put them after --')
    .option('--agent <agentId>', 'launch on this agent instead of the configured ones; repeat for several', collect, [])
    .action(async function (this: Command, taskId: string, extraArgs: string[], options: { agent: string[] }) {
      const global: GlobalOptions = this.optsWithGlobals();
      const { results } = await createClient(global).launchTask({
        taskId,
        targetAgentIds: options.agent.length > 0 ? options.agent : undefined,
        arguments: extraArgs.length > 0 ? extraArgs : undefined,
      });

      if (global.json === true) {
        printJson(results);
      } else {
        for (const result of results) {
          if (result.status === 'initiated') {
            console.log(`${result.agentId}: launched instance ${result.instanceId}`);
          } else {
            console.log(`${result.agentId}: FAILED (${result.instanceId}) — ${result.message ?? 'could not dispatch'}`);
          }
        }
      }
      if (results.some((result) => result.status === 'initiation_failed')) {
        process.exitCode = 1;
      }
    });

  task
    .command('enable')
    .description('let the scheduler launch this task')
    .argument('<taskId>')
    .action(async function (this: Command, taskId: string) {
      const { dynamics } = await createClient(this.optsWithGlobals()).setTaskActive({ taskId, active: true });
      if (dynamics.targetAgentIds.length === 0) {
        console.log(`Enabled scheduling for task ${taskId}, but it has no target agents so nothing will launch.`);
        console.log(`Set them with: mini-cloud task agents ${taskId} --agent <agentId>`);
        return;
      }
      console.log(`Enabled scheduling for task ${taskId}.`);
    });

  task
    .command('disable')
    .description('stop the scheduler launching this task')
    .argument('<taskId>')
    .action(async function (this: Command, taskId: string) {
      await createClient(this.optsWithGlobals()).setTaskActive({ taskId, active: false });
      console.log(`Disabled scheduling for task ${taskId}.`);
    });

  task
    .command('agents')
    .description('set which agents a task runs on')
    .argument('<taskId>')
    .option('--agent <agentId>', 'target agent; repeat for several, omit to clear', collect, [])
    .action(async function (this: Command, taskId: string, options: { agent: string[] }) {
      const { dynamics } = await createClient(this.optsWithGlobals()).setTaskTargetAgents({ taskId, targetAgentIds: options.agent });
      console.log(dynamics.targetAgentIds.length > 0 ? `Task ${taskId} now targets: ${dynamics.targetAgentIds.join(', ')}` : `Task ${taskId} now targets no agents.`);
    });

  return task;
}
