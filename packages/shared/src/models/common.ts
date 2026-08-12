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
