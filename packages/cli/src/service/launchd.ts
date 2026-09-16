import { LoggerFactory } from '@mini-cloud/shared';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { getDaemonPaths } from '../paths';
import { InstallOptions, LogsOptions, ServiceManager, ServiceStatus } from './types';

const logger = LoggerFactory.getLogger('launchd');

/** Reverse-DNS, matching the domain the console is served from. */
export const LAUNCHD_LABEL = 'dev.qinnan.mini-cloud';

function plistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * `KeepAlive: SuccessfulExit=false`, not `true`: a crash comes back, a clean exit stays
 * down. With `true`, launchd undoes `daemon stop` within the second.
 *
 * Independent of `enable`, which is start-at-login and is `RunAtLoad` alone. Tying
 * crash recovery to it made `--no-enable` mean something different on each platform,
 * since the systemd unit keeps `Restart=on-failure` either way.
 */
export function buildPlist(options: InstallOptions): string {
  const argumentsXml = options.programArguments.map((argument) => `    <string>${xmlEscape(argument)}</string>`).join('\n');
  const environmentXml = Object.entries(options.env)
    .map(([key, value]) => `    <key>${xmlEscape(key)}</key>\n    <string>${xmlEscape(value)}</string>`)
    .join('\n');
  const keepAlive = '<dict>\n    <key>SuccessfulExit</key>\n    <false/>\n  </dict>';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(LAUNCHD_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
${argumentsXml}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${environmentXml}
  </dict>
  <key>RunAtLoad</key>
  ${options.enable ? '<true/>' : '<false/>'}
  <key>KeepAlive</key>
  ${keepAlive}
  <key>StandardOutPath</key>
  <string>${xmlEscape(options.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(options.logPath)}</string>
  <key>ExitTimeOut</key>
  <integer>30</integer>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
}

/** Blocks the calling thread; install is synchronous. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export class LaunchdServiceManager implements ServiceManager {
  private readonly plist = plistPath();

  private get domainTarget(): string {
    return `gui/${process.getuid?.() ?? 0}`;
  }

  private get serviceTarget(): string {
    return `${this.domainTarget}/${LAUNCHD_LABEL}`;
  }

  /** stderr captured, not inherited: a `bootout` of an unloaded label fails noisily. */
  private launchctl(args: ReadonlyArray<string>): string {
    logger.debug(`launchctl ${args.join(' ')}`);
    return execFileSync('launchctl', [...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }

  unitPath(): string {
    return this.plist;
  }

  isInstalled(): boolean {
    return existsSync(this.plist);
  }

  install(options: InstallOptions): void {
    mkdirSync(dirname(this.plist), { recursive: true });
    mkdirSync(dirname(options.logPath), { recursive: true });
    writeFileSync(this.plist, buildPlist(options), { encoding: 'utf8', mode: 0o600 });
    logger.info(`Wrote ${this.plist}`);

    this.tryBootout();
    this.launchctl(['bootstrap', this.domainTarget, this.plist]);
    // `bootstrap` returns before the job is up, so a status() read would race it.
    this.start();
  }

  private tryBootout(): void {
    try {
      this.launchctl(['bootout', this.serviceTarget]);
    } catch {
      return; // Not loaded.
    }
    this.waitUntilUnloaded();
  }

  private isLoaded(): boolean {
    try {
      this.launchctl(['list', LAUNCHD_LABEL]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * `bootout` returns before launchd has finished tearing down, and re-`bootstrap`ing
   * inside that window fails with "5: Input/output error".
   */
  private waitUntilUnloaded(): void {
    const deadline = Date.now() + 35_000;
    while (this.isLoaded()) {
      if (Date.now() > deadline) {
        logger.warn(`${LAUNCHD_LABEL} is still loaded after 35s; continuing anyway.`);
        return;
      }
      sleepSync(200);
    }
  }

  uninstall(): void {
    this.tryBootout();
    if (existsSync(this.plist)) {
      unlinkSync(this.plist);
      logger.info(`Removed ${this.plist}`);
    }
  }

  start(): void {
    this.launchctl(['kickstart', this.serviceTarget]);
  }

  /**
   * SIGTERM, so the exit is clean and KeepAlive leaves it down. SIGKILL would read as a
   * crash and be relaunched; the escape hatch for a wedged daemon is `uninstall`.
   */
  stop(): void {
    try {
      this.launchctl(['kill', 'SIGTERM', this.serviceTarget]);
    } catch {
      // Already stopped.
    }
  }

  restart(): void {
    this.launchctl(['kickstart', '-k', this.serviceTarget]);
  }

  status(): ServiceStatus {
    if (!this.isInstalled()) {
      return { state: 'not-installed' };
    }
    // Read from the plist, not from "is loaded": a --no-enable service is both.
    const enabled = this.runAtLoad();
    try {
      const listed = this.launchctl(['list', LAUNCHD_LABEL]);
      const pid = /"PID"\s*=\s*(\d+)/.exec(listed);
      return pid === null ? { state: 'stopped', enabled } : { state: 'running', pid: Number(pid[1]), enabled };
    } catch {
      // On disk but not loaded; a LaunchAgent still loads at the next login.
      return { state: 'stopped', enabled };
    }
  }

  private runAtLoad(): boolean {
    try {
      return /<key>RunAtLoad<\/key>\s*<true\s*\/>/.test(readFileSync(this.plist, 'utf8'));
    } catch {
      return false;
    }
  }

  /** `-F`, not `-f`: reopen by name, so rotation does not leave us on a dead inode. */
  logs(options: LogsOptions): void {
    const { logPath } = getDaemonPaths();
    if (!existsSync(logPath)) {
      throw new Error(`No log file at ${logPath} yet. The daemon writes one once it has started; check \`mini-cloud daemon status\`.`);
    }
    execFileSync('tail', ['-n', String(options.lines), ...(options.follow ? ['-F'] : []), logPath], { stdio: 'inherit' });
  }
}
