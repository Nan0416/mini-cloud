import { DeliveryFailedError, LoggerFactory, sleep } from '@mini-cloud/shared';
import { DiscordCredentials } from '../data/notifier-dao';
import { discordWebhookBody } from '../utils/discord-embed';
import { NotificationMessage } from '../utils/notification-message';
import { NotificationSender } from './notification-sender';

const logger = LoggerFactory.getLogger('DiscordWebhookSender');

export interface DiscordWebhookSenderProps {
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  /** How long one post may take before it counts as failed. */
  readonly timeoutMs?: number;
  /** The longest a rate limit is waited out; anything longer fails instead of holding up the next monitor. */
  readonly maxRetryAfterMs?: number;
}

/** What Discord says about a refusal, from its JSON error body. */
interface DiscordError {
  readonly message?: string;
  readonly retryAfterMs?: number;
}

async function readError(response: Response): Promise<DiscordError> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) {
      return {};
    }
    const message = 'message' in body && typeof body.message === 'string' ? body.message : undefined;
    const retryAfter = 'retry_after' in body && typeof body.retry_after === 'number' ? body.retry_after : undefined;
    // In seconds, with a fraction.
    return { message, retryAfterMs: retryAfter === undefined ? undefined : Math.ceil(retryAfter * 1000) };
  } catch {
    return {};
  }
}

function describeRefusal(status: number, error: DiscordError): string {
  const said = `HTTP ${status}${error.message === undefined ? '' : `: ${error.message}`}`;
  switch (status) {
    case 401:
    case 403:
      return `Discord refused the webhook's token (${said}). Copy the webhook URL from Discord again and save it on the notifier.`;
    case 404:
      return `Discord has no such webhook (${said}); it may have been deleted. Create a new one in the channel's settings and save its URL on the notifier.`;
    case 429:
      return `Discord is rate-limiting this webhook (${said}). The message was dropped; try again shortly.`;
    default:
      return `Discord did not accept the message (${said}).`;
  }
}

/**
 * Posts a message to a Discord webhook as one embed.
 *
 * A plain `fetch` rather than discord.js: a webhook post is a single request, and the
 * library would bring a gateway client and a dozen packages into the binary for it.
 * A rate limit is waited out once, as Discord asks; anything else fails at once.
 */
export class DiscordWebhookSender implements NotificationSender<DiscordCredentials> {
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly maxRetryAfterMs: number;

  constructor(props: DiscordWebhookSenderProps = {}) {
    this.fetch = props.fetch ?? fetch;
    this.sleep = props.sleep ?? sleep;
    this.timeoutMs = props.timeoutMs ?? 10_000;
    this.maxRetryAfterMs = props.maxRetryAfterMs ?? 10_000;
  }

  async send(credentials: DiscordCredentials, message: NotificationMessage): Promise<void> {
    const body = JSON.stringify(discordWebhookBody(message));
    // `wait` makes Discord answer only once the message is posted, so a refusal comes back as one.
    const url = `${credentials.webhookUrl}?wait=true`;

    for (let attempt = 1; ; attempt++) {
      const response = await this.post(url, body);
      if (response.ok) {
        logger.debug(`Posted "${message.title}" to Discord.`);
        return;
      }
      const error = await readError(response);
      const waitMs = error.retryAfterMs ?? this.maxRetryAfterMs;
      if (response.status === 429 && attempt === 1 && waitMs <= this.maxRetryAfterMs) {
        logger.info(`Discord is rate-limiting a webhook; posting again in ${waitMs}ms.`);
        await this.sleep(waitMs);
        continue;
      }
      throw new DeliveryFailedError(describeRefusal(response.status, error));
    }
  }

  private async post(url: string, body: string): Promise<Response> {
    try {
      return await this.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      // fetch's own error can carry the URL, which is the credential, so only its kind is passed on.
      const reason = err instanceof Error && err.name === 'TimeoutError' ? `no answer within ${this.timeoutMs}ms` : 'the connection failed';
      throw new DeliveryFailedError(`Discord could not be reached: ${reason}. Check this machine's internet connection.`);
    }
  }
}
