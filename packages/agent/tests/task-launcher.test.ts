import { LaunchInstruction, REPORTER_ENV } from '@mini-cloud/shared';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LaunchOptions, TaskLauncher } from '../src/task-launcher';

const OPTIONS: LaunchOptions = {
  agentId: 'mac-mini',
  agentUrl: 'http://127.0.0.1:4200',
  offlineReportPath: '/var/lib/mini-cloud/offline.jsonl',
};

/**
 * The launcher spawns real processes, so these use short shell commands rather than a
 * mocked `child_process`. Mocking spawn would leave the two things that actually
 * matter unchecked — that the environment a task sees is the one the agent intended,
 * and that stdio really lands in the files it was pointed at.
 */
describe('TaskLauncher', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mini-cloud-launch-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const instruction = (overrides: Partial<LaunchInstruction> = {}): LaunchInstruction => ({
    taskId: 't1',
    version: 2,
    instanceId: 'i1',
    cmd: 'true',
    cwd: dir,
    ...overrides,
  });

  /**
   * Waits for a detached child's output to appear.
   *
   * Polling rather than a fixed sleep: the agent deliberately does not wait for the
   * processes it spawns, so there is nothing to await, and a sleep long enough to be
   * reliable on a loaded CI box makes every test in this file pay for it.
   */
  const readWhen = async (filePath: string, done: (contents: string) => boolean): Promise<string> => {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const contents = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
      if (done(contents)) {
        return contents;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for ${filePath}; it holds ${JSON.stringify(contents)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  const nonEmpty = (contents: string): boolean => contents.trim().length > 0;

  it('spawns the process and reports its pid', async () => {
    const outcome = await new TaskLauncher().launch(instruction(), OPTIONS);

    expect(outcome.pid).toEqual(expect.any(Number));
    expect(outcome.pid).toBeGreaterThan(0);
  });

  it('runs the command through a shell, so `cmd arg arg` works as written', async () => {
    const stdout = path.join(dir, 'out.log');

    await new TaskLauncher().launch(instruction({ cmd: 'echo', arguments: ['hello', 'world'], stdout }), OPTIONS);

    expect((await readWhen(stdout, nonEmpty)).trim()).toBe('hello world');
  });

  it('runs in the working directory it was given', async () => {
    const stdout = path.join(dir, 'out.log');

    await new TaskLauncher().launch(instruction({ cmd: 'pwd', stdout }), OPTIONS);

    expect(await readWhen(stdout, nonEmpty)).toContain(path.basename(dir));
  });

  it('appends to the stdio files rather than truncating them', async () => {
    const stdout = path.join(dir, 'out.log');

    await new TaskLauncher().launch(instruction({ cmd: 'echo first', stdout }), OPTIONS);
    await readWhen(stdout, nonEmpty);
    await new TaskLauncher().launch(instruction({ cmd: 'echo second', stdout }), OPTIONS);

    // A relaunch that wiped the log would destroy the record of why the last run failed.
    expect(await readWhen(stdout, (contents) => contents.includes('second'))).toBe('first\nsecond\n');
  });

  it('separates stdout from stderr', async () => {
    const stdout = path.join(dir, 'out.log');
    const stderr = path.join(dir, 'err.log');

    await new TaskLauncher().launch(instruction({ cmd: 'echo out; echo err 1>&2', stdout, stderr }), OPTIONS);

    expect((await readWhen(stdout, nonEmpty)).trim()).toBe('out');
    expect((await readWhen(stderr, nonEmpty)).trim()).toBe('err');
  });

  it('creates the directory a log file was pointed at', async () => {
    const stdout = path.join(dir, 'nested', 'deeper', 'out.log');

    // Otherwise every task needs its log directory created by hand before it can run.
    await new TaskLauncher().launch(instruction({ cmd: 'echo hi', stdout }), OPTIONS);

    expect((await readWhen(stdout, nonEmpty)).trim()).toBe('hi');
  });

  it('discards output when no file is named', async () => {
    // Nothing to assert but that it does not fail: a task with no stdout path must
    // still launch rather than erroring on an undefined file.
    await expect(new TaskLauncher().launch(instruction({ cmd: 'echo hi' }), OPTIONS)).resolves.toMatchObject({ pid: expect.any(Number) });
  });

  describe('environment', () => {
    const envOf = async (overrides: Partial<LaunchInstruction> = {}, options: LaunchOptions = OPTIONS): Promise<Record<string, string>> => {
      const stdout = path.join(dir, 'env.log');
      await new TaskLauncher().launch(instruction({ cmd: 'env', stdout, ...overrides }), options);
      const contents = await readWhen(stdout, (text) => text.includes(REPORTER_ENV.instanceId));
      const env: Record<string, string> = {};
      for (const line of contents.split('\n')) {
        const index = line.indexOf('=');
        if (index > 0) {
          env[line.slice(0, index)] = line.slice(index + 1);
        }
      }
      return env;
    };

    it('tells the task who it is and where to report', async () => {
      const env = await envOf();

      expect(env[REPORTER_ENV.instanceId]).toBe('i1');
      expect(env[REPORTER_ENV.taskId]).toBe('t1');
      expect(env[REPORTER_ENV.taskVersion]).toBe('2');
      expect(env[REPORTER_ENV.agentId]).toBe('mac-mini');
      expect(env[REPORTER_ENV.agentUrl]).toBe('http://127.0.0.1:4200');
      expect(env[REPORTER_ENV.offlineReportPath]).toBe('/var/lib/mini-cloud/offline.jsonl');
    });

    it('passes the task its own environment', async () => {
      const env = await envOf({ env: { STAGE: 'prod', DATA_DIR: '/srv/data' } });

      expect(env['STAGE']).toBe('prod');
      expect(env['DATA_DIR']).toBe('/srv/data');
    });

    it('inherits only the variables on the allowlist', async () => {
      process.env['MINI_CLOUD_LAUNCHER_SECRET'] = 'do-not-leak';
      try {
        const env = await envOf();

        // The agent's own environment holds the service token and its identity; a
        // wholesale copy of `process.env` would hand both to every task it launches.
        expect(env['MINI_CLOUD_LAUNCHER_SECRET']).toBeUndefined();
        expect(env['PATH']).toBeDefined();
      } finally {
        delete process.env['MINI_CLOUD_LAUNCHER_SECRET'];
      }
    });

    it('refuses to let a task overwrite its own identity through `env`', async () => {
      const env = await envOf({ env: { [REPORTER_ENV.instanceId]: 'someone-else', [REPORTER_ENV.agentUrl]: 'http://evil' } });

      // The reporter reads these to say who it is; a task that could set them could
      // report status against another task's instance.
      expect(env[REPORTER_ENV.instanceId]).toBe('i1');
      expect(env[REPORTER_ENV.agentUrl]).toBe('http://127.0.0.1:4200');
    });

    it('lets a task override an inherited variable', async () => {
      const env = await envOf({ env: { LANG: 'C' } });

      // Inherited values are a convenience, not a policy — unlike the identity ones.
      expect(env['LANG']).toBe('C');
    });

    it('tells a passively checked task its heartbeat cadence', async () => {
      const env = await envOf({}, { ...OPTIONS, healthCheckPeriodMs: 30_000 });

      expect(env[REPORTER_ENV.healthCheckPeriodMs]).toBe('30000');
    });

    it('leaves the cadence unset for a task with no passive check', async () => {
      const env = await envOf();

      // Present but empty would have the reporter parse it as a period of NaN.
      expect(env[REPORTER_ENV.healthCheckPeriodMs]).toBeUndefined();
    });
  });

  it('fails the launch when the stdio path cannot be opened', async () => {
    // A file where a directory should be: the agent has to report this rather than
    // spawn a task whose output goes nowhere.
    const stdout = path.join(dir, 'out.log', 'nested.log');
    await new TaskLauncher().launch(instruction({ cmd: 'echo hi', stdout: path.join(dir, 'out.log') }), OPTIONS);
    await readWhen(path.join(dir, 'out.log'), nonEmpty);

    await expect(new TaskLauncher().launch(instruction({ cmd: 'echo hi', stdout }), OPTIONS)).rejects.toThrow();
  });
});
