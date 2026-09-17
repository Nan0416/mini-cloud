/**
 * OS-level supervision: crash restart, boot persistence and log capture, from launchd or
 * systemd. What is supervised arrives as a {@link DaemonUnit} and a resolved argv, so the
 * control plane and the agent share one implementation.
 */
export type ServiceState = 'running' | 'stopped' | 'not-installed';

export interface ServiceStatus {
  readonly state: ServiceState;
  readonly pid?: number;
  /** Whether it starts again at login or boot. */
  readonly enabled?: boolean;
}

/** One supervised program. Every name in it is distinct per unit, so both fit on one machine. */
export interface DaemonUnit {
  /** How messages name it: `control plane`, `agent`. */
  readonly displayName: string;
  /** The command group that manages it, for hints. */
  readonly command: string;
  /** How to run it without a supervisor. */
  readonly foregroundCommand: string;
  /** What the unit runs, after any `--config`. */
  readonly subcommand: ReadonlyArray<string>;
  readonly launchdLabel: string;
  readonly systemdUnit: string;
  /** Where launchd captures output. systemd ignores it and uses journald. */
  readonly logPath: string;
  /** Variables copied from the installing shell, since a supervisor reads no profile. */
  readonly environmentKeys: ReadonlyArray<string>;
  /**
   * Its children are the user's tasks: they must outlive a stop or restart, and must not
   * inherit the throttling a background job gets.
   */
  readonly launchesTasks: boolean;
}

export interface InstallOptions {
  /** The full command the unit runs, e.g. `[<mini-cloud>, 'serve']`. */
  readonly programArguments: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
  /** Start again at login or boot, rather than only right now. */
  readonly enable: boolean;
}

export interface LogsOptions {
  readonly follow: boolean;
  readonly lines: number;
}

export interface ServiceManager {
  isInstalled(): boolean;
  install(options: InstallOptions): void;
  uninstall(): void;
  start(): void;
  stop(): void;
  restart(): void;
  status(): ServiceStatus;
  logs(options: LogsOptions): void;
  unitPath(): string;
  /** Why an enabled unit will still not start when the machine boots, if it can tell. */
  bootWarning(): string | undefined;
}
