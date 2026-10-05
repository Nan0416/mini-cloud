import { Monitor, MonitorSeverity, MonitorStateChange, MonitorState } from '@mini-cloud/shared';

/** What a message is about, which decides how it looks: a problem, its end, or news. */
export type NotificationTone = 'problem' | 'resolved' | 'info';

export interface NotificationField {
  readonly name: string;
  readonly value: string;
  /** Laid out beside its neighbours where the notifier can. */
  readonly inline?: boolean;
}

/**
 * One message, in terms every kind of notifier can render. Nothing here is an alarm's:
 * a monitor is one sender of these, and not the last.
 */
export interface NotificationMessage {
  readonly title: string;
  readonly body: string;
  readonly tone: NotificationTone;
  /** For a problem: 1 is the most urgent. */
  readonly severity?: MonitorSeverity;
  /** Where to look for more, such as the monitor in the console. */
  readonly link?: string;
  readonly fields: ReadonlyArray<NotificationField>;
  readonly timestamp: number;
}

const TONES: Readonly<Record<MonitorState, NotificationTone>> = {
  ALARM: 'problem',
  OK: 'resolved',
  INSUFFICIENT_DATA: 'info',
};

function titleOf(monitor: Monitor, state: MonitorState): string {
  switch (state) {
    case 'ALARM':
      return `[SEV-${monitor.severity}] ${monitor.name} is in ALARM`;
    case 'OK':
      return `${monitor.name} is OK`;
    case 'INSUFFICIENT_DATA':
      return `${monitor.name} has insufficient data`;
  }
}

/** Where the console shows a monitor, or nothing when no console is configured. */
export function monitorLink(consoleUrl: string, monitorName: string): string | undefined {
  const base = consoleUrl.trim().replace(/\/+$/, '');
  return base.length === 0 ? undefined : `${base}/monitors/${encodeURIComponent(monitorName)}`;
}

export interface AlarmMessageInput {
  readonly monitor: Monitor;
  readonly change: MonitorStateChange;
  readonly consoleUrl: string;
}

/** A monitor's change of state, as a message. */
export function alarmMessage({ monitor, change, consoleUrl }: AlarmMessageInput): NotificationMessage {
  const { metric } = monitor;
  const dimensions = Object.entries(metric.dimensions)
    .map(([name, value]) => `${name}=${value}`)
    .join(', ');
  return {
    title: titleOf(monitor, change.toState),
    body: monitor.description === undefined ? change.reason : `${monitor.description}\n\n${change.reason}`,
    tone: TONES[change.toState],
    severity: monitor.severity,
    link: monitorLink(consoleUrl, monitor.name),
    fields: [
      { name: 'Metric', value: `${metric.namespace} ${metric.metricName} (${metric.statistic})${dimensions.length === 0 ? '' : `\n${dimensions}`}` },
      { name: 'Severity', value: `SEV-${monitor.severity}`, inline: true },
      { name: 'Was', value: change.fromState, inline: true },
    ],
    timestamp: change.changedAt,
  };
}

/** What "Send test" sends: plainly a test, so nobody acts on it. */
export function testMessage(notifierName: string, now: number): NotificationMessage {
  return {
    title: 'mini-cloud test message',
    body: `If you can read this, the notifier "${notifierName}" works. Nothing is wrong.`,
    tone: 'info',
    fields: [],
    timestamp: now,
  };
}
