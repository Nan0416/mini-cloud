/** Reads an environment variable, falling back to `fallback` when unset. */
export function getenv(name: string, fallback?: string): string {
  const value = process.env[name];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (typeof fallback === 'string') {
    return fallback;
  }
  throw new Error(`Required environment variable ${name} is not set`);
}

export function getenvInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  const value = Number(raw);
  if (Number.isNaN(value) || !Number.isInteger(value)) {
    throw new Error(`Environment variable ${name} must be an integer, got "${raw}"`);
  }
  return value;
}

export function getenvBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  const normalised = raw.toLowerCase();
  if (normalised === 'true' || normalised === '1') {
    return true;
  }
  if (normalised === 'false' || normalised === '0') {
    return false;
  }
  throw new Error(`Environment variable ${name} must be a boolean, got "${raw}"`);
}

export function getenvOneOf<T extends string>(name: string, allowed: ReadonlyArray<T>, fallback: T): T {
  const raw = process.env[name];
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  const match = allowed.find((candidate) => candidate === raw);
  if (match === undefined) {
    throw new Error(`Environment variable ${name} must be one of [${allowed.join(', ')}], got "${raw}"`);
  }
  return match;
}
