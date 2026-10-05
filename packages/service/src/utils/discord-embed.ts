import type { MonitorSeverity } from '@mini-cloud/shared';
import type { APIEmbed, APIEmbedField, RESTPostAPIWebhookWithTokenJSONBody } from 'discord-api-types/v10';
import { NotificationMessage, NotificationTone } from './notification-message';

/** Discord rejects the whole message when an embed breaks one of these, so everything is cut to fit first. */
export const DISCORD_EMBED_LIMITS = {
  title: 256,
  description: 4096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  /** Across the title, description, field names and values, and footer together. */
  total: 6000,
} as const;

/** Red for the most urgent, warming to amber for the least. */
const SEVERITY_COLORS: Readonly<Record<MonitorSeverity, number>> = {
  1: 0xc92a2a,
  2: 0xe8590c,
  3: 0xf08c00,
  4: 0xf59f00,
  5: 0xfab005,
};

const TONE_COLORS: Readonly<Record<Exclude<NotificationTone, 'problem'>, number>> = {
  resolved: 0x2f9e44,
  info: 0x868e96,
};

const FOOTER = 'mini-cloud';

function colorOf(message: NotificationMessage): number {
  if (message.tone === 'problem') {
    return SEVERITY_COLORS[message.severity ?? 1];
  }
  return TONE_COLORS[message.tone];
}

/** At most `limit` characters, the last of them an ellipsis when anything was cut. */
export function truncate(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return limit <= 0 ? '' : `${text.slice(0, limit - 1)}…`;
}

function toField(field: NotificationMessage['fields'][number]): APIEmbedField {
  // Discord refuses an empty name or value outright.
  return {
    name: truncate(field.name.length === 0 ? '—' : field.name, DISCORD_EMBED_LIMITS.fieldName),
    value: truncate(field.value.length === 0 ? '—' : field.value, DISCORD_EMBED_LIMITS.fieldValue),
    inline: field.inline ?? false,
  };
}

/**
 * A message as the body of a webhook post: one embed, coloured by tone and severity.
 *
 * Mentions are switched off, so a monitor whose description says `@everyone` reports
 * it rather than pinging a whole server.
 */
export function discordWebhookBody(message: NotificationMessage): RESTPostAPIWebhookWithTokenJSONBody {
  const title = truncate(message.title, DISCORD_EMBED_LIMITS.title);
  // Fields keep their order and the ones that no longer fit are dropped; the
  // description, the part that grows, then takes whatever room is left.
  let room = DISCORD_EMBED_LIMITS.total - title.length - FOOTER.length;
  const fields: APIEmbedField[] = [];
  for (const field of message.fields.slice(0, DISCORD_EMBED_LIMITS.fields).map(toField)) {
    const size = field.name.length + field.value.length;
    if (size > room) {
      break;
    }
    fields.push(field);
    room -= size;
  }
  const description = truncate(message.body, Math.min(DISCORD_EMBED_LIMITS.description, room));

  const embed: APIEmbed = {
    title,
    description: description.length === 0 ? undefined : description,
    url: message.link,
    color: colorOf(message),
    fields,
    footer: { text: FOOTER },
    timestamp: new Date(message.timestamp).toISOString(),
  };
  return { embeds: [embed], allowed_mentions: { parse: [] } };
}
