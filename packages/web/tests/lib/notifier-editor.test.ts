import type { Monitor, Notifier } from '@mini-cloud/shared';
import { BLANK_NOTIFIER_FORM, monitorsUsing, notifierFormOf, notifierOf } from '../../src/lib/notifier-editor';

const URL = 'https://discord.com/api/webhooks/123/token';

const aNotifier: Notifier = {
  notifierId: 'ntf-a',
  name: 'Alerts',
  description: 'Home',
  target: { type: 'discord', channel: '#alerts', webhookId: '123' },
  version: 2,
  createdAt: 0,
  updatedAt: 0,
};

describe('notifierOf', () => {
  it('builds a Discord notifier from what was typed, trimmed', () => {
    expect(notifierOf({ name: ' Alerts ', description: ' ', channel: ' #alerts ', webhookUrl: ` ${URL} ` }, 'create')).toEqual({
      notifier: { name: 'Alerts', description: undefined, target: { type: 'discord', channel: '#alerts', webhookUrl: URL } },
    });
  });

  it('insists on a webhook URL for a new notifier, and leaves it out of an edit that keeps the stored one', () => {
    const values = { ...BLANK_NOTIFIER_FORM, name: 'Alerts', channel: '#alerts' };

    expect(notifierOf(values, 'create').problem).toMatch(/webhook URL/);
    expect(notifierOf(values, 'edit').notifier?.target).toEqual({ type: 'discord', channel: '#alerts' });
  });

  it('names the field by its label when the service’s own rules refuse it', () => {
    expect(notifierOf({ ...BLANK_NOTIFIER_FORM, name: 'Alerts', channel: '#alerts', webhookUrl: 'https://example.com/hook' }, 'create').problem).toMatch(
      /^The webhook URL is not a Discord webhook URL/,
    );
    expect(notifierOf({ ...BLANK_NOTIFIER_FORM, name: 'Alerts', channel: '', webhookUrl: URL }, 'create').problem).toMatch(/^The channel/);
  });
});

describe('notifierFormOf', () => {
  it('starts an edit from the notifier, with the webhook box empty because the URL is never sent back', () => {
    expect(notifierFormOf(aNotifier)).toEqual({ name: 'Alerts', description: 'Home', channel: '#alerts', webhookUrl: '' });
  });
});

describe('monitorsUsing', () => {
  it('names the monitors that send to a notifier', () => {
    const monitors = [
      { name: 'nas-cpu', notifierIds: ['ntf-a', 'ntf-b'] },
      { name: 'nas-disk', notifierIds: ['ntf-b'] },
    ] as unknown as ReadonlyArray<Monitor>;

    expect(monitorsUsing('ntf-a', monitors)).toEqual(['nas-cpu']);
    expect(monitorsUsing('ntf-c', monitors)).toEqual([]);
  });
});
