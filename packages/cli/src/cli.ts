import { AppError, LoggerFactory } from '@mini-cloud/shared';
import { boolFlag, flag, parseArgs } from './args';
import { agentCommand } from './commands/agent';
import { instanceCommand } from './commands/instance';
import { migrateCommand } from './commands/migrate';
import { pubsubCommand } from './commands/pubsub';
import { serveCommand } from './commands/serve';
import { taskCommand } from './commands/task';
import { varCommand } from './commands/var';
import { HELP } from './help';

export async function main(argv: ReadonlyArray<string> = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);

  const level = flag(args, 'log-level');
  if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
    LoggerFactory.setLevel(level);
  } else if (isClientCommand(args.positionals[0])) {
    // Read-only commands print a table; the service's own log lines would be noise
    // in front of it. `serve` and `agent start` keep the default level.
    LoggerFactory.setLevel('warn');
  }

  const command = args.positionals[0];
  if (command === undefined || command === 'help' || boolFlag(args, 'help')) {
    console.log(HELP);
    return;
  }

  switch (command) {
    case 'serve':
      return serveCommand(args);
    case 'agent':
      return agentCommand(args);
    case 'migrate':
      return migrateCommand(args);
    case 'task':
      return taskCommand(args);
    case 'instance':
      return instanceCommand(args);
    case 'var':
      return varCommand(args);
    case 'pubsub':
      return pubsubCommand(args);
    default:
      throw new Error(`Unknown command "${command}". Run "mini-cloud help" to see what is available.`);
  }
}

function isClientCommand(command: string | undefined): boolean {
  return command === 'task' || command === 'instance' || command === 'var' || command === 'pubsub' || command === 'migrate';
}

export function run(): void {
  main().catch((err: unknown) => {
    // An AppError is an expected outcome the user should read as a sentence; a stack
    // trace would bury the one line that matters.
    if (err instanceof AppError) {
      console.error(`Error: ${err.message}`);
    } else if (err instanceof Error) {
      console.error(`Error: ${err.message}`);
      if (process.env['MINI_CLOUD_LOG_LEVEL'] === 'debug') {
        console.error(err.stack);
      }
    } else {
      console.error(`Error: ${String(err)}`);
    }
    process.exit(1);
  });
}
