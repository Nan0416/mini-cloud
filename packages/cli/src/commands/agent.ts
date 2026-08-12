import { MiniCloudAgent, loadAgentConfig } from '@mini-cloud/agent';
import { LoggerFactory } from '@mini-cloud/shared';
import { ParsedArgs, flag, requirePositional } from '../args';
import { createClient, resolveServiceUrl, resolveToken } from '../client-factory';
import { Column, formatAge, printJson, printTable } from '../output';
import { TaskAgent } from '@mini-cloud/shared';

const logger = LoggerFactory.getLogger('agent');

const AGENT_COLUMNS: ReadonlyArray<Column<TaskAgent>> = [
  { header: 'AGENT ID', value: (agent) => agent.agentId },
  { header: 'NAME', value: (agent) => agent.name },
  { header: 'STATUS', value: (agent) => agent.status },
  { header: 'LAST SEEN', value: (agent) => formatAge(agent.lastSeenAt) },
];

export async function agentCommand(args: ParsedArgs): Promise<void> {
  const subcommand = args.positionals[1] ?? 'list';

  switch (subcommand) {
    case 'start':
      return startAgent(args);
    case 'list':
      return listAgents(args);
    case 'stop':
      return stopAgent(args);
    default:
      throw new Error(`Unknown agent subcommand "${subcommand}". Try: start, list, stop.`);
  }
}

/** `mini-cloud agent start` — runs a worker agent on this machine, in the foreground. */
async function startAgent(args: ParsedArgs): Promise<void> {
  const base = loadAgentConfig();
  const idFlag = flag(args, 'id');
  const config = {
    ...base,
    agentId: idFlag ?? base.agentId,
    name: flag(args, 'name') ?? base.name,
    serviceUrl: resolveServiceUrl(args),
    token: resolveToken(args),
    port: flag(args, 'port') === undefined ? base.port : Number(flag(args, 'port')),
  };

  const agent = await MiniCloudAgent.start(config);

  let stopping = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (stopping) {
      process.exit(1);
    }
    stopping = true;
    logger.info(`Shutting down: ${reason}.`);
    await agent.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // The service can also ask this agent to stand down.
  await agent.waitForShutdownRequest();
  await shutdown('the service requested shutdown');
}

async function listAgents(args: ParsedArgs): Promise<void> {
  const { agents } = await createClient(args).listAgents();
  if (flag(args, 'json') !== undefined) {
    printJson(agents);
    return;
  }
  printTable(agents, AGENT_COLUMNS, 'No agents have registered yet. Start one with: mini-cloud agent start --id <id>');
}

async function stopAgent(args: ParsedArgs): Promise<void> {
  const agentId = requirePositional(args, 2, 'agentId');
  await createClient(args).terminateAgent({ agentId });
  console.log(`Asked agent ${agentId} to shut down.`);
}
