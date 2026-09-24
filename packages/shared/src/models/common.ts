/** Environment variables injected into a launched task process. */
export interface EnvironmentVariables {
  readonly [key: string]: string;
}

/**
 * `${NAME}` placeholders substituted into a task's cmd/cwd/arguments/env before launch.
 * Lets one task definition target machines with different directory layouts.
 */
export interface ReplacementVariables {
  readonly [key: string]: string;
}

/**
 * The furthest from the epoch a `Date` reaches, either way. Past it `toISOString()`
 * throws a bare `RangeError`, which would surface as a 500 for what is a bad request.
 */
export const MAX_TIMESTAMP_MS = 8_640_000_000_000_000;
