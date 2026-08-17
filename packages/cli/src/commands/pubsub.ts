import { WsSubscriber } from '@mini-cloud/client';
import { EventEnvelope } from '@mini-cloud/shared';
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

/** `<age>ms  <to>  <from …>  <payload>` — one line per message, greppable. */
function formatEnvelope(envelope: EventEnvelope): string {
  const latency = `${envelope.forwardedAt - envelope.publishedAt}ms`;
  const from = envelope.senderId === undefined ? 'anonymous' : envelope.senderId;
  return `${new Date(envelope.forwardedAt).toISOString()}  ${envelope.target.method} ${envelope.target.to}  from ${from}  (+${latency})  ${JSON.stringify(envelope.payload)}`;
}

export function buildPubSubCommand(): Command {
  const pubsub = new Command('pubsub').description('inspect and use the message hub');

  pubsub
    .command('status')
    .description('show connected subscribers per topic')
    .action(async function (this: Command) {
      const global: GlobalOptions = this.optsWithGlobals();
      const { status } = await createClient(global).getHubStatus({});
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
    .command('broadcast')
    .description('send one message to every subscriber of a topic')
    .argument('<topic>')
    .argument('[payload]', 'JSON, or plain text if it does not parse', '{}')
    .action(async function (this: Command, topic: string, payload: string) {
      const { deliveredTo } = await createClient(this.optsWithGlobals()).broadcast({ topic, payload: parsePayload(payload) });
      console.log(`Broadcast to ${topic}; delivered to ${deliveredTo} subscriber(s).`);
    });

  pubsub
    .command('send')
    .description('send one message to a single subscriber')
    .argument('<recipientId>', 'subscriber id, as printed by `pubsub watch`')
    .argument('[payload]', 'JSON, or plain text if it does not parse', '{}')
    .action(async function (this: Command, recipientId: string, payload: string) {
      const { deliveredTo } = await createClient(this.optsWithGlobals()).sendTo({ recipientId, payload: parsePayload(payload) });
      if (deliveredTo === 0) {
        console.log(`Subscriber ${recipientId} is not connected; the message was dropped.`);
        return;
      }
      console.log(`Sent to ${recipientId}.`);
    });

  pubsub
    .command('watch')
    .description('tail a topic until interrupted, and receive messages sent directly to this subscriber')
    .argument('<topic>')
    .action(async function (this: Command, topic: string) {
      const global: GlobalOptions = this.optsWithGlobals();
      const url = `${resolveServiceUrl(global).replace(/^http/, 'ws').replace(/\/+$/, '')}/ws`;

      const subscriber = new WsSubscriber({
        url,
        token: resolveToken(global),
        // Printed on every connect, not just the first: reconnecting gets a new id,
        // and someone about to `pubsub send` needs the current one.
        onWelcome: (subscriberId) => console.log(`Connected as ${subscriberId}. Send directly to it with: mini-cloud pubsub send ${subscriberId} '<payload>'`),
        onEvent: (envelope) => console.log(formatEnvelope(envelope)),
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
