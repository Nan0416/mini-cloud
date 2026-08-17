import { MiniCloudAgent, loadAgentConfig } from '@mini-cloud/agent';
import { LoggerFactory, TaskAgent } from '@mini-cloud/shared';
import { Command } from 'commander';
import { parsePositiveInteger } from '../args';
import { GlobalOptions, createClient, resolveServiceUrl, resolveToken } from '../client-factory';
import { Column, formatAge, printJson, printTable } from '../output';

const logger = LoggerFactory.getLogger('agent');

const AGENT_COLUMNS: ReadonlyArray<Column<TaskAgent>> = [
  { header: 'AGENT ID', value: (agent) => agent.agentId },
  { header: 'NAME', value: (agent) => agent.name },
  { header: 'STATUS', value: (agent) => agent.status },
  { header: 'LAST SEEN', value: (agent) => formatAge(agent.lastSeenAt) },
];

export function buildAgentCommand(): Command {
  const agent = new Command('agent').description('run a worker agent, or manage the fleet');

  agent
    .command('start')
    .description('run a worker agent on this machine, in the foreground')
    .option('--id <agentId>', 'unique agent id (env MINI_CLOUD_AGENT_ID)')
    .option('--name <name>', 'display name (default: this machine’s hostname)')
    .option('--port <port>', 'loopback port for the reporter API', (value) => parsePositiveInteger(value, 'port'))
    .action(async function (this: Command, options: { id?: string; name?: string; port?: number }) {
      const global: GlobalOptions = this.optsWithGlobals();
      const config = loadAgentConfig({
        agentId: options.id,
        name: options.name,
        port: options.port,
        serviceUrl: resolveServiceUrl(global),
        token: resolveToken(global),
      });

      const running = await MiniCloudAgent.start(config);

      let stopping = false;
      const shutdown = async (reason: string): Promise<void> => {
        if (stopping) {
          process.exit(1);
        }
        stopping = true;
        logger.info(`Shutting down: ${reason}.`);
        await running.stop();
        process.exit(0);
      };

      process.on('SIGINT', () => void shutdown('SIGINT'));
      process.on('SIGTERM', () => void shutdown('SIGTERM'));

      // The service can also ask this agent to stand down.
      await running.waitForShutdownRequest();
      await shutdown('the service requested shutdown');
    });

  agent
    .command('list')
    .description('list registered agents and their liveness')
    .action(async function (this: Command) {
      const global: GlobalOptions = this.optsWithGlobals();
      const { agents } = await createClient(global).listAgents({});
      if (global.json === true) {
        printJson(agents);
        return;
      }
      printTable(agents, AGENT_COLUMNS, 'No agents have registered yet. Start one with: mini-cloud agent start --id <id>');
    });

  agent
    .command('stop')
    .description('ask an agent to shut down')
    .argument('<agentId>')
    .action(async function (this: Command, agentId: string) {
      await createClient(this.optsWithGlobals()).terminateAgent({ agentId });
      console.log(`Asked agent ${agentId} to shut down.`);
    });

  return agent;
}
