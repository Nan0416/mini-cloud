import { customAlphabet } from 'nanoid';

// Digits only: task ids get typed and read aloud, and mixed-case ids invite
// transcription mistakes.
const taskId = customAlphabet('0123456789', 10);

// Lowercase alphanumeric: instance ids appear in file paths and URLs.
const instanceId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

// Lowercase alphanumeric with a prefix, so an id in a log line says what it names.
const notifierId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

const eventId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);

export function generateTaskId(): string {
  return taskId();
}

export function generateInstanceId(): string {
  return instanceId();
}

export function generateEventId(): string {
  return eventId();
}

export function generateNotifierId(): string {
  return `ntf-${notifierId()}`;
}
