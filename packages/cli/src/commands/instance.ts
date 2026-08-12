import { TASK_INSTANCE_STATUSES, TaskEvent, TaskInstance, TaskInstanceStatus } from '@mini-cloud/shared';
import { Command, InvalidArgumentError } from 'commander';
import { parsePositiveInteger } from '../args';
import { GlobalOptions, createClient } from '../client-factory';
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

/** Rejected by commander before the command body runs, with the valid set listed. */
function parseStatus(value: string): TaskInstanceStatus {
  const match = TASK_INSTANCE_STATUSES.find((status) => status === value);
  if (match === undefined) {
    throw new InvalidArgumentError(`must be one of: ${TASK_INSTANCE_STATUSES.join(', ')}`);
  }
  return match;
}

export function buildInstanceCommand(): Command {
  const instance = new Command('instance').description('inspect and stop individual launches');

  instance
    .command('list')
    .description('list launches, newest first')
    .option('--task <taskId>', 'only launches of this task')
    .option('--agent <agentId>', 'only launches on this agent')
    .option('--status <status>', 'only launches in this status', parseStatus)
    .option('--limit <n>', 'maximum rows to return', (value) => parsePositiveInteger(value, 'limit'))
    .action(async function (this: Command, options: { task?: string; agent?: string; status?: TaskInstanceStatus; limit?: number }) {
      const global: GlobalOptions = this.optsWithGlobals();
      const { instances } = await createClient(global).listTaskInstances({
        taskId: options.task,
        agentId: options.agent,
        status: options.status,
        limit: options.limit,
      });

      if (global.json === true) {
        printJson(instances);
        return;
      }
      printTable(instances, INSTANCE_COLUMNS, 'No matching instances.');
    });

  instance
    .command('get')
    .description('show one launch')
    .argument('<instanceId>')
    .action(async function (this: Command, instanceId: string) {
      const global: GlobalOptions = this.optsWithGlobals();
      const { instance: found } = await createClient(global).getTaskInstance({ instanceId });

      if (global.json === true) {
        printJson(found);
        return;
      }

      console.log(`Instance ${found.instanceId}`);
      console.log(`  task     ${found.taskId} v${found.taskVersion}`);
      console.log(`  agent    ${found.agentId}`);
      console.log(`  pid      ${found.pid ?? '-'}`);
      console.log(`  status   ${found.status}`);
      console.log(`  created  ${formatTimestamp(found.createdAt)}`);
      console.log(`  updated  ${formatTimestamp(found.lastUpdatedAt)}`);
    });

  instance
    .command('terminate')
    .description('ask the agent to stop a running instance')
    .argument('<instanceId>')
    .action(async function (this: Command, instanceId: string) {
      await createClient(this.optsWithGlobals()).terminateTaskInstance({ instanceId });
      console.log(`Sent a terminate request for instance ${instanceId}.`);
    });

  instance
    .command('events')
    .description('show a launch’s event log')
    .argument('<instanceId>')
    .option('--limit <n>', 'maximum events to return', (value) => parsePositiveInteger(value, 'limit'))
    .action(async function (this: Command, instanceId: string, options: { limit?: number }) {
      const global: GlobalOptions = this.optsWithGlobals();
      const { events } = await createClient(global).listTaskEvents({ instanceId, limit: options.limit });

      if (global.json === true) {
        printJson(events);
        return;
      }
      printTable(events, EVENT_COLUMNS, `Instance ${instanceId} has no events yet.`);
    });

  return instance;
}
