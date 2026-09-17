import { InvalidRequestError } from '@mini-cloud/shared';
import { Command } from 'commander';
import { buildUpdateCommand, Releases, UpdateDependencies } from '../../src/commands/update';
import { DaemonUnit, ServiceManager, ServiceState } from '../../src/service/types';
import { AGENT_UNIT, CONTROL_PLANE_UNIT } from '../../src/service/units';

/** Publishes one version, and remembers what was installed from it. */
class FakeReleases implements Releases {
  installed: string[] = [];
  asked = 0;

  constructor(private readonly latest: string) {}

  async latestVersion(): Promise<string> {
    this.asked += 1;
    return this.latest;
  }

  async install(version: string): Promise<void> {
    this.installed.push(version);
  }
}

describe('mini-cloud update', () => {
  let printed: string[];
  let releases: FakeReleases;
  let questions: string[];
  let answer: boolean;
  let daemons: Map<DaemonUnit, ServiceState>;

  const deps = (overrides: Partial<UpdateDependencies> = {}): UpdateDependencies => ({
    releases,
    currentVersion: () => '1.2.0',
    isBinary: () => true,
    confirm: async (question) => {
      questions.push(question);
      return answer;
    },
    managers: (unit) => ({ status: () => ({ state: daemons.get(unit) ?? 'not-installed' }) }) as unknown as ServiceManager,
    ...overrides,
  });
  const run = async (dependencies: UpdateDependencies, ...args: string[]): Promise<void> => {
    const root = new Command('mini-cloud').exitOverride();
    root.addCommand(buildUpdateCommand(dependencies));
    await root.parseAsync(['node', 'mini-cloud', 'update', ...args]);
  };

  beforeEach(() => {
    printed = [];
    releases = new FakeReleases('1.3.0');
    questions = [];
    answer = true;
    daemons = new Map();
    jest.spyOn(console, 'log').mockImplementation((line: string) => printed.push(line));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('installs the latest release once asked and answered yes', async () => {
    await run(deps());

    expect(questions).toEqual(['Install 1.3.0?']);
    expect(releases.installed).toEqual(['1.3.0']);
  });

  it('installs nothing when the answer is no', async () => {
    answer = false;

    await run(deps());

    expect(releases.installed).toEqual([]);
    expect(printed).toContain('Nothing was installed.');
  });

  it('does not ask with --yes', async () => {
    await run(deps(), '--yes');

    expect(questions).toEqual([]);
    expect(releases.installed).toEqual(['1.3.0']);
  });

  it('only reports with --check', async () => {
    await run(deps(), '--check');

    expect(releases.installed).toEqual([]);
    expect(printed).toEqual(['mini-cloud 1.3.0 is available; this is 1.2.0.', 'Run `mini-cloud update` to install it.']);
  });

  it('leaves the latest release alone', async () => {
    await run(deps({ currentVersion: () => '1.3.0' }));

    expect(questions).toEqual([]);
    expect(releases.installed).toEqual([]);
    expect(printed).toEqual(['mini-cloud 1.3.0 is the latest release.']);
  });

  it('never moves a newer build back to the latest release', async () => {
    await run(deps({ currentVersion: () => '1.4.0-rc.1' }));

    expect(releases.installed).toEqual([]);
    expect(printed).toEqual(['mini-cloud 1.4.0-rc.1 is newer than the latest release, 1.3.0.']);
  });

  it('refuses in a checkout, before asking the network', async () => {
    const failure = run(deps({ isBinary: () => false }));

    await expect(failure).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(failure).rejects.toThrow('git pull');
    expect(releases.asked).toBe(0);
  });

  it('names each running daemon, since it keeps the old binary until restarted', async () => {
    daemons.set(AGENT_UNIT, 'running');
    daemons.set(CONTROL_PLANE_UNIT, 'stopped');

    await run(deps());

    expect(printed.filter((line) => line.includes('daemon'))).toEqual(['The agent daemon is still on the old binary. `mini-cloud agent daemon restart` moves it to 1.3.0.']);
  });

  it('still succeeds when a daemon cannot be asked about', async () => {
    const managers = (): ServiceManager => {
      throw new InvalidRequestError('not supported here');
    };

    await run(deps({ managers }));

    expect(releases.installed).toEqual(['1.3.0']);
  });
});
