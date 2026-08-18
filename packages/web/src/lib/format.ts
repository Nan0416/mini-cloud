const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Placeholder for a value the service has not reported. Never an empty cell. */
export const NA = '—';

/**
 * A duration in the largest two units that fit — "2 hours 15 minutes", not
 * "8100000 ms". Two units is the point where the string stops being a number and
 * starts being readable, and adding a third only ever added noise.
 */
export function formatDuration(ms: number, precision: number = 2): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return `${ms} ms`;
  }

  const units: ReadonlyArray<{ readonly ms: number; readonly one: string; readonly many: string }> = [
    { ms: WEEK, one: 'week', many: 'weeks' },
    { ms: DAY, one: 'day', many: 'days' },
    { ms: HOUR, one: 'hour', many: 'hours' },
    { ms: MINUTE, one: 'minute', many: 'minutes' },
    { ms: SECOND, one: 'second', many: 'seconds' },
  ];

  const parts: string[] = [];
  let remaining = Math.floor(ms);
  for (const unit of units) {
    if (parts.length >= precision) {
      break;
    }
    const count = Math.floor(remaining / unit.ms);
    if (count > 0) {
      parts.push(`${count} ${count === 1 ? unit.one : unit.many}`);
      remaining -= count * unit.ms;
    }
  }

  if (parts.length === 0) {
    return `${Math.floor(ms)} ms`;
  }
  if (parts.length < precision && remaining > 0) {
    parts.push(`${remaining} ms`);
  }
  return parts.join(' ');
}

/** `hh:mm:ss`, the form the task form takes a job interval in. */
export function durationToHhmmss(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / SECOND));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

const HHMMSS = /^(\d+):([0-5]?\d):([0-5]?\d)$/;

/** Parses `hh:mm:ss` into ms, or `undefined` when it is not that shape. */
export function hhmmssToDuration(value: string): number | undefined {
  const match = HHMMSS.exec(value.trim());
  if (match === null) {
    return undefined;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  return (hours * 3600 + minutes * 60 + seconds) * SECOND;
}

/**
 * Absolute time in the viewer's own timezone.
 *
 * The legacy console let you pick between US Eastern, US Pacific, UTC and local. The
 * browser already knows where it is and a home lab is not spread across timezones,
 * so this drops the preference and always renders local, with the offset shown so a
 * screenshot is still unambiguous.
 */
export function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return NA;
  }
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

/** Short form for dense table cells: `14:03:22` today, `Mar 04 14:03` otherwise. */
export function formatTimestampShort(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return NA;
  }
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return new Intl.DateTimeFormat(undefined, {
    month: sameDay ? undefined : 'short',
    day: sameDay ? undefined : '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: sameDay ? '2-digit' : undefined,
    hour12: false,
  }).format(date);
}

/** "3 minutes ago" / "in 2 hours". Uses the platform formatter, so it localises. */
export function formatRelative(ms: number, now: number = Date.now()): string {
  const delta = ms - now;
  const absolute = Math.abs(delta);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  if (absolute < MINUTE) {
    return formatter.format(Math.round(delta / SECOND), 'second');
  }
  if (absolute < HOUR) {
    return formatter.format(Math.round(delta / MINUTE), 'minute');
  }
  if (absolute < DAY) {
    return formatter.format(Math.round(delta / HOUR), 'hour');
  }
  return formatter.format(Math.round(delta / DAY), 'day');
}

/** Splits a `datetime-local` value into the epoch ms the API takes. */
export function localDateTimeToTimestamp(value: string): number | undefined {
  if (value.trim().length === 0) {
    return undefined;
  }
  const parsed = new Date(value);
  const ms = parsed.getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

/** The inverse, for populating a `datetime-local` input from a stored timestamp. */
export function timestampToLocalDateTime(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Renders an event payload for display. Objects are pretty-printed, strings kept. */
export function formatPayload(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload;
  }
  if (payload === undefined) {
    return '';
  }
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    // A payload with a cycle in it should not blank the whole event log.
    return String(payload);
  }
}

/** First line only, for a table cell that must stay one row tall. */
export function firstLine(text: string, limit: number = 160): string {
  const line = text.split('\n')[0] ?? '';
  return line.length > limit ? `${line.slice(0, limit)}…` : line;
}
