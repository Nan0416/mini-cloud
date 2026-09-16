import { homedir } from 'node:os';
import { join } from 'node:path';

export interface DaemonPaths {
  readonly dataDir: string;
  /** Where launchd sends stdout and stderr. Unused under systemd, which has journald. */
  readonly logPath: string;
}

/** Under `service/` rather than the root of `~/.mini-cloud`, which the agent also uses. */
export function getDaemonPaths(): DaemonPaths {
  const dataDir = join(homedir(), '.mini-cloud', 'service');
  return { dataDir, logPath: join(dataDir, 'service.log') };
}
