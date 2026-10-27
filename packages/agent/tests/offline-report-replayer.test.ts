import { InternalServiceError, InvalidRequestError, NotFoundError, OfflineReport, ServiceUnreachableError } from '@mini-cloud/shared';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MAX_REPLAY_ATTEMPTS, OfflineReportReplayer, ReplayHandlers } from '../src/offline-report-replayer';

const T0 = Date.UTC(2026, 5, 1, 12, 0, 0);

/**
 * Records what was replayed, in order, so a scenario reads as a sequence. `refuse` is
 * the service's answer to each call: an error to throw, or undefined to accept it.
 */
const recordingHandlers = (refuse: (call: string) => Error | undefined = () => undefined) => {
  const calls: string[] = [];
  const answer = async (call: string): Promise<void> => {
    calls.push(call);
    const error = refuse(call);
    if (error !== undefined) {
      throw error;
    }
  };
  const handlers: ReplayHandlers = {
    onPid: (instanceId, pid) => answer(`pid ${instanceId} ${pid}`),
    onTermination: (instanceId) => answer(`termination ${instanceId}`),
    onExit: (instanceId, code) => answer(`exit ${instanceId} ${code}`),
    onEvent: (instanceId, level, payload) => answer(`event ${instanceId} ${level} ${JSON.stringify(payload)}`),
  };
  return { calls, handlers };
};

const pid = (instanceId: string, value: number): OfflineReport => ({ version: 1, type: 'pid', instanceId, pid: value, timestamp: T0 });
const exit = (instanceId: string, code: number): OfflineReport => ({ version: 1, type: 'exit', instanceId, code, timestamp: T0 });
const termination = (instanceId: string): OfflineReport => ({ version: 1, type: 'termination', instanceId, timestamp: T0 });
const event = (instanceId: string, payload: unknown): OfflineReport => ({
  version: 1,
  type: 'event',
  instanceId,
  level: 'success',
  payload,
  timestamp: T0,
});

const STARTING_UP = new InternalServiceError('The control plane is starting up. Try again in a moment. (HTTP 503)');

/**
 * The buffer is append-only, one JSON object per line, written by processes the agent
 * does not supervise. Three things follow, and they are what these tests are about: the
 * file is often malformed at the end (a task killed mid-write), a task can append to it
 * while a pass is running, and a report leaves it only once the service has taken it or
 * refused it for good.
 */
