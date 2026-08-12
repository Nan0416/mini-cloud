import { AppError, LoggerFactory, LogLevel } from '@mini-cloud/shared';
import { Command, InvalidArgumentError } from 'commander';
import { buildAgentCommand } from './commands/agent';
import { buildInstanceCommand } from './commands/instance';
import { buildPubSubCommand } from './commands/pubsub';
import { buildMigrateCommand, buildServeCommand } from './commands/serve';
import { buildTaskCommand } from './commands/task';
import { buildVarCommand } from './commands/var';

const LOG_LEVELS: ReadonlyArray<LogLevel> = ['debug', 'info', 'warn', 'error'];

/** Commands that print a table, where service log lines would only be noise. */
const QUIET_COMMANDS = new Set(['task', 'instance', 'var', 'pubsub', 'migrate']);

const EXAMPLES = `
Examples:
  mini-cloud serve
  mini-cloud agent start --id laptop-1
  mini-cloud task create --name backup --cmd ./backup.sh --cwd ~/scripts --every 1d --at 2026-01-01T03:00:00Z
  mini-cloud task agents 1234567890 --agent laptop-1
  mini-cloud task enable 1234567890
  mini-cloud task launch 1234567890 -- --dry-run
  mini-cloud instance list --task 1234567890

Variable substitution:
  Set fleet-wide values with 'var set', then use \${NAME} in cmd, cwd, args, env or
  stdio paths. Agents additionally resolve \${HOME}, \${HOSTNAME}, \${AGENT_ID},
  \${AGENT_NAME}, \${AGENT_DIR}, \${STDOUT_DIR}, \${STDERR_DIR}, \${INSTANCE_ID} and
  \${TASK_ID} on the machine where the task actually runs.
`;

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('mini-cloud')
    .description('a private cloud for your own machines')
    .version('1.0.0')
    .option('--service <url>', 'service base URL (env MINI_CLOUD_SERVICE_URL, default http://127.0.0.1:3000)')
    .option('--token <token>', 'bearer token (env MINI_CLOUD_TOKEN)')
    .option('--json', 'print raw JSON instead of a table')
    .option('--log-level <level>', 'debug, info, warn or error', (value) => {
      const match = LOG_LEVELS.find((level) => level === value);
      if (match === undefined) {
        throw new InvalidArgumentError(`must be one of: ${LOG_LEVELS.join(', ')}`);
      }
      return match;
    })
    .addHelpText('after', EXAMPLES)
    // Show help rather than a bare error when invoked with no arguments.
    .showHelpAfterError('(run "mini-cloud --help" to see the available commands)');

  program.hook('preAction', (thisCommand, actionCommand) => {
    const level: LogLevel | undefined = thisCommand.opts().logLevel;
    if (level !== undefined) {
      LoggerFactory.setLevel(level);
      return;
    }
    // `serve` and `agent start` are long-running processes whose logs are the point,
    // so they keep the default level.
    const root = actionCommand.parent?.name() ?? actionCommand.name();
    if (QUIET_COMMANDS.has(root)) {
      LoggerFactory.setLevel('warn');
    }
  });

  program.addCommand(buildServeCommand());
  program.addCommand(buildMigrateCommand());
  program.addCommand(buildAgentCommand());
  program.addCommand(buildTaskCommand());
  program.addCommand(buildInstanceCommand());
  program.addCommand(buildVarCommand());
  program.addCommand(buildPubSubCommand());

  return program;
}

export async function main(argv: ReadonlyArray<string> = process.argv): Promise<void> {
  await buildProgram().parseAsync([...argv]);
}

export function run(): void {
  main().catch((err: unknown) => {
    // An AppError is an expected outcome the user should read as a sentence; a stack
    // trace would bury the one line that matters.
    if (err instanceof AppError || err instanceof Error) {
      console.error(`Error: ${err.message}`);
      if (!(err instanceof AppError) && process.env['MINI_CLOUD_LOG_LEVEL'] === 'debug') {
        console.error(err.stack);
      }
    } else {
      console.error(`Error: ${String(err)}`);
    }
    process.exit(1);
  });
}
