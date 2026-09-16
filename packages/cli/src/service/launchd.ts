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
 * Renders the LaunchAgent. Pure, and exported so a test can read what was written
 * without a Mac to load it on.
 *
 * `KeepAlive` is `SuccessfulExit=false` rather than `true`, which is the launchd
 * spelling of systemd's `Restart=on-failure`: a crash comes back, a clean exit stays
 * down. With plain `true`, `daemon stop` would be undone by launchd within the second.
 *
 * Note what that means for a control plane whose database is not up yet: Postgres
 * refusing a connection is a crash, so the service restarts in a loop until Postgres
 * answers. That is the behaviour we want — launchd has no way to order a user agent
 * after a system service — but it does mean a machine booting with Postgres slow to
 * start writes a few failures to the log before settling.
 */
export function buildPlist(options: InstallOptions): string {
  const argumentsXml = options.programArguments.map((argument) => `    <string>${xmlEscape(argument)}</string>`).join('\n');
  const environmentXml = Object.entries(options.env)
    .map(([key, value]) => `    <key>${xmlEscape(key)}</key>\n    <string>${xmlEscape(value)}</string>`)
    .join('\n');
  const keepAlive = options.enable ? '<dict>\n    <key>SuccessfulExit</key>\n    <false/>\n  </dict>' : '<false/>';

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

/** Blocks the calling thread; install is synchronous and has nothing else to do. */
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

  /**
   * stderr is captured rather than inherited: a `bootout` of a label that was never
   * loaded fails, and leaking "Boot-out failed: 3: No such process" to the console on
   * a first install reads like something went wrong. The text still reaches the thrown
   * error for anything that needs it.
   */
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
    // 0600, not 0644: this file has MINI_CLOUD_PUBLIC_TOKEN in it.
    writeFileSync(this.plist, buildPlist(options), { encoding: 'utf8', mode: 0o600 });
    logger.info(`Wrote ${this.plist}`);

    this.tryBootout();
    this.launchctl(['bootstrap', this.domainTarget, this.plist]);
    // `bootstrap` returns before launchd has spun the job up, so a status() read now
    // would race it and report `stopped`. `kickstart` starts it synchronously and is a
    // no-op when RunAtLoad already did, so it is always safe to follow with.
    this.start();
  }

  private tryBootout(): void {
    try {
      this.launchctl(['bootout', this.serviceTarget]);
    } catch {
      return; // Not loaded: nothing to tear down, and nothing to wait for.
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
   * `bootout` signals the job and returns; launchd finishes the teardown afterwards.
   * The control plane shuts down gracefully, so the label lingers for a moment — and
   * re-`bootstrap`ing inside that window fails with "5: Input/output error". Bounded
   * by the plist's own ExitTimeOut plus headroom, then we proceed and let the next
   * command report the real problem rather than hanging here forever.
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
   * SIGTERM and let it exit cleanly. Because KeepAlive only relaunches an unsuccessful
   * exit, a graceful stop sticks without unloading the plist — so the service is still
   * installed and still starts at the next login. A SIGKILL would read as a crash and
   * be relaunched immediately, which is why the escape hatch for a wedged daemon is
   * `uninstall` rather than a harder signal.
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
    // `enabled` means start-at-login, which for launchd is RunAtLoad — read from the
    // plist rather than inferred from "is loaded", because a service installed with
    // --no-enable is loaded and may be running while RunAtLoad is false.
    const enabled = this.runAtLoad();
    try {
      const listed = this.launchctl(['list', LAUNCHD_LABEL]);
      const pid = /"PID"\s*=\s*(\d+)/.exec(listed);
      return pid === null ? { state: 'stopped', enabled } : { state: 'running', pid: Number(pid[1]), enabled };
    } catch {
      // On disk but not loaded. Still start-at-login: a LaunchAgent in that directory
      // loads at the next login, so `enabled` follows the plist, not the live domain.
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

  /**
   * `-F`, not `-f`: follow by name and reopen if the file is replaced. Nothing rotates
   * this log today, but the moment something does — `newsyslog`, or a rotating writer
   * in `shared` — a plain `-f` would sit on the old inode and silently stop showing
   * anything.
   */
  logs(options: LogsOptions): void {
    const { logPath } = getDaemonPaths();
    if (!existsSync(logPath)) {
      throw new Error(`No log file at ${logPath} yet. The daemon writes one once it has started; check \`mini-cloud daemon status\`.`);
    }
    execFileSync('tail', ['-n', String(options.lines), ...(options.follow ? ['-F'] : []), logPath], { stdio: 'inherit' });
  }
}
