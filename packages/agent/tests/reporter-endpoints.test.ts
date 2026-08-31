import { LoggerFactory } from '@mini-cloud/shared';
import { ReporterHandlers, ReporterServer } from '../src/reporter-endpoints';

const T0 = Date.UTC(2026, 5, 1, 12, 0, 0);

/** Records every call so a request can be checked by what it reached. */
const recordingHandlers = () => {
  const calls: Array<{ name: string; args: ReadonlyArray<unknown> }> = [];
  const record =
    (name: string) =>
    async (...args: ReadonlyArray<unknown>): Promise<void> => {
      calls.push({ name, args });
    };
  const handlers: ReporterHandlers = {
    onPid: record('onPid'),
    onTermination: record('onTermination'),
    onExit: record('onExit'),
    onEvent: record('onEvent'),
    onHealthCheck: record('onHealthCheck'),
  } as unknown as ReporterHandlers;
  return { calls, handlers };
};

/**
 * The loopback server `@mini-cloud/reporter` posts to. It is deliberately
 * unauthenticated — bound to 127.0.0.1, so anything able to reach it already runs as
 * this user on this machine — which makes the validation the only thing standing
 * between a malformed report and the agent's state.
 */
describe('ReporterServer', () => {
  let calls: ReturnType<typeof recordingHandlers>['calls'];
  let server: ReporterServer;
  let origin: string;

  beforeEach(async () => {
    const recording = recordingHandlers();
    calls = recording.calls;
    server = new ReporterServer(recording.handlers);
    const port = await server.start(0);
    origin = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await server.stop();
  });

  const post = async (path: string, body: unknown): Promise<{ status: number; body: unknown }> => {
    const response = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };

  it('binds to an ephemeral port when asked for zero, and reports the real one', () => {
    // Several agents can run on one machine, so a fixed port is not always available.
    expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(origin).not.toContain(':0');
  });

  it('accepts a pid report', async () => {
    const response = await post('/pid', { instanceId: 'i1', pid: 4211 });

    expect(response).toEqual({ status: 200, body: { ok: true } });
    expect(calls).toEqual([{ name: 'onPid', args: ['i1', 4211] }]);
  });

  it('accepts a termination report', async () => {
    await post('/termination', { instanceId: 'i1' });

    expect(calls).toEqual([{ name: 'onTermination', args: ['i1'] }]);
  });

  it('accepts an exit report', async () => {
    await post('/exit', { instanceId: 'i1', code: 1 });

    expect(calls).toEqual([{ name: 'onExit', args: ['i1', 1] }]);
  });

  it('defaults an exit with no code to zero', async () => {
    await post('/exit', { instanceId: 'i1' });

    // `process.on('exit')` reports `null` for a clean exit in some shells; treating
    // the absence as success matches what the process actually did.
    expect(calls).toEqual([{ name: 'onExit', args: ['i1', 0] }]);
  });

  it('accepts an event, with its payload untouched', async () => {
    await post('/event', { instanceId: 'i1', level: 'error', payload: { code: 1 }, timestamp: T0 });

    expect(calls).toEqual([{ name: 'onEvent', args: ['i1', 'error', { code: 1 }, T0] }]);
  });

  it('stamps an event that arrives without a timestamp', async () => {
    const before = Date.now();

    await post('/event', { instanceId: 'i1', level: 'success', payload: 'started' });

    // The task's own clock is the better source, but an event with no time at all
    // cannot be ordered against anything.
    const timestamp = calls[0]?.args[3] as number;
    expect(timestamp).toBeGreaterThanOrEqual(before);
  });

  it('accepts a health-check heartbeat', async () => {
    await post('/health-check', { instanceId: 'i1' });

    expect(calls).toEqual([{ name: 'onHealthCheck', args: ['i1'] }]);
  });

  describe('validation', () => {
    it('answers 400 when the instance id is missing', async () => {
      for (const path of ['/pid', '/termination', '/exit', '/event', '/health-check']) {
        const response = await post(path, { pid: 1, level: 'success' });
        expect(response.status).toBe(400);
      }
      expect(calls).toEqual([]);
    });

    it('answers 400 for a pid that is not an integer', async () => {
      expect((await post('/pid', { instanceId: 'i1', pid: '4211' })).status).toBe(400);
      expect((await post('/pid', { instanceId: 'i1' })).status).toBe(400);
    });

    it('answers 400 for a level outside the event vocabulary', async () => {
      const response = await post('/event', { instanceId: 'i1', level: 'info', payload: 'x' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'level must be one of [success, warning, error]' });
    });

    it('answers 400 for a body that is not an object', async () => {
      expect((await post('/pid', ['i1', 4211])).status).toBe(400);
    });

    it('says what was wrong, since the reporter logs it for the task author', async () => {
      const response = await post('/pid', { instanceId: '' });

      expect(response.body).toEqual({ error: 'instanceId must not be empty' });
    });
  });

  describe('handler failures', () => {
    it('answers 500 without echoing the internal message', async () => {
      const error = jest.spyOn(LoggerFactory.getLogger('ReporterEndpoints'), 'error').mockImplementation(() => undefined);
      const failing = new ReporterServer({
        onPid: async () => {
          throw new Error('connect ECONNREFUSED 127.0.0.1:3000');
        },
      } as unknown as ReporterHandlers);
      const port = await failing.start(0);

      const response = await fetch(`http://127.0.0.1:${port}/pid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: 'i1', pid: 4211 }),
      });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Internal error' });
      expect(error).toHaveBeenCalled();
      await failing.stop();
      error.mockRestore();
    });
  });

  describe('lifecycle', () => {
    it('stops listening once stopped', async () => {
      const stopping = new ReporterServer(recordingHandlers().handlers);
      const port = await stopping.start(0);

      await stopping.stop();

      await expect(fetch(`http://127.0.0.1:${port}/health-check`, { method: 'POST' })).rejects.toThrow();
    });

    it('tolerates being stopped without having started', async () => {
      await expect(new ReporterServer(recordingHandlers().handlers).stop()).resolves.toBeUndefined();
    });

    it('tolerates being stopped twice', async () => {
      const twice = new ReporterServer(recordingHandlers().handlers);
      await twice.start(0);

      await twice.stop();

      await expect(twice.stop()).resolves.toBeUndefined();
    });

    it('surfaces a port it cannot bind rather than starting silently broken', async () => {
      const holder = new ReporterServer(recordingHandlers().handlers);
      const port = await holder.start(0);
      const clashing = new ReporterServer(recordingHandlers().handlers);

      // Two agents configured with the same port is a real misconfiguration, and one
      // of them starting without a reporter API would break every task it launches.
      await expect(clashing.start(port)).rejects.toThrow();
      await holder.stop();
    });
  });
});
