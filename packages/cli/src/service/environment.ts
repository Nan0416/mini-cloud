/**
 * What gets written into the unit.
 *
 * Almost nothing, and that is the point. Configuration lives in
 * `~/.mini-cloud/config.json`, which the control plane reads at startup whether a
 * terminal, launchd or systemd started it — so the unit carries no settings, holds no
 * token, and never goes stale against the file. Reconfiguring is editing that file and
 * restarting; it is not reinstalling the service.
 *
 * `HOME` is essential rather than convenient: it is how the config file is found at
 * all, and a unit without it would read defaults and look like the file was ignored.
 * `PATH` comes along because the control plane spawns nothing without one.
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
