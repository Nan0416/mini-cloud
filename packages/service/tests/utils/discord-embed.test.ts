import { DISCORD_EMBED_LIMITS, discordWebhookBody, truncate } from '../../src/utils/discord-embed';
import { NotificationMessage } from '../../src/utils/notification-message';

const aMessage = (overrides: Partial<NotificationMessage> = {}): NotificationMessage => ({
  title: '[SEV-2] nas-cpu is in ALARM',
  body: 'CPU is high.',
  tone: 'problem',
  severity: 2,
  link: 'https://console.example/monitors/nas-cpu',
  fields: [{ name: 'Was', value: 'OK', inline: true }],
  timestamp: Date.UTC(2026, 9, 4, 12, 0),
  ...overrides,
});

const embedOf = (message: NotificationMessage) => {
  const [embed] = discordWebhookBody(message).embeds ?? [];
  return embed;
};

describe('discordWebhookBody', () => {
  it('posts the message as one embed, linked and stamped', () => {
    expect(embedOf(aMessage())).toEqual({
      title: '[SEV-2] nas-cpu is in ALARM',
      description: 'CPU is high.',
      url: 'https://console.example/monitors/nas-cpu',
      color: 0xe8590c,
      fields: [{ name: 'Was', value: 'OK', inline: true }],
      footer: { text: 'mini-cloud' },
      timestamp: '2026-10-04T12:00:00.000Z',
    });
  });

  it('colours a problem by its severity, and its end and news by tone alone', () => {
    const colors = ([1, 2, 3, 4, 5] as const).map((severity) => embedOf(aMessage({ severity })).color);

    expect(new Set(colors).size).toBe(5);
    expect(embedOf(aMessage({ tone: 'resolved' })).color).toBe(0x2f9e44);
    expect(embedOf(aMessage({ tone: 'info', severity: undefined })).color).toBe(0x868e96);
  });

  it('pings nobody, whatever the message says', () => {
    expect(discordWebhookBody(aMessage({ body: '@everyone the NAS is on fire' })).allowed_mentions).toEqual({ parse: [] });
  });

  it('cuts every part to Discord’s limits rather than have the whole post refused', () => {
    const embed = embedOf(
      aMessage({
        title: 't'.repeat(300),
        body: 'b'.repeat(5000),
        fields: Array.from({ length: 30 }, () => ({ name: 'n'.repeat(300), value: 'v'.repeat(2000) })),
      }),
    );
    const fields = embed.fields ?? [];
    const total =
      (embed.title?.length ?? 0) +
      (embed.description?.length ?? 0) +
      (embed.footer?.text.length ?? 0) +
      fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);

    expect(embed.title).toHaveLength(DISCORD_EMBED_LIMITS.title);
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.length).toBeLessThanOrEqual(DISCORD_EMBED_LIMITS.fields);
    expect(fields[0].name).toHaveLength(DISCORD_EMBED_LIMITS.fieldName);
    expect(fields[0].value).toHaveLength(DISCORD_EMBED_LIMITS.fieldValue);
    expect(total).toBeLessThanOrEqual(DISCORD_EMBED_LIMITS.total);
  });

  it('keeps at most 25 fields even when they are short', () => {
    const fields = Array.from({ length: 30 }, (_, index) => ({ name: `n${index}`, value: 'v' }));

    expect(embedOf(aMessage({ fields })).fields).toHaveLength(DISCORD_EMBED_LIMITS.fields);
  });

  it('fills an empty field rather than send one Discord refuses', () => {
    expect(embedOf(aMessage({ fields: [{ name: '', value: '' }] })).fields).toEqual([{ name: '—', value: '—', inline: false }]);
  });
});

describe('truncate', () => {
  it('leaves what fits, and ends what does not with an ellipsis inside the limit', () => {
    expect(truncate('abc', 3)).toBe('abc');
    expect(truncate('abcd', 3)).toBe('ab…');
    expect(truncate('abcd', 0)).toBe('');
  });
});
