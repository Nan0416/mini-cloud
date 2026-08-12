import { EnvironmentVariables, ReplacementVariables } from '../models/common';
import { HealthCheck } from '../models/task';

const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Substitutes `${NAME}` placeholders in a single pass.
 *
 * One pass matters: substituted values are not themselves rescanned, so a variable
 * whose value happens to contain `${...}` cannot trigger a second round of expansion
 * and the result does not depend on the order variables were declared in. Unknown
 * placeholders are left as-is so a typo is visible in the launched command rather
 * than silently becoming an empty string.
 */
export function substituteVariables(input: string, variables: ReplacementVariables): string {
  return input.replace(PLACEHOLDER, (match, name: string) => {
    const value = variables[name];
    return typeof value === 'string' ? value : match;
  });
}

function substituteEnv(env: EnvironmentVariables, variables: ReplacementVariables): EnvironmentVariables {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    result[key] = substituteVariables(value, variables);
  }
  return result;
}

function substituteHealthCheck(healthCheck: HealthCheck, variables: ReplacementVariables): HealthCheck {
  if (healthCheck.type === 'ping') {
    return { ...healthCheck, url: substituteVariables(healthCheck.url, variables) };
  }
  return healthCheck;
}

/** The subset of a task or launch instruction that supports variable substitution. */
export interface SubstitutableFields {
  readonly cmd: string;
  readonly cwd: string;
  readonly arguments?: ReadonlyArray<string>;
  readonly env?: EnvironmentVariables;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly healthCheck?: HealthCheck;
}

/**
 * Applied twice on the way to a running process: once by the service using
 * fleet-wide variables, then again by the agent using host-local ones such as
 * `${HOME}`. Unknown placeholders surviving the first pass are what makes the
 * second pass possible.
 */
export function substituteLaunchFields<T extends SubstitutableFields>(fields: T, variables: ReplacementVariables): T {
  return {
    ...fields,
    cmd: substituteVariables(fields.cmd, variables),
    cwd: substituteVariables(fields.cwd, variables),
    arguments: fields.arguments?.map((arg) => substituteVariables(arg, variables)),
    env: fields.env === undefined ? undefined : substituteEnv(fields.env, variables),
    stdout: fields.stdout === undefined ? undefined : substituteVariables(fields.stdout, variables),
    stderr: fields.stderr === undefined ? undefined : substituteVariables(fields.stderr, variables),
    healthCheck: fields.healthCheck === undefined ? undefined : substituteHealthCheck(fields.healthCheck, variables),
  };
}
