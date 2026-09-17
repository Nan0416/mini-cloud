import { LoggerFactory } from '@mini-cloud/shared';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { DaemonUnit, InstallOptions, LogsOptions, ServiceManager, ServiceStatus } from './types';

const logger = LoggerFactory.getLogger('systemd');

function unitFilePath(unit: DaemonUnit): string {
  return join(homedir(), '.config', 'systemd', 'user', unit.systemdUnit);
}

/**
 * systemd parses `ExecStart` as a command line, not an array: whitespace splits
 * arguments, `%` introduces a specifier, and `"`/`\` quote and escape.
 */
function escapeArgument(argument: string): string {
  return `"${argument.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`;
}

function environmentLine(key: string, value: string): string {
  return `Environment="${key}=${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`;
}

/**
 * A *user* unit: no root to install, and it runs as the person whose machines it
 * commands. Nothing waits for what it needs — a user unit cannot depend on a system
 * service — so a Postgres or a control plane that is not up yet is a crash, retried
 * every 5s.
 */
export function buildUnit(unit: DaemonUnit, options: InstallOptions): string {
  const exec = options.programArguments.map(escapeArgument).join(' ');
  const environment = Object.entries(options.env)
    .map(([key, value]) => environmentLine(key, value))
    .join('\n');
  // The default kills the whole cgroup, and the tasks an agent launched are in it.
  const killMode = unit.launchesTasks ? '\nKillMode=process' : '';

  return `[Unit]
Description=mini-cloud ${unit.displayName}
Documentation=https://github.com/Nan0416/mini-cloud
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${exec}
${environment}
Restart=on-failure
RestartSec=5
# Clear of a graceful shutdown, well under systemd's 90s default before SIGKILL.
TimeoutStopSec=30${killMode}

[Install]
WantedBy=default.target
`;
}

export class SystemdServiceManager implements ServiceManager {
  private readonly unitFile: string;

  constructor(private readonly unit: DaemonUnit) {
    this.unitFile = unitFilePath(unit);
  }

  private systemctl(args: ReadonlyArray<string>): string {
    logger.debug(`systemctl --user ${args.join(' ')}`);
    return execFileSync('systemctl', ['--user', ...args], { encoding: 'utf8' });
  }

  private trySystemctl(args: ReadonlyArray<string>): void {
    try {
      this.systemctl(args);
    } catch {
      // Best effort: uninstall should finish even when half of this is already gone.
    }
  }

  unitPath(): string {
    return this.unitFile;
  }

  isInstalled(): boolean {
    return existsSync(this.unitFile);
  }

  install(options: InstallOptions): void {
    mkdirSync(dirname(this.unitFile), { recursive: true });
    writeFileSync(this.unitFile, buildUnit(this.unit, options), { encoding: 'utf8', mode: 0o600 });
    logger.info(`Wrote ${this.unitFile}`);

    this.systemctl(['daemon-reload']);
    // `enable`/`disable` decide persistence; `restart` is what actually picks up the
    // unit just written. `enable --now` would only *start*, which is a no-op on a
    // running service — so a reinstall after an upgrade would leave the old argv
    // running while reporting success.
    this.systemctl([options.enable ? 'enable' : 'disable', this.unit.systemdUnit]);
    this.systemctl(['restart', this.unit.systemdUnit]);
  }

  uninstall(): void {
    this.trySystemctl(['disable', '--now', this.unit.systemdUnit]);
    if (existsSync(this.unitFile)) {
      unlinkSync(this.unitFile);
      logger.info(`Removed ${this.unitFile}`);
    }
    this.trySystemctl(['daemon-reload']);
  }

  start(): void {
    this.systemctl(['start', this.unit.systemdUnit]);
  }

  stop(): void {
    this.systemctl(['stop', this.unit.systemdUnit]);
  }

  restart(): void {
    this.systemctl(['restart', this.unit.systemdUnit]);
  }

  status(): ServiceStatus {
    if (!this.isInstalled()) {
      return { state: 'not-installed' };
    }
    const enabled = this.isEnabled();
    return this.isActive() ? { state: 'running', pid: this.mainPid(), enabled } : { state: 'stopped', enabled };
  }

  private isActive(): boolean {
    try {
      // `is-active` exits non-zero when it is not, so the throw is half the answer.
      return this.systemctl(['is-active', this.unit.systemdUnit]).trim() === 'active';
    } catch {
      return false;
    }
  }

  private isEnabled(): boolean {
    try {
      return this.systemctl(['is-enabled', this.unit.systemdUnit]).trim() === 'enabled';
    } catch {
      return false;
    }
  }

  private mainPid(): number | undefined {
    try {
      const pid = Number(this.systemctl(['show', this.unit.systemdUnit, '--property=MainPID', '--value']).trim());
      return Number.isInteger(pid) && pid > 0 ? pid : undefined;
    } catch {
      return undefined;
    }
  }

  /** journald has the output and rotates it, so there is no file to tail. */
  logs(options: LogsOptions): void {
    const args = ['--user', '-u', this.unit.systemdUnit, '-n', String(options.lines), ...(options.follow ? ['-f'] : [])];
    execFileSync('journalctl', args, { stdio: 'inherit' });
  }

  /** A user unit starts at login unless the account lingers, which a headless machine needs. */
  bootWarning(): string | undefined {
    let username: string;
    let linger: string;
    try {
      username = userInfo().username;
      linger = execFileSync('loginctl', ['show-user', username, '--property=Linger', '--value'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch {
      return undefined;
    }
    return linger === 'yes' ? undefined : `It starts when ${username} logs in, not when the machine boots. \`sudo loginctl enable-linger ${username}\` makes it start at boot.`;
  }
}
