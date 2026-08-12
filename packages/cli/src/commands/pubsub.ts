import { WsSubscriber } from '@mini-cloud/client';
import { Command } from 'commander';
import { GlobalOptions, createClient, resolveServiceUrl, resolveToken } from '../client-factory';
import { printJson, printTable } from '../output';

/** Accepts JSON when it parses, and treats anything else as a plain string. */
function parsePayload(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function buildPubSubCommand(): Command {
  const pubsub = new Command('pubsub').description('inspect and use the message hub');

  pubsub
    .command('status')
    .description('show connected subscribers per topic')
    .action(async function (this: Command) {
      const global: GlobalOptions = this.optsWithGlobals();
      const { status } = await createClient(global).getHubStatus();
      if (global.json === true) {
        printJson(status);
        return;
      }

      console.log(`${status.subscriberCount} subscriber(s) connected.`);
      const rows = Object.entries(status.topicToSubscriberCount).map(([topic, count]) => ({ topic, count }));
      printTable(
        rows,
        [
          { header: 'TOPIC', value: (row) => row.topic },
          { header: 'SUBSCRIBERS', value: (row) => String(row.count) },
        ],
        'No topics have subscribers.',
      );
    });

  pubsub
    .command('publish')
    .description('publish one message')
    .argument('<topic>')
    .argument('[payload]', 'JSON, or plain text if it does not parse', '{}')
    .action(async function (this: Command, topic: string, payload: string) {
      const { deliveredTo } = await createClient(this.optsWithGlobals()).publish({ topic, payload: parsePayload(payload) });
      console.log(`Published to ${topic}; delivered to ${deliveredTo} subscriber(s).`);
    });

  pubsub
    .command('watch')
    .description('tail a topic until interrupted')
    .argument('<topic>')
    .action(async function (this: Command, topic: string) {
      const global: GlobalOptions = this.optsWithGlobals();
      const url = `${resolveServiceUrl(global).replace(/^http/, 'ws').replace(/\/+$/, '')}/ws`;

      const subscriber = new WsSubscriber({
        url,
        token: resolveToken(global),
        onEvent: (envelope) => {
          console.log(`${new Date(envelope.forwardedAt).toISOString()}  ${envelope.topic}  ${JSON.stringify(envelope.payload)}`);
        },
      });

      await subscriber.connect();
      await subscriber.subscribe(topic);
      console.log(`Watching ${topic}. Press Ctrl-C to stop.`);

      process.on('SIGINT', () => {
        void subscriber.close().then(() => process.exit(0));
      });

      await new Promise<never>(() => {});
    });

  return pubsub;
}