describe('OfflineReportReplayer', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mini-cloud-offline-'));
    filePath = path.join(dir, 'reports.jsonl');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (...lines: ReadonlyArray<string>): void => {
    writeFileSync(filePath, lines.join('\n'));
  };

  const writeReports = (...reports: ReadonlyArray<OfflineReport>): void => {
    write(...reports.map((report) => JSON.stringify(report)));
  };

  const buffered = (): ReadonlyArray<OfflineReport> =>
    existsSync(filePath)
      ? readFileSync(filePath, 'utf-8')
          .split('\n')
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line))
      : [];

  it('replays nothing when no task ever buffered anything', async () => {
    const { calls, handlers } = recordingHandlers();

    // The common case, and what every heartbeat finds while nothing is wrong.
    expect(await new OfflineReportReplayer(filePath).replay(handlers)).toEqual({ delivered: 0, dropped: 0, kept: 0 });
    expect(calls).toEqual([]);
  });

  it('routes each report type to its handler', async () => {
    const { calls, handlers } = recordingHandlers();
    writeReports(pid('i1', 4211), termination('i2'), exit('i3', 1), event('i4', { message: 'done' }));

    expect(await new OfflineReportReplayer(filePath).replay(handlers)).toEqual({ delivered: 4, dropped: 0, kept: 0 });
    expect(calls).toEqual(['pid i1 4211', 'termination i2', 'exit i3 1', 'event i4 success {"message":"done"}']);
  });

  it('replays in file order, which is the order things happened', async () => {
    const { calls, handlers } = recordingHandlers();
    writeReports(pid('i1', 4211), exit('i1', 0));

    await new OfflineReportReplayer(filePath).replay(handlers);

    // Reversed, the exit would be overwritten by the pid and the instance would end
    // up looking like it is still running.
    expect(calls).toEqual(['pid i1 4211', 'exit i1 0']);
  });

  it('clears the buffer once everything has been replayed', async () => {
    const { handlers } = recordingHandlers();
    writeReports(pid('i1', 4211));

    await new OfflineReportReplayer(filePath).replay(handlers);

    expect(readdirSync(dir)).toEqual([]);
  });

  it('does not replay the same reports on the next pass', async () => {
    const { calls, handlers } = recordingHandlers();
    writeReports(exit('i1', 0));
    const replayer = new OfflineReportReplayer(filePath);

    await replayer.replay(handlers);
    await replayer.replay(handlers);

    expect(calls).toEqual(['exit i1 0']);
  });

  it('skips the partial last line a task killed mid-write leaves behind', async () => {
    const { calls, handlers } = recordingHandlers();
    write(JSON.stringify(pid('i1', 4211)), '{"version":1,"type":"exit","instan');

    // The append-only format is chosen precisely so this costs at most one report.
    expect(await new OfflineReportReplayer(filePath).replay(handlers)).toEqual({ delivered: 1, dropped: 0, kept: 0 });
    expect(calls).toEqual(['pid i1 4211']);
  });

  it('ignores blank lines, including the trailing newline every append leaves', async () => {
    const { calls, handlers } = recordingHandlers();
    write(JSON.stringify(pid('i1', 4211)), '', '   ', JSON.stringify(exit('i1', 0)), '');

    expect(await new OfflineReportReplayer(filePath).replay(handlers)).toEqual({ delivered: 2, dropped: 0, kept: 0 });
    expect(calls).toEqual(['pid i1 4211', 'exit i1 0']);
  });

  it('skips a line that parses but is not a report it can replay, rather than stalling on it', async () => {
    const { calls, handlers } = recordingHandlers();
    write('null', '[1,2]', JSON.stringify({ ...termination('i8'), version: 2 }), JSON.stringify({ ...termination('i9'), type: 'teleport' }), JSON.stringify(exit('i1', 0)));

    // A newer reporter can write a type this agent predates; claiming it was delivered
    // would discard it, and choking on it would stop every report behind it.
    expect(await new OfflineReportReplayer(filePath).replay(handlers)).toEqual({ delivered: 1, dropped: 0, kept: 0 });
    expect(calls).toEqual(['exit i1 0']);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('drops a report for an instance the service no longer has, and carries on', async () => {
    // The service pruned i1 while its report sat in the buffer.
    const { calls, handlers } = recordingHandlers((call) => (call.startsWith('pid i1') ? new NotFoundError('Task instance i1 does not exist.') : undefined));
    writeReports(pid('i1', 4211), exit('i2', 0));

    expect(await new OfflineReportReplayer(filePath).replay(handlers)).toEqual({ delivered: 1, dropped: 1, kept: 0 });
    expect(calls).toEqual(['pid i1 4211', 'exit i2 0']);
    expect(buffered()).toEqual([]);
  });

  it('drops a report the service rejects as malformed', async () => {
    const { handlers } = recordingHandlers(() => new InvalidRequestError('pid must be a positive integer.'));
    writeReports(pid('i1', -1));

    // Sending the same bytes again gets the same answer, so keeping it only repeats it.
    expect(await new OfflineReportReplayer(filePath).replay(handlers)).toEqual({ delivered: 0, dropped: 1, kept: 0 });
    expect(buffered()).toEqual([]);
  });

  it('keeps a report the service could not take yet, and delivers it on a later pass', async () => {
    let ready = false;
    const { calls, handlers } = recordingHandlers(() => (ready ? undefined : STARTING_UP));
    writeReports(pid('i1', 4211));
    const replayer = new OfflineReportReplayer(filePath);

    // A service still starting answers 503 to everything; dropping on that would empty
    // the buffer for any agent that comes up a few seconds before its service.
    expect(await replayer.replay(handlers)).toEqual({ delivered: 0, dropped: 0, kept: 1 });
    expect(buffered()).toEqual([pid('i1', 4211)]);

    ready = true;
    expect(await replayer.replay(handlers)).toEqual({ delivered: 1, dropped: 0, kept: 0 });
    expect(calls).toEqual(['pid i1 4211', 'pid i1 4211']);
    expect(buffered()).toEqual([]);
  });

  it('drops a report the service keeps refusing once it has failed enough passes', async () => {
    const { handlers } = recordingHandlers(() => new InternalServiceError('An unexpected error occurred. (HTTP 500)'));
    writeReports(event('i1', 'too large for the service to accept'));
    const replayer = new OfflineReportReplayer(filePath);

    for (let pass = 1; pass < MAX_REPLAY_ATTEMPTS; pass++) {
      expect(await replayer.replay(handlers)).toEqual({ delivered: 0, dropped: 0, kept: 1 });
    }

    // A report the service answers with a 500 every time would otherwise be resent on
    // every heartbeat for as long as the agent runs.
    expect(await replayer.replay(handlers)).toEqual({ delivered: 0, dropped: 1, kept: 0 });
    expect(buffered()).toEqual([]);
  });

  it('stops at the first report the service did not answer, keeping the rest untried and in order', async () => {
    const { calls, handlers } = recordingHandlers((call) => (call.startsWith('pid i2') ? new ServiceUnreachableError('timed out after 10000ms') : undefined));
    writeReports(pid('i1', 1), pid('i2', 2), exit('i2', 0), pid('i3', 3));

    // Each untried report would wait out the same timeout to learn the same thing.
    expect(await new OfflineReportReplayer(filePath).replay(handlers)).toEqual({ delivered: 1, dropped: 0, kept: 3 });
    expect(calls).toEqual(['pid i1 1', 'pid i2 2']);
    expect(buffered()).toEqual([pid('i2', 2), exit('i2', 0), pid('i3', 3)]);
  });

  it('does not let a report that keeps failing hold back other instances', async () => {
    const { calls, handlers } = recordingHandlers((call) => (call.startsWith('pid i1') ? STARTING_UP : undefined));
    writeReports(pid('i1', 1), pid('i2', 2));

    expect(await new OfflineReportReplayer(filePath).replay(handlers)).toEqual({ delivered: 1, dropped: 0, kept: 1 });
    expect(calls).toEqual(['pid i1 1', 'pid i2 2']);
    expect(buffered()).toEqual([pid('i1', 1)]);
  });

  it('holds an instance’s later reports behind one it kept, so they still land in order', async () => {
    let refused = false;
    const { calls, handlers } = recordingHandlers((call) => {
      if (call === 'termination i1' && !refused) {
        refused = true;
        return STARTING_UP;
      }
      return undefined;
    });
    writeReports(termination('i1'), exit('i1', 130), pid('i2', 2));
    const replayer = new OfflineReportReplayer(filePath);

    // Sent ahead of the termination, the exit would be overwritten by it: the two share
    // a rank, so the service takes whichever arrives last.
    expect(await replayer.replay(handlers)).toEqual({ delivered: 1, dropped: 0, kept: 2 });
    expect(await replayer.replay(handlers)).toEqual({ delivered: 2, dropped: 0, kept: 0 });
    expect(calls).toEqual(['termination i1', 'pid i2 2', 'termination i1', 'exit i1 130']);
  });

  it('keeps a report a task appends while a pass is running', async () => {
    const { handlers } = recordingHandlers(() => {
      // A task that cannot reach the agent writes here at any moment, including mid-pass.
      appendFileSync(filePath, `${JSON.stringify(exit('late', 0))}\n`);
      return undefined;
    });
    writeReports(pid('i1', 4211));

    await new OfflineReportReplayer(filePath).replay(handlers);

    expect(buffered()).toEqual([exit('late', 0)]);
  });

  it('keeps a report written into the claimed file after it was read', async () => {
    const { handlers } = recordingHandlers(() => {
      // A task that opened the buffer just before the claim writes into the claimed
      // file, after this pass has read it. Unlinked with the rest, it would be lost.
      appendFileSync(`${filePath}.replaying`, `${JSON.stringify(exit('late', 0))}\n`);
      return undefined;
    });
    writeReports(pid('i1', 4211));

    expect(await new OfflineReportReplayer(filePath).replay(handlers)).toEqual({ delivered: 1, dropped: 0, kept: 0 });
    expect(buffered()).toEqual([exit('late', 0)]);
    expect(existsSync(`${filePath}.replaying`)).toBe(false);
  });

  it('finishes a pass the agent was stopped in the middle of', async () => {
    const { calls, handlers } = recordingHandlers();
    writeFileSync(`${filePath}.replaying`, `${JSON.stringify(exit('i1', 0))}\n`);
    writeReports(exit('i2', 0));
    const replayer = new OfflineReportReplayer(filePath);

    await replayer.replay(handlers);
    await replayer.replay(handlers);

    expect(calls).toEqual(['exit i1 0', 'exit i2 0']);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('does not start a second pass while one is still running', async () => {
    let release = (): void => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { calls, handlers } = recordingHandlers();
    const slow: ReplayHandlers = {
      ...handlers,
      onPid: async (instanceId, value) => {
        await blocked;
        await handlers.onPid(instanceId, value);
      },
    };
    writeReports(pid('i1', 4211));
    const replayer = new OfflineReportReplayer(filePath);

    // A pass waiting out a timeout outlasts the heartbeat that would start the next.
    const first = replayer.replay(slow);
    expect(await replayer.replay(slow)).toEqual({ delivered: 0, dropped: 0, kept: 0 });
    release();

    expect(await first).toEqual({ delivered: 1, dropped: 0, kept: 0 });
    expect(calls).toEqual(['pid i1 4211']);
  });

  it('contains a handler that throws synchronously, not just one that rejects', async () => {
    const handlers = {
      onPid: () => {
        throw new Error('boom');
      },
    } as unknown as ReplayHandlers;
    writeReports(pid('i1', 4211));

    // A synchronous throw inside an async caller escapes a `.catch()` but not a
    // try/catch around the `await`. Uncontained, it would end the pass with the
    // buffer still claimed.
    await expect(new OfflineReportReplayer(filePath).replay(handlers)).resolves.toEqual({ delivered: 0, dropped: 0, kept: 1 });
  });

  it('surfaces a read failure that is not a missing file', async () => {
    const { handlers } = recordingHandlers();
    mkdirSync(filePath);

    // A directory where the buffer should be is a misconfiguration, not an empty
    // buffer, and silently reporting "nothing to replay" would hide it forever.
    await expect(new OfflineReportReplayer(filePath).replay(handlers)).rejects.toThrow();
  });
});
