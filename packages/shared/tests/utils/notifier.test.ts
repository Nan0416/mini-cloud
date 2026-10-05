import { assertNotifierName, parseDiscordWebhookUrl, parseNotifierTargetInput } from '../../src/utils/notifier';

const URL = 'https://discord.com/api/webhooks/1234567890/abc_DEF-123';

describe('parseDiscordWebhookUrl', () => {
  it('reads the webhook id from a URL copied from any of Discord’s hosts', () => {
    expect(parseDiscordWebhookUrl(URL)).toEqual({ webhookId: '1234567890' });
    expect(parseDiscordWebhookUrl('https://canary.discord.com/api/webhooks/1/token')).toEqual({ webhookId: '1' });
    expect(parseDiscordWebhookUrl('https://discordapp.com/api/v10/webhooks/2/token/')).toEqual({ webhookId: '2' });
  });

  it('refuses anything that would post somewhere other than Discord', () => {
    expect(parseDiscordWebhookUrl('http://discord.com/api/webhooks/1/token')).toBeUndefined();
    expect(parseDiscordWebhookUrl('https://discord.com.evil.example/api/webhooks/1/token')).toBeUndefined();
    expect(parseDiscordWebhookUrl('https://discord.com/api/webhooks/1')).toBeUndefined();
    expect(parseDiscordWebhookUrl('https://discord.com/api/webhooks/1/token?thread_id=2')).toBeUndefined();
  });
});

describe('parseNotifierTargetInput', () => {
  it('accepts a Discord target, trimmed', () => {
    expect(parseNotifierTargetInput({ type: 'discord', channel: ' #alerts ', webhookUrl: ` ${URL} ` }, 'target')).toEqual({ type: 'discord', channel: '#alerts', webhookUrl: URL });
  });

  it('accepts a target without a webhook URL, which an update reads as keeping the stored one', () => {
    expect(parseNotifierTargetInput({ type: 'discord', channel: '#alerts' }, 'target')).toEqual({ type: 'discord', channel: '#alerts' });
  });

  it('refuses a URL that is not a Discord webhook, without repeating it', () => {
    const attempt = () => parseNotifierTargetInput({ type: 'discord', channel: '#alerts', webhookUrl: 'https://example.com/secret-token' }, 'target');

    expect(attempt).toThrow(/target.webhookUrl is not a Discord webhook URL/);
    expect(attempt).not.toThrow(/secret-token/);
  });

  it('refuses an unknown type, a blank channel or a stray field', () => {
    expect(() => parseNotifierTargetInput({ type: 'slack', channel: '#alerts' }, 'target')).toThrow(/target.type must be one of/);
    expect(() => parseNotifierTargetInput({ type: 'discord', channel: '  ' }, 'target')).toThrow(/target.channel/);
    expect(() => parseNotifierTargetInput({ type: 'discord', channel: '#alerts', token: 'x' }, 'target')).toThrow(/target.token is not a field/);
  });
});

describe('assertNotifierName', () => {
  it('accepts any words up to the limit, trimmed, and refuses a blank one', () => {
    expect(assertNotifierName('  Home alerts ', 'name')).toBe('Home alerts');
    expect(() => assertNotifierName('   ', 'name')).toThrow(/name/);
    expect(() => assertNotifierName('x'.repeat(101), 'name')).toThrow(/1 to 100 characters/);
  });
});
