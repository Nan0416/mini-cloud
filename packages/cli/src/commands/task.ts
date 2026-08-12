import { CreateTaskRequest, HealthCheck, InvalidRequestError, Task, UpdateTaskRequest } from '@mini-cloud/shared';
import { ParsedArgs, boolFlag, flag, flagList, parseDuration, parseKeyValues, parseTimestamp, requireFlag, requirePositional } from '../args';
import { createClient } from '../client-factory';
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

export async function taskCommand(args: ParsedArgs): Promise<void> {
  const subcommand = args.positionals[1] ?? 'list';

  switch (subcommand) {
    case 'list':
      return listTasks(args);
    case 'get':
      return getTask(args);
    case 'create':
      return createTask(args);
    case 'update':
      return updateTask(args);
    case 'delete':
      return deleteTask(args);
    case 'launch':
      return launchTask(args);
    case 'enable':
      return setActive(args, true);
    case 'disable':
      return setActive(args, false);
    case 'agents':
      return setTargetAgents(args);
    default:
      throw new Error(`Unknown task subcommand "${subcommand}". Try: list, get, create, update, delete, launch, enable, disable, agents.`);
  }
}

async function listTasks(args: ParsedArgs): Promise<void> {
  const { tasks } = await createClient(args).listTasks();
  if (boolFlag(args, 'json')) {
    printJson(tasks);
    return;
  }
  printTable(tasks, TASK_COLUMNS, 'No tasks defined yet. Create one with: mini-cloud task create --name ... --cmd ...');
}

async function getTask(args: ParsedArgs): Promise<void> {
  const taskId = requirePositional(args, 2, 'taskId');
  const versionFlag = flag(args, 'version');
  const client = createClient(args);

  const [{ task }, { dynamics }] = await Promise.all([
    client.getTask({ taskId, version: versionFlag === undefined ? undefined : Number(versionFlag) }),
    client.getTaskDynamics({ taskId }),
  ]);

  if (boolFlag(args, 'json')) {
    printJson({ task, dynamics });
    return;
  }

  console.log(`${task.name}  (${task.type} ${task.taskId} v${task.version})`);
  if (task.description !== undefined) {
    console.log(`  ${task.description}`);
  }
  console.log(`  command       ${[task.cmd, ...(task.arguments ?? [])].join(' ')}`);
  console.log(`  directory     ${task.cwd}`);
  console.log(`  stdout        ${task.stdout ?? '(agent default)'}`);
  console.log(`  stderr        ${task.stderr ?? '(agent default)'}`);
  if (task.env !== undefined && Object.keys(task.env).length > 0) {
    console.log(
      `  environment   ${Object.entries(task.env)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ')}`,
    );
  }
  if (task.type === 'job') {
    console.log(`  schedule      ${describeSchedule(task.duration, task.firstLaunchAt)}`);
  } else if (task.healthCheck !== undefined) {
    console.log(`  health check  ${describeHealthCheck(task.healthCheck)}`);
  }
  console.log(`  scheduling    ${dynamics.active ? 'enabled' : 'disabled'}`);
  console.log(`  target agents ${dynamics.targetAgentIds.length > 0 ? dynamics.targetAgentIds.join(', ') : '(none)'}`);
  console.log(`  updated       ${formatTimestamp(task.lastUpdatedAt)}`);
}

function describeHealthCheck(check: HealthCheck): string {
  if (check.type === 'ping') {
    return `ping ${check.domain}${check.path ?? '/ping'} every ${formatDuration(check.periodInMs ?? 5_000)}`;
  }
  return `passive heartbeat every ${formatDuration(check.periodInMs ?? 5_000)}`;
}

/** Shared by create and update: the write-side flags are identical. */
function buildTaskFields(args: ParsedArgs): CreateTaskRequest {
  const type = flag(args, 'type') ?? 'job';
  if (type !== 'job' && type !== 'service') {
    throw new InvalidRequestError('--type must be "job" or "service"');
  }

  const common = {
    name: requireFlag(args, 'name'),
    description: flag(args, 'description'),
    cmd: requireFlag(args, 'cmd'),
    cwd: flag(args, 'cwd') ?? process.cwd(),
    arguments: flagList(args, 'arg'),
    env: parseKeyValues(flagList(args, 'env'), 'env'),
    stdout: flag(args, 'stdout'),
    stderr: flag(args, 'stderr'),
  };

  if (type === 'job') {
    const every = flag(args, 'every');
    const at = flag(args, 'at');
    const duration = every === undefined ? undefined : parseDuration(every, 'every');
    // An interval needs an anchor to repeat from; default it to now so the common
    // case ("run this every 5 minutes") needs one flag rather than two.
    const firstLaunchAt = at !== undefined ? parseTimestamp(at, 'at') : duration !== undefined ? Date.now() : undefined;
    return { ...common, type, duration, firstLaunchAt };
  }

  return { ...common, type, healthCheck: buildHealthCheck(args) };
}

