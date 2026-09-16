import { LoggerFactory } from '@mini-cloud/shared';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { InstallOptions, LogsOptions, ServiceManager, ServiceStatus } from './types';

const logger = LoggerFactory.getLogger('systemd');

export const SYSTEMD_UNIT = 'mini-cloud.service';

function unitFilePath(): string {
  return join(homedir(), '.config', 'systemd', 'user', SYSTEMD_UNIT);
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
 * commands. Nothing can order it after Postgres — a user unit cannot depend on a system
 * service — so a database that is not up yet is a crash, retried every 5s.
 */
export function buildUnit(options: InstallOptions): string {
  const exec = options.programArguments.map(escapeArgument).join(' ');
  const environment = Object.entries(options.env)
    .map(([key, value]) => environmentLine(key, value))
    .join('\n');

  return `[Unit]
Description=mini-cloud control plane
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
TimeoutStopSec=30

[Install]
WantedBy=default.target
`;
}

export class SystemdServiceManager implements ServiceManager {
  private readonly unitFile = unitFilePath();

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
    writeFileSync(this.unitFile, buildUnit(options), { encoding: 'utf8', mode: 0o600 });
    logger.info(`Wrote ${this.unitFile}`);

    this.systemctl(['daemon-reload']);
    if (options.enable) {
      this.systemctl(['enable', '--now', SYSTEMD_UNIT]);
    } else {
      this.systemctl(['restart', SYSTEMD_UNIT]);
    }
  }

  uninstall(): void {
    this.trySystemctl(['disable', '--now', SYSTEMD_UNIT]);
    if (existsSync(this.unitFile)) {
      unlinkSync(this.unitFile);
      logger.info(`Removed ${this.unitFile}`);
    }
    this.trySystemctl(['daemon-reload']);
  }

  start(): void {
    this.systemctl(['start', SYSTEMD_UNIT]);
  }

  stop(): void {
    this.systemctl(['stop', SYSTEMD_UNIT]);
  }

  restart(): void {
    this.systemctl(['restart', SYSTEMD_UNIT]);
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
      return this.systemctl(['is-active', SYSTEMD_UNIT]).trim() === 'active';
    } catch {
      return false;
    }
  }

  private isEnabled(): boolean {
    try {
      return this.systemctl(['is-enabled', SYSTEMD_UNIT]).trim() === 'enabled';
    } catch {
      return false;
    }
  }

  private mainPid(): number | undefined {
    try {
      const pid = Number(this.systemctl(['show', SYSTEMD_UNIT, '--property=MainPID', '--value']).trim());
      return Number.isInteger(pid) && pid > 0 ? pid : undefined;
    } catch {
      return undefined;
    }
  }

  /** journald has the output and rotates it, so there is no file to tail. */
  logs(options: LogsOptions): void {
    const args = ['--user', '-u', SYSTEMD_UNIT, '-n', String(options.lines), ...(options.follow ? ['-f'] : [])];
    execFileSync('journalctl', args, { stdio: 'inherit' });
  }
}
