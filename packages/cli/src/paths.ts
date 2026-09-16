import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Where the CLI keeps state that outlives a single command.
 *
 * `~/.mini-cloud` is the agent's directory too (`MINI_CLOUD_AGENT_DIR` defaults to
 * `~/.mini-cloud/agent`), so the control plane's files sit beside it under a name of
 * their own rather than colonising the root: one place to look on a machine running
 * both, and no chance of a `daemon uninstall` taking an agent's buffered reports
 * with it.
 */
export interface DaemonPaths {
  /** Everything the daemon owns. */
  readonly dataDir: string;
  /** Where launchd sends the service's stdout and stderr. Unused under systemd. */
  readonly logPath: string;
}

export function getDaemonPaths(): DaemonPaths {
  const dataDir = join(homedir(), '.mini-cloud', 'service');
  return { dataDir, logPath: join(dataDir, 'service.log') };
}