function buildHealthCheck(args: ParsedArgs): HealthCheck | undefined {
  const ping = flag(args, 'health-ping');
  const passive = flag(args, 'health-passive');

  if (ping !== undefined && passive !== undefined) {
    throw new InvalidRequestError('--health-ping and --health-passive are mutually exclusive');
  }
  if (ping !== undefined) {
    const url = new URL(ping);
    return {
      type: 'ping',
      domain: `${url.protocol}//${url.host}`,
      path: url.pathname === '/' ? undefined : url.pathname,
      periodInMs: flag(args, 'health-period') === undefined ? undefined : parseDuration(requireFlag(args, 'health-period'), 'health-period'),
    };
  }
  if (passive !== undefined) {
    return { type: 'passive', periodInMs: parseDuration(passive, 'health-passive') };
  }
  return undefined;
}

async function createTask(args: ParsedArgs): Promise<void> {
  const request = buildTaskFields(args);
  const response = await createClient(args).createTask(request);
  if (boolFlag(args, 'json')) {
    printJson(response);
    return;
  }
  console.log(`Created ${request.type} "${request.name}" as task ${response.taskId} (version ${response.version}).`);
  console.log(`Next: mini-cloud task agents ${response.taskId} --agent <agentId>`);
}

async function updateTask(args: ParsedArgs): Promise<void> {
  const taskId = requirePositional(args, 2, 'taskId');
  const fields = buildTaskFields(args);
  const request: UpdateTaskRequest = { ...fields, taskId };
  const response = await createClient(args).updateTask(request);
  console.log(`Updated task ${response.taskId} to version ${response.version}.`);
}

async function deleteTask(args: ParsedArgs): Promise<void> {
  const taskId = requirePositional(args, 2, 'taskId');
  await createClient(args).deleteTask({ taskId });
  console.log(`Deleted task ${taskId}. Its instance history is kept until retention prunes it.`);
}

async function launchTask(args: ParsedArgs): Promise<void> {
  const taskId = requirePositional(args, 2, 'taskId');
  const agents = flagList(args, 'agent');

  const { results } = await createClient(args).launchTask({
    taskId,
    targetAgentIds: agents.length > 0 ? agents : undefined,
    // Anything after `--` is appended to the task's own arguments for this run.
    arguments: args.passthrough.length > 0 ? args.passthrough : undefined,
  });

  if (boolFlag(args, 'json')) {
    printJson(results);
    return;
  }

  for (const result of results) {
    if (result.status === 'initiated') {
      console.log(`${result.agentId}: launched instance ${result.instanceId}`);
    } else {
      console.log(`${result.agentId}: FAILED (${result.instanceId}) — ${result.message ?? 'could not dispatch'}`);
    }
  }
  const failures = results.filter((result) => result.status === 'initiation_failed').length;
  if (failures > 0) {
    process.exitCode = 1;
  }
}

async function setActive(args: ParsedArgs, active: boolean): Promise<void> {
  const taskId = requirePositional(args, 2, 'taskId');
  const { dynamics } = await createClient(args).setTaskActive({ taskId, active });
  if (active && dynamics.targetAgentIds.length === 0) {
    console.log(`Enabled scheduling for task ${taskId}, but it has no target agents so nothing will launch.`);
    console.log(`Set them with: mini-cloud task agents ${taskId} --agent <agentId>`);
    return;
  }
  console.log(`${active ? 'Enabled' : 'Disabled'} scheduling for task ${taskId}.`);
}

async function setTargetAgents(args: ParsedArgs): Promise<void> {
  const taskId = requirePositional(args, 2, 'taskId');
  const agents = flagList(args, 'agent');
  const { dynamics } = await createClient(args).setTaskTargetAgents({ taskId, targetAgentIds: agents });
  console.log(dynamics.targetAgentIds.length > 0 ? `Task ${taskId} now targets: ${dynamics.targetAgentIds.join(', ')}` : `Task ${taskId} now targets no agents.`);
}
