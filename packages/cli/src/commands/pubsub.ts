import { WsSubscriber } from '@mini-cloud/client';
import { ParsedArgs, boolFlag, requirePositional } from '../args';
import { createClient, resolveServiceUrl, resolveToken } from '../client-factory';
import { printJson, printTable } from '../output';

export async function pubsubCommand(args: ParsedArgs): Promise<void> {
  const subcommand = args.positionals[1] ?? 'status';

  switch (subcommand) {
    case 'status':
      return status(args);
    case 'publish':
      return publish(args);
    case 'watch':
      return watch(args);
    default:
      throw new Error(`Unknown pubsub subcommand "${subcommand}". Try: status, publish, watch.`);
  }
}

async function status(args: ParsedArgs): Promise<void> {
  const { status: hubStatus } = await createClient(args).getHubStatus();
  if (boolFlag(args, 'json')) {
    printJson(hubStatus);
    return;
  }

  console.log(`${hubStatus.subscriberCount} subscriber(s) connected.`);
  const rows = Object.entries(hubStatus.topicToSubscriberCount).map(([topic, count]) => ({ topic, count }));
  printTable(
    rows,
    [
      { header: 'TOPIC', value: (row) => row.topic },
      { header: 'SUBSCRIBERS', value: (row) => String(row.count) },
    ],
    'No topics have subscribers.',
  );
}

async function publish(args: ParsedArgs): Promise<void> {
  const topic = requirePositional(args, 2, 'topic');
  const raw = args.positionals[3] ?? '{}';
  const payload = parsePayload(raw);
  const { deliveredTo } = await createClient(args).publish({ topic, payload });
  console.log(`Published to ${topic}; delivered to ${deliveredTo} subscriber(s).`);
}

/** Accepts JSON when it parses, and treats anything else as a plain string. */
function parsePayload(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** `mini-cloud pubsub watch <topic>` — tails a topic until interrupted. */
async function watch(args: ParsedArgs): Promise<void> {
  const topic = requirePositional(args, 2, 'topic');
  const url = `${resolveServiceUrl(args).replace(/^http/, 'ws').replace(/\/+$/, '')}/ws`;

  const subscriber = new WsSubscriber({
    url,
    token: resolveToken(args),
    onEvent: (envelope) => {
      const at = new Date(envelope.forwardedAt).toISOString();
      console.log(`${at}  ${envelope.topic}  ${JSON.stringify(envelope.payload)}`);
    },
  });

  await subscriber.connect();
  await subscriber.subscribe(topic);
  console.log(`Watching ${topic}. Press Ctrl-C to stop.`);

  process.on('SIGINT', () => {
    void subscriber.close().then(() => process.exit(0));
  });

  await new Promise<never>(() => {});
}
