import { DeliveryFailedError, LoggerFactory } from '@mini-cloud/shared';
import { DiscordWebhookSender } from '../../src/facades/discord-webhook-sender';
import { NotificationMessage } from '../../src/utils/notification-message';

const WEBHOOK_URL = 'https://discord.com/api/webhooks/123/secret-token';

const MESSAGE: NotificationMessage = { title: 'nas-cpu is OK', body: 'All good.', tone: 'resolved', fields: [], timestamp: 0 };

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

/** Answers each post with the next scripted response, and records what was posted. */
function scriptedFetch(...replies: ReadonlyArray<Response | Error>) {
  const calls: Call[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init: init ?? {} });
    const reply = replies[calls.length - 1];
    if (reply === undefined) {
      throw new Error('no more scripted replies');
    }
    if (reply instanceof Error) {
      throw reply;
    }
    return reply;
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const context = (...replies: ReadonlyArray<Response | Error>) => {
  const { calls, fetch } = scriptedFetch(...replies);
  const waits: number[] = [];
  const sender = new DiscordWebhookSender({ fetch, sleep: async (ms) => void waits.push(ms), maxRetryAfterMs: 5_000 });
  return { calls, waits, sender };
};

beforeAll(() => {
  jest.spyOn(LoggerFactory.getLogger('DiscordWebhookSender'), 'info').mockImplementation(() => {});
});

describe('DiscordWebhookSender', () => {
  it('posts the message as JSON to the webhook, asking Discord to answer only once it is posted', async () => {
    const { calls, sender } = context(json(200, { id: '1' }));

    await sender.send({ type: 'discord', webhookUrl: WEBHOOK_URL }, MESSAGE);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${WEBHOOK_URL}?wait=true`);
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ embeds: [{ title: 'nas-cpu is OK' }] });
  });

  it('waits out a rate limit once, as long as Discord asks, and posts again', async () => {
    const { calls, waits, sender } = context(json(429, { message: 'You are being rate limited.', retry_after: 1.25 }), json(200, {}));

    await sender.send({ type: 'discord', webhookUrl: WEBHOOK_URL }, MESSAGE);

    expect(waits).toEqual([1250]);
    expect(calls).toHaveLength(2);
  });

  it('gives up on a second rate limit, or on one longer than it will wait', async () => {
    const twice = context(json(429, { retry_after: 1 }), json(429, { retry_after: 1 }));
    const tooLong = context(json(429, { retry_after: 60 }));

    await expect(twice.sender.send({ type: 'discord', webhookUrl: WEBHOOK_URL }, MESSAGE)).rejects.toThrow(/rate-limiting/);
    await expect(tooLong.sender.send({ type: 'discord', webhookUrl: WEBHOOK_URL }, MESSAGE)).rejects.toThrow(DeliveryFailedError);
    expect(tooLong.waits).toEqual([]);
  });

  it('says what to fix when the webhook is gone or its token refused', async () => {
    const gone = context(json(404, { message: 'Unknown Webhook', code: 10015 }));
    const refused = context(json(401, { message: 'Invalid Webhook Token' }));

    await expect(gone.sender.send({ type: 'discord', webhookUrl: WEBHOOK_URL }, MESSAGE)).rejects.toThrow(/no such webhook \(HTTP 404: Unknown Webhook\).*Create a new one/);
    await expect(refused.sender.send({ type: 'discord', webhookUrl: WEBHOOK_URL }, MESSAGE)).rejects.toThrow(/refused the webhook's token/);
  });

  it('never puts the webhook URL in an error, even when fetch did', async () => {
    const { sender } = context(new TypeError(`fetch failed: ${WEBHOOK_URL}`));

    const error = await sender.send({ type: 'discord', webhookUrl: WEBHOOK_URL }, MESSAGE).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(DeliveryFailedError);
    expect(String(error)).toMatch(/could not be reached/);
    expect(String(error)).not.toContain('secret-token');
  });

  it('copes with a refusal whose body is not JSON', async () => {
    const { sender } = context(new Response('<html>bad gateway</html>', { status: 502 }));

    await expect(sender.send({ type: 'discord', webhookUrl: WEBHOOK_URL }, MESSAGE)).rejects.toThrow('Discord did not accept the message (HTTP 502).');
  });
});
