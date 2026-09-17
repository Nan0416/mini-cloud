import { PortInUseError } from '@mini-cloud/shared';
import { Command } from 'commander';
import { resolve } from 'node:path';
import { buildDaemonCommand, explainPortConflict, ServiceManagerFactory } from '../../src/commands/daemon';
import { DaemonUnit, InstallOptions, LogsOptions, ServiceManager, ServiceStatus } from '../../src/service/types';
import { AGENT_UNIT, CONTROL_PLANE_UNIT } from '../../src/service/units';

/** Holds what was installed and answers status from it, like the real supervisors. */
class FakeServiceManager implements ServiceManager {
  installed?: InstallOptions;
  stopped = false;
  runningPid?: number;
  linger?: string;

  isInstalled(): boolean {
    return this.installed !== undefined;
  }
  install(options: InstallOptions): void {
    this.installed = options;
    this.runningPid = 4312;
  }
  uninstall(): void {
    this.installed = undefined;
    this.runningPid = undefined;
  }
  start(): void {}
  stop(): void {
    this.stopped = true;
    this.runningPid = undefined;
  }
  restart(): void {}
  status(): ServiceStatus {
    if (this.runningPid !== undefined) {
      return { state: 'running', pid: this.runningPid };
    }
    return this.installed === undefined ? { state: 'not-installed' } : { state: 'stopped' };
  }
  logs(_options: LogsOptions): void {}
  unitPath(): string {
    return '/units/fake';
  }
  bootWarning(): string | undefined {
    return this.linger;
  }
}

/** The real shape: the control plane's group on the root, the agent's one level down. */
function program(managers: ServiceManagerFactory): Command {
  const root = new Command('mini-cloud').option('--config <path>').exitOverride();
  root.addCommand(buildDaemonCommand(CONTROL_PLANE_UNIT, managers));
  root.addCommand(new Command('agent').addCommand(buildDaemonCommand(AGENT_UNIT, managers)));
  return root;
}

describe('the daemon command group', () => {
  let printed: string[];
  let fakes: Map<DaemonUnit, FakeServiceManager>;
  const managers: ServiceManagerFactory = (unit) => {
    const existing = fakes.get(unit) ?? new FakeServiceManager();
    fakes.set(unit, existing);
    return existing;
  };
  const run = async (...args: string[]): Promise<void> => {
    await program(managers).parseAsync(['node', 'mini-cloud', ...args]);
  };
  const fake = (unit: DaemonUnit): FakeServiceManager => {
    const found = fakes.get(unit);
    if (found === undefined) {
      throw new Error(`Nothing was asked of the ${unit.displayName} unit.`);
    }
    return found;
  };

  beforeEach(() => {
    printed = [];
    fakes = new Map();
    jest.spyOn(console, 'log').mockImplementation((line: string) => printed.push(line));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('installs the agent to run `agent start`, and leaves the control plane alone', async () => {
    await run('agent', 'daemon', 'start');

    expect(fake(AGENT_UNIT).installed?.programArguments.slice(-2)).toEqual(['agent', 'start']);
    expect(fakes.has(CONTROL_PLANE_UNIT)).toBe(false);
    expect(printed).toContain('mini-cloud agent daemon: running (pid 4312)');
  });

  it('carries --config into the agent unit, though the group sits a level deeper', async () => {
    // Read off `parent.parent`, the flag reached the `agent` group instead of the root
    // and the unit silently supervised the default config.
    await run('--config', 'elsewhere/config.json', 'agent', 'daemon', 'start');

    expect(fake(AGENT_UNIT).installed?.programArguments.slice(-4)).toEqual(['--config', resolve('elsewhere/config.json'), 'agent', 'start']);
  });

  it('carries --config into the control plane unit too', async () => {
    await run('--config', '/etc/mini-cloud/config.json', 'daemon', 'start');

    expect(fake(CONTROL_PLANE_UNIT).installed?.programArguments.slice(-3)).toEqual(['--config', '/etc/mini-cloud/config.json', 'serve']);
  });

  it('says when an enabled unit will not come back at boot', async () => {
    fakes.set(AGENT_UNIT, Object.assign(new FakeServiceManager(), { linger: 'It starts when someone logs in.' }));

    await run('agent', 'daemon', 'start');

    expect(printed).toContain('It starts when someone logs in.');
  });

  it('does not, with --no-enable, which asked for no boot start at all', async () => {
    fakes.set(AGENT_UNIT, Object.assign(new FakeServiceManager(), { linger: 'It starts when someone logs in.' }));

    await run('agent', 'daemon', 'start', '--no-enable');

    expect(fake(AGENT_UNIT).installed?.enable).toBe(false);
    expect(printed).not.toContain('It starts when someone logs in.');
  });

  it('refuses to stop a unit that was never installed, and names the command that installs it', async () => {
    await expect(run('agent', 'daemon', 'stop')).rejects.toThrow('The mini-cloud agent daemon is not installed. Run `mini-cloud agent daemon start` first.');
  });

  it('reassures that stopping the agent leaves its tasks running', async () => {
    await run('agent', 'daemon', 'start');
    await run('agent', 'daemon', 'stop');

    expect(fake(AGENT_UNIT).stopped).toBe(true);
    expect(printed).toContain('Stopped the mini-cloud agent daemon. Tasks it launched keep running.');
  });
});

describe('explainPortConflict', () => {
  const conflict = new PortInUseError('127.0.0.1:3100 is already in use.');
  const managerWith =
    (status: ServiceStatus): ServiceManagerFactory =>
    () =>
      Object.assign(new FakeServiceManager(), { status: () => status });

  it('names the running daemon and how to stop it', () => {
    const explained = explainPortConflict(conflict, AGENT_UNIT, managerWith({ state: 'running', pid: 4312 }));

    expect(explained).toBeInstanceOf(PortInUseError);
    expect(explained).toHaveProperty(
      'message',
      '127.0.0.1:3100 is already in use.\nThe mini-cloud agent daemon is running (pid 4312) and most likely holds it. Run `mini-cloud agent daemon stop` first to use this one in the foreground.',
    );
  });

  it('does not blame the daemon when this process is the daemon', () => {
    // The daemon crash-looping behind a copy started by hand would otherwise log advice to stop itself.
    expect(explainPortConflict(conflict, AGENT_UNIT, managerWith({ state: 'running', pid: process.pid }))).toBe(conflict);
  });

  it('leaves the conflict alone when the daemon is not running', () => {
    expect(explainPortConflict(conflict, CONTROL_PLANE_UNIT, managerWith({ state: 'stopped' }))).toBe(conflict);
  });

  it('leaves the conflict alone where there is no supervisor to ask', () => {
    const unsupported: ServiceManagerFactory = () => {
      throw new Error('Running the agent as a service is not supported on win32.');
    };

    expect(explainPortConflict(conflict, AGENT_UNIT, unsupported)).toBe(conflict);
  });

  it('passes any other failure through untouched', () => {
    const other = new Error('connect ECONNREFUSED 127.0.0.1:3000');

    expect(explainPortConflict(other, AGENT_UNIT, managerWith({ state: 'running', pid: 4312 }))).toBe(other);
  });
});
