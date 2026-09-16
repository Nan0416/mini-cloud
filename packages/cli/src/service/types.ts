/**
 * OS-level supervision for the control plane.
 *
 * `mini-cloud serve` in a terminal dies with the terminal. Under launchd or systemd it
 * survives a logout, comes back after a reboot and is restarted when it crashes —
 * which matters more here than for most programs, because the thing being supervised
 * is what launches everything else in the fleet.
 *
 * Each implementation renders a unit from the same {@link InstallOptions} and then
 * drives the platform's own tooling. Nothing here knows what the daemon *is*: the argv
 * arrives already resolved, so the same machinery supervises an agent the day someone
 * wants that.
 */
export type ServiceState = 'running' | 'stopped' | 'not-installed';

export interface ServiceStatus {
  readonly state: ServiceState;
  /** The running process, when the platform will tell us. */
  readonly pid?: number;
  /** Whether it starts again at login or boot. */
  readonly enabled?: boolean;
}

export interface InstallOptions {
  /** The full command the unit runs, e.g. `[<mini-cloud>, 'serve']`. */
  readonly programArguments: ReadonlyArray<string>;
  /**
   * Environment baked into the unit.
   *
   * A login service inherits nothing from the shell that installed it — no profile is
   * read, so `MINI_CLOUD_PUBLIC_TOKEN` exported in `.zshrc` is simply absent. What the
   * daemon needs has to be written into the unit, which is also why these files are
   * created 0600: one of the values is the token.
   */
  readonly env: Readonly<Record<string, string>>;
  /** Where launchd captures stdout and stderr. systemd ignores it and uses journald. */
  readonly logPath: string;
  /** Start again at login or boot, rather than only right now. */
  readonly enable: boolean;
}

export interface LogsOptions {
  readonly follow: boolean;
  readonly lines: number;
}

export interface ServiceManager {
  /** Whether the unit file exists on disk. */
  isInstalled(): boolean;
  install(options: InstallOptions): void;
  uninstall(): void;
  start(): void;
  stop(): void;
  restart(): void;
  status(): ServiceStatus;
  logs(options: LogsOptions): void;
  /** Where the unit lives, for a message that tells the operator what was written. */
  unitPath(): string;
}
