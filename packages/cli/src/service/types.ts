/**
 * OS-level supervision for the control plane: crash restart, boot persistence and log
 * capture, from launchd or systemd.
 *
 * Nothing here knows what it is supervising — the argv arrives resolved — so the same
 * machinery would serve an agent.
 */
export type ServiceState = 'running' | 'stopped' | 'not-installed';

export interface ServiceStatus {
  readonly state: ServiceState;
  readonly pid?: number;
  /** Whether it starts again at login or boot. */
  readonly enabled?: boolean;
}

export interface InstallOptions {
  /** The full command the unit runs, e.g. `[<mini-cloud>, 'serve']`. */
  readonly programArguments: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
  /** Where launchd captures output. systemd ignores it and uses journald. */
  readonly logPath: string;
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
}
