import {
  assertNotifierName,
  assertOptionalNotifierDescription,
  parseNotifierTargetInput,
  type CreateNotifierRequest,
  type Monitor,
  type Notifier,
  type NotifierTargetInput,
} from '@mini-cloud/shared';

/** What the notifier dialog holds. Discord is the only type so far, so there is no type to choose. */
export interface NotifierFormValues {
  readonly name: string;
  readonly description: string;
  readonly channel: string;
  /** Empty on an edit means "keep the stored webhook". */
  readonly webhookUrl: string;
}

export const BLANK_NOTIFIER_FORM: NotifierFormValues = { name: '', description: '', channel: '', webhookUrl: '' };

/** An existing notifier, as the form starts from. Its webhook URL is never sent back, so that box starts empty. */
export function notifierFormOf(notifier: Notifier): NotifierFormValues {
  return { name: notifier.name, description: notifier.description ?? '', channel: notifier.target.channel, webhookUrl: '' };
}

export type NotifierFormResult = { readonly notifier: CreateNotifierRequest; readonly problem?: undefined } | { readonly notifier?: undefined; readonly problem: string };

const FIELD_LABELS: Readonly<Record<string, string>> = {
  name: 'The name',
  description: 'The description',
  'target.channel': 'The channel',
  'target.webhookUrl': 'The webhook URL',
};

/**
 * The notifier the form describes, or what stops it being one. The shared parsers are
 * the judge, so the form cannot accept what the service would refuse; only a create
 * insists on a webhook URL.
 */
export function notifierOf(values: NotifierFormValues, mode: 'create' | 'edit'): NotifierFormResult {
  const webhookUrl = values.webhookUrl.trim();
  if (mode === 'create' && webhookUrl.length === 0) {
    return { problem: 'Paste the channel’s webhook URL.' };
  }
  try {
    const target: NotifierTargetInput = parseNotifierTargetInput(
      { type: 'discord', channel: values.channel, webhookUrl: webhookUrl.length === 0 ? undefined : webhookUrl },
      'target',
    );
    return {
      notifier: {
        name: assertNotifierName(values.name, 'name'),
        description: assertOptionalNotifierDescription(values.description.trim(), 'description'),
        target,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { problem: message.replace(/^(target\.\w+|name|description)\b/, (field) => FIELD_LABELS[field] ?? field) };
  }
}

/** The monitors that send to a notifier, by name. */
export function monitorsUsing(notifierId: string, monitors: ReadonlyArray<Monitor>): ReadonlyArray<string> {
  return monitors.filter((monitor) => monitor.notifierIds.includes(notifierId)).map((monitor) => monitor.name);
}
