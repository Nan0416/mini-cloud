import { InvalidRequestError } from '../errors';
import { NOTIFIER_LIMITS, NOTIFIER_TYPES, NotifierTargetInput } from '../models/notifier';
import { assertKnownFields, assertNonEmptyString, assertOneOf, assertOptionalString, assertRecord } from './assertions';

// Discord serves webhooks from its canary and PTB hosts and the old discordapp.com
// domain too, and a URL copied from any of them works the same.
const DISCORD_WEBHOOK_URL = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/(\d+)\/([A-Za-z0-9_-]+)\/?$/;

const DISCORD_TARGET_KEYS = ['type', 'channel', 'webhookUrl'];

export interface DiscordWebhook {
  readonly webhookId: string;
}

/** The webhook a URL names, or `undefined` when it is not a Discord webhook URL. */
export function parseDiscordWebhookUrl(url: string): DiscordWebhook | undefined {
  const match = DISCORD_WEBHOOK_URL.exec(url.trim());
  return match === null ? undefined : { webhookId: match[1] };
}

export function assertNotifierName(value: unknown, field: string): string {
  const name = assertNonEmptyString(value, field).trim();
  if (name.length === 0 || name.length > NOTIFIER_LIMITS.nameLength) {
    throw new InvalidRequestError(`${field} must be 1 to ${NOTIFIER_LIMITS.nameLength} characters, like "Home alerts"`);
  }
  return name;
}

export function assertOptionalNotifierDescription(value: unknown, field: string): string | undefined {
  const description = assertOptionalString(value, field);
  if (description !== undefined && description.length > NOTIFIER_LIMITS.descriptionLength) {
    throw new InvalidRequestError(`${field} must be at most ${NOTIFIER_LIMITS.descriptionLength} characters`);
  }
  return description === undefined || description.trim().length === 0 ? undefined : description;
}

/**
 * Checks a target as written. The webhook URL may be left out, which an update reads
 * as "keep the stored one"; a create has to insist on it itself.
 */
export function parseNotifierTargetInput(value: unknown, field: string): NotifierTargetInput {
  const record = assertRecord(value, field);
  const type = assertOneOf(record['type'], `${field}.type`, NOTIFIER_TYPES);
  switch (type) {
    case 'discord': {
      assertKnownFields(record, field, DISCORD_TARGET_KEYS);
      const channel = assertNonEmptyString(record['channel'], `${field}.channel`).trim();
      if (channel.length === 0 || channel.length > NOTIFIER_LIMITS.channelLength) {
        throw new InvalidRequestError(`${field}.channel must be 1 to ${NOTIFIER_LIMITS.channelLength} characters, like "#alerts"`);
      }
      const webhookUrl = assertOptionalString(record['webhookUrl'], `${field}.webhookUrl`);
      if (webhookUrl === undefined) {
        return { type, channel };
      }
      // The URL is never echoed back: it is the credential, and errors end up in logs.
      if (parseDiscordWebhookUrl(webhookUrl) === undefined) {
        throw new InvalidRequestError(
          `${field}.webhookUrl is not a Discord webhook URL. Copy it from the channel's Integrations → Webhooks; it looks like https://discord.com/api/webhooks/<id>/<token>`,
        );
      }
      return { type, channel, webhookUrl: webhookUrl.trim() };
    }
  }
}
