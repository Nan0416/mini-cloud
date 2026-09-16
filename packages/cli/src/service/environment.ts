/**
 * The unit carries no settings — those live in `~/.mini-cloud/config.json`. `HOME` is
 * how that file is found at all, and the control plane spawns nothing without a `PATH`.
 */
export function unitEnvironment(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of ['HOME', 'PATH'] as const) {
    const value = source[key];
    if (value !== undefined && value.length > 0) {
      environment[key] = value;
    }
  }
  return environment;
}
