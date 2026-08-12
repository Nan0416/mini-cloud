import { TASK_INSTANCE_STATUSES, TaskEvent, TaskInstance, assertOneOf } from '@mini-cloud/shared';
import { ParsedArgs, boolFlag, flag, requirePositional } from '../args';
import { createClient } from '../client-factory';
import { Column, formatAge, formatTimestamp, printJson, printTable, truncate } from '../output';

const INSTANCE_COLUMNS: ReadonlyArray<Column<TaskInstance>> = [
  { header: 'INSTANCE ID', value: (instance) => instance.instanceId },
  { header: 'TASK', value: (instance) => `${instance.taskId} v${instance.taskVersion}` },
  { header: 'AGENT', value: (instance) => instance.agentId },
  { header: 'PID', value: (instance) => (instance.pid === undefined ? '-' : String(instance.pid)) },
  { header: 'STATUS', value: (instance) => instance.status },
  { header: 'UPDATED', value: (instance) => formatAge(instance.lastUpdatedAt) },
];

const EVENT_COLUMNS: ReadonlyArray<Column<TaskEvent>> = [
  { header: 'TIME', value: (event) => formatTimestamp(event.timestamp) },
  { header: 'SOURCE', value: (event) => event.source },
  { header: 'LEVEL', value: (event) => event.level },
  { header: 'MESSAGE', value: (event) => truncate(typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload), 100) },
];

export async function instanceCommand(args: ParsedArgs): Promise<void> {
  const subcommand = args.positionals[1] ?? 'list';

  switch (subcommand) {
    case 'list':
      return listInstances(args);
    case 'get':
      return getInstance(args);
    case 'terminate':
      return terminateInstance(args);
    case 'events':
      return listEvents(args);
    default:
      throw new Error(`Unknown instance subcommand "${subcommand}". Try: list, get, terminate, events.`);
  }
}

async function listInstances(args: ParsedArgs): Promise<void> {
  const status = flag(args, 'status');
  const limit = flag(args, 'limit');

  const { instances } = await createClient(args).listTaskInstances({
    taskId: flag(args, 'task'),
    agentId: flag(args, 'agent'),
    status: status === undefined ? undefined : assertOneOf(status, 'status', TASK_INSTANCE_STATUSES),
    limit: limit === undefined ? undefined : Number(limit),
  });

  if (boolFlag(args, 'json')) {
    printJson(instances);
    return;
  }
  printTable(instances, INSTANCE_COLUMNS, 'No matching instances.');
}

async function getInstance(args: ParsedArgs): Promise<void> {
  const instanceId = requirePositional(args, 2, 'instanceId');
  const { instance } = await createClient(args).getTaskInstance({ instanceId });

  if (boolFlag(args, 'json')) {
    printJson(instance);
    return;
  }

  console.log(`Instance ${instance.instanceId}`);
  console.log(`  task     ${instance.taskId} v${instance.taskVersion}`);
  console.log(`  agent    ${instance.agentId}`);
  console.log(`  pid      ${instance.pid ?? '-'}`);
  console.log(`  status   ${instance.status}`);
  console.log(`  created  ${formatTimestamp(instance.createdAt)}`);
  console.log(`  updated  ${formatTimestamp(instance.lastUpdatedAt)}`);
}

async function terminateInstance(args: ParsedArgs): Promise<void> {
  const instanceId = requirePositional(args, 2, 'instanceId');
  await createClient(args).terminateTaskInstance({ instanceId });
  console.log(`Sent a terminate request for instance ${instanceId}.`);
}

async function listEvents(args: ParsedArgs): Promise<void> {
  const instanceId = requirePositional(args, 2, 'instanceId');
  const limit = flag(args, 'limit');
  const { events } = await createClient(args).listTaskEvents({ instanceId, limit: limit === undefined ? undefined : Number(limit) });

  if (boolFlag(args, 'json')) {
    printJson(events);
    return;
  }
  printTable(events, EVENT_COLUMNS, `Instance ${instanceId} has no events yet.`);
}
