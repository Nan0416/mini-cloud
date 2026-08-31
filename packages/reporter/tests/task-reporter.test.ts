import { LoggerFactory, OfflineReport, REPORTER_ENV } from '@mini-cloud/shared';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TaskReporter } from '../src/task-reporter';

/** Stands in for the agent's loopback reporter API. */
class StubAgent {
  private constructor(
    private readonly server: Server,
    readonly url: string,
    readonly received: ReadonlyArray<{ path: string; body: unknown }>,
    private readonly state: { status: number },
  ) {}

  /** Status to answer with. Set it to make the agent reject the next report. */
  set status(status: number) {
    this.state.status = status;
  }

  static async start(handler?: (req: IncomingMessage, res: ServerResponse) => boolean): Promise<StubAgent> {
    // `received` and `status` are captured by the request handler before the
    // StubAgent that owns them exists, so they are built here and handed to it.
    const received: Array<{ path: string; body: unknown }> = [];
    const state = { status: 200 };
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += String(chunk)));
      req.on('end', () => {
        received.push({ path: req.url ?? '', body: body.length === 0 ? undefined : JSON.parse(body) });
        if (handler?.(req, res) === true) {
          return;
        }
        res.writeHead(state.status, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;
    return new StubAgent(server, `http://127.0.0.1:${port}`, received, state);
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

/**
 * Two promises shape every test here. A method must never throw — a monitoring
 * library that can crash the program it monitors is worse than no monitoring — and a
 * report that cannot be delivered must land in the buffer rather than vanish, or an
 * instance stays stuck at its last known status forever.
 */
describe('TaskReporter', () => {
  let dir: string;
  let bufferPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mini-cloud-reporter-'));
    bufferPath = path.join(dir, 'nested', 'offline.jsonl');
    // Every failure path here logs by design; silencing keeps the suite's output
    // about failures rather than about expected warnings.
    jest.spyOn(LoggerFactory.getLogger('TaskReporter'), 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  const buffered = (): ReadonlyArray<OfflineReport> =>
    readFileSync(bufferPath, 'utf-8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as OfflineReport);

  describe('delivering to the agent', () => {
    it('posts the pid the process is actually running as', async () => {
      const agent = await StubAgent.start();

      await new TaskReporter({ instanceId: 'i1', agentUrl: agent.url }).reportPid();

      expect(agent.received).toEqual([{ path: '/pid', body: { instanceId: 'i1', pid: process.pid } }]);
      await agent.close();
    });

    it('posts a termination', async () => {
      const agent = await StubAgent.start();

      await new TaskReporter({ instanceId: 'i1', agentUrl: agent.url }).reportTermination();

      expect(agent.received).toEqual([{ path: '/termination', body: { instanceId: 'i1' } }]);
      await agent.close();
    });

    it('posts an exit code', async () => {
      const agent = await StubAgent.start();

      await new TaskReporter({ instanceId: 'i1', agentUrl: agent.url }).reportExit(1);

      expect(agent.received).toEqual([{ path: '/exit', body: { instanceId: 'i1', code: 1 } }]);
      await agent.close();
    });

    it('defaults an exit to zero, so the common case needs no argument', async () => {
      const agent = await StubAgent.start();

      await new TaskReporter({ instanceId: 'i1', agentUrl: agent.url }).reportExit();

      expect(agent.received[0]?.body).toEqual({ instanceId: 'i1', code: 0 });
      await agent.close();
    });

    it('posts an event with its own timestamp', async () => {
      const agent = await StubAgent.start();
      const before = Date.now();

      await new TaskReporter({ instanceId: 'i1', agentUrl: agent.url }).log('error', { code: 1 });

      const body = agent.received[0]?.body as { level: string; payload: unknown; timestamp: number };
      expect(body).toMatchObject({ instanceId: 'i1', level: 'error', payload: { code: 1 } });
      // The task's own clock, stamped before the network hop, so the event's time is
      // when it happened rather than when the agent got round to it.
      expect(body.timestamp).toBeGreaterThanOrEqual(before);
      await agent.close();
    });
  });

  describe('buffering when the agent is down', () => {
    it('buffers a pid the agent could not accept', async () => {
      const agent = await StubAgent.start();
      const agentUrl = agent.url;
      await agent.close();

      await new TaskReporter({ instanceId: 'i1', agentUrl, offlineReportPath: bufferPath }).reportPid();

      expect(buffered()).toEqual([{ version: 1, type: 'pid', instanceId: 'i1', timestamp: expect.any(Number), pid: process.pid }]);
    });

    it('buffers an exit, which is the one that matters most', async () => {
      const agent = await StubAgent.start();
      const agentUrl = agent.url;
      await agent.close();

      // An exit lost during an agent restart leaves the instance showing as running
      // until a timeout sweep guesses at it.
      await new TaskReporter({ instanceId: 'i1', agentUrl, offlineReportPath: bufferPath }).reportExit(2);

      expect(buffered()).toEqual([{ version: 1, type: 'exit', instanceId: 'i1', timestamp: expect.any(Number), code: 2 }]);
    });

    it('buffers a termination and an event too', async () => {
      const agent = await StubAgent.start();
      const agentUrl = agent.url;
      await agent.close();
      const reporter = new TaskReporter({ instanceId: 'i1', agentUrl, offlineReportPath: bufferPath });

      await reporter.reportTermination();
      await reporter.log('warning', 'shutting down');

      expect(buffered().map((report) => report.type)).toEqual(['termination', 'event']);
    });

    it('appends one JSON object per line, so a crash costs at most the last one', async () => {
      const agent = await StubAgent.start();
      const agentUrl = agent.url;
      await agent.close();
      const reporter = new TaskReporter({ instanceId: 'i1', agentUrl, offlineReportPath: bufferPath });

      await reporter.reportPid();
      await reporter.reportExit(0);

      const contents = readFileSync(bufferPath, 'utf-8');
      expect(contents.split('\n').filter((line) => line.length > 0)).toHaveLength(2);
      expect(contents.endsWith('\n')).toBe(true);
    });

    it('creates the buffer directory, since nothing else will have', async () => {
      const agent = await StubAgent.start();
      const agentUrl = agent.url;
      await agent.close();

      await new TaskReporter({ instanceId: 'i1', agentUrl, offlineReportPath: bufferPath }).reportPid();

      expect(existsSync(bufferPath)).toBe(true);
    });

    it('buffers a report the agent rejected, not just one it never received', async () => {
      const agent = await StubAgent.start();
      agent.status = 500;

      // A 500 from the agent means the report did not land either.
      await new TaskReporter({ instanceId: 'i1', agentUrl: agent.url, offlineReportPath: bufferPath }).reportExit(1);

      expect(buffered().map((report) => report.type)).toEqual(['exit']);
      await agent.close();
    });

    it('does not buffer a heartbeat, because a stale one says nothing', async () => {
      const agent = await StubAgent.start();
      const agentUrl = agent.url;
      await agent.close();
      const reporter = new TaskReporter({ instanceId: 'i1', agentUrl, offlineReportPath: bufferPath, healthCheckPeriodMs: 20 });

      await reporter.start();
      await new Promise((resolve) => setTimeout(resolve, 80));
      reporter.stopHeartbeat();

      // A missed heartbeat *is* the health check's signal; replaying it later would
      // assert liveness at a time the task may well have been dead.
      expect(buffered().every((report) => report.type !== 'event')).toBe(true);
      expect(buffered().map((report) => report.type)).toEqual(['pid']);
    });
  });

  describe('never throwing', () => {
    it('resolves when the agent cannot be reached at all', async () => {
      const agent = await StubAgent.start();
      const agentUrl = agent.url;
      await agent.close();
      const reporter = new TaskReporter({ instanceId: 'i1', agentUrl, offlineReportPath: bufferPath });

      await expect(reporter.reportPid()).resolves.toBeUndefined();
      await expect(reporter.reportExit(0)).resolves.toBeUndefined();
      await expect(reporter.log('error', 'x')).resolves.toBeUndefined();
    });

    it('resolves when the agent accepts the connection and never answers', async () => {
      const agent = await StubAgent.start(() => true);

      // Without a deadline the task would block on its own shutdown report.
      await expect(new TaskReporter({ instanceId: 'i1', agentUrl: agent.url, timeoutMs: 50, offlineReportPath: bufferPath }).reportExit(0)).resolves.toBeUndefined();
      expect(buffered().map((report) => report.type)).toEqual(['exit']);
      await agent.close();
    });

    it('resolves when there is nowhere to buffer either', async () => {
      const agent = await StubAgent.start();
      const agentUrl = agent.url;
      await agent.close();

      // Both the network and the fallback are gone; the task still has to keep running.
      await expect(new TaskReporter({ instanceId: 'i1', agentUrl }).reportExit(0)).resolves.toBeUndefined();
    });

    it('resolves when the buffer path cannot be written', async () => {
      const error = jest.spyOn(LoggerFactory.getLogger('TaskReporter'), 'error').mockImplementation(() => undefined);
      const agent = await StubAgent.start();
      const agentUrl = agent.url;
      await agent.close();
      // A directory where the file should be: every write to it fails.
      const unwritable = dir;

      await expect(new TaskReporter({ instanceId: 'i1', agentUrl, offlineReportPath: unwritable }).reportExit(0)).resolves.toBeUndefined();
      expect(error).toHaveBeenCalled();
    });

    it('resolves when the agent url is not a url at all', async () => {
      await expect(new TaskReporter({ instanceId: 'i1', agentUrl: 'not a url' }).reportPid()).resolves.toBeUndefined();
    });
  });

  describe('heartbeats', () => {
    it('sends nothing on a schedule when no period is configured', async () => {
      const agent = await StubAgent.start();
      const reporter = new TaskReporter({ instanceId: 'i1', agentUrl: agent.url });

      await reporter.start();
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(agent.received.map((entry) => entry.path)).toEqual(['/pid']);
      reporter.stopHeartbeat();
      await agent.close();
    });

    it('reports the pid and then heartbeats on the configured cadence', async () => {
      const agent = await StubAgent.start();
      const reporter = new TaskReporter({ instanceId: 'i1', agentUrl: agent.url, healthCheckPeriodMs: 20 });

      await reporter.start();
      await new Promise((resolve) => setTimeout(resolve, 90));
      reporter.stopHeartbeat();

      expect(agent.received[0]?.path).toBe('/pid');
      expect(agent.received.filter((entry) => entry.path === '/health-check').length).toBeGreaterThanOrEqual(2);
      await agent.close();
    });

    it('stops heartbeating once the task reports it is exiting', async () => {
      const agent = await StubAgent.start();
      const reporter = new TaskReporter({ instanceId: 'i1', agentUrl: agent.url, healthCheckPeriodMs: 20 });
      await reporter.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      await reporter.reportExit(0);
      const afterExit = agent.received.length;
      await new Promise((resolve) => setTimeout(resolve, 60));

      // A heartbeat arriving after the exit would flip the instance back to running.
      expect(agent.received).toHaveLength(afterExit);
      await agent.close();
    });

    it('stops heartbeating on a termination too', async () => {
      const agent = await StubAgent.start();
      const reporter = new TaskReporter({ instanceId: 'i1', agentUrl: agent.url, healthCheckPeriodMs: 20 });
      await reporter.start();

      await reporter.reportTermination();
      const afterTermination = agent.received.length;
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(agent.received).toHaveLength(afterTermination);
      await agent.close();
    });

    it('tolerates being stopped when it never started', () => {
      expect(() => new TaskReporter({ instanceId: 'i1', agentUrl: 'http://127.0.0.1:1' }).stopHeartbeat()).not.toThrow();
    });

    it('tolerates being stopped twice', async () => {
      const agent = await StubAgent.start();
      const reporter = new TaskReporter({ instanceId: 'i1', agentUrl: agent.url, healthCheckPeriodMs: 20 });
      await reporter.start();

      reporter.stopHeartbeat();

      expect(() => reporter.stopHeartbeat()).not.toThrow();
      await agent.close();
    });
  });

  /**
   * `fromEnvironment` returning undefined is what makes it safe to call this
   * unconditionally in a program you also run by hand — the same binary works both
   * under mini-cloud and from a shell, with no flag to remember.
   */
  describe('fromEnvironment', () => {
    const VARIABLES = Object.values(REPORTER_ENV);

    afterEach(() => {
      for (const name of VARIABLES) {
        delete process.env[name];
      }
    });

    it('builds a reporter from what the agent injected', async () => {
      const agent = await StubAgent.start();
      process.env[REPORTER_ENV.instanceId] = 'i1';
      process.env[REPORTER_ENV.agentUrl] = agent.url;

      const reporter = TaskReporter.fromEnvironment();

      expect(reporter).toBeInstanceOf(TaskReporter);
      await reporter?.reportPid();
      expect(agent.received[0]?.body).toMatchObject({ instanceId: 'i1' });
      await agent.close();
    });

    it('returns nothing when the program was not started by mini-cloud', () => {
      expect(TaskReporter.fromEnvironment()).toBeUndefined();
    });

    it('returns nothing when only half the identity is present', () => {
      process.env[REPORTER_ENV.instanceId] = 'i1';
      expect(TaskReporter.fromEnvironment()).toBeUndefined();

      delete process.env[REPORTER_ENV.instanceId];
      process.env[REPORTER_ENV.agentUrl] = 'http://127.0.0.1:4200';
      expect(TaskReporter.fromEnvironment()).toBeUndefined();
    });

    it('treats an empty value as absent', () => {
      process.env[REPORTER_ENV.instanceId] = '';
      process.env[REPORTER_ENV.agentUrl] = 'http://127.0.0.1:4200';

      expect(TaskReporter.fromEnvironment()).toBeUndefined();
    });

    it('picks up the heartbeat cadence', async () => {
      const agent = await StubAgent.start();
      process.env[REPORTER_ENV.instanceId] = 'i1';
      process.env[REPORTER_ENV.agentUrl] = agent.url;
      process.env[REPORTER_ENV.healthCheckPeriodMs] = '20';

      const reporter = TaskReporter.fromEnvironment();
      await reporter?.start();
      await new Promise((resolve) => setTimeout(resolve, 70));
      reporter?.stopHeartbeat();

      expect(agent.received.some((entry) => entry.path === '/health-check')).toBe(true);
      await agent.close();
    });

    it('ignores a cadence that is not a usable number', async () => {
      const agent = await StubAgent.start();
      process.env[REPORTER_ENV.instanceId] = 'i1';
      process.env[REPORTER_ENV.agentUrl] = agent.url;

      for (const raw of ['abc', '0', '-1', '']) {
        process.env[REPORTER_ENV.healthCheckPeriodMs] = raw;
        const reporter = TaskReporter.fromEnvironment();
        await reporter?.start();
        await new Promise((resolve) => setTimeout(resolve, 40));
        reporter?.stopHeartbeat();
      }

      // `setInterval(fn, NaN)` fires every tick, which would flood the agent.
      expect(agent.received.every((entry) => entry.path === '/pid')).toBe(true);
      await agent.close();
    });
  });
});
