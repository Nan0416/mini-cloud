/**
 * The unit carries no settings — those live in `~/.mini-cloud/config.json`. What it does
 * carry is the part of the installing shell a supervisor would not provide: `HOME` is how
 * that file is found at all, and nothing is spawned without a `PATH`.
 */
export function unitEnvironment(keys: ReadonlyArray<string>, source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value.length > 0) {
      environment[key] = value;
    }
  }
  return environment;
}
