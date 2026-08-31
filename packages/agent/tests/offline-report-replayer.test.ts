import { OfflineReport } from '@mini-cloud/shared';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OfflineReportReplayer, ReplayHandlers } from '../src/offline-report-replayer';

const T0 = Date.UTC(2026, 5, 1, 12, 0, 0);

/** Records what was replayed, in order, so a scenario reads as a sequence. */
const recordingHandlers = () => {
  const calls: string[] = [];
  const handlers: ReplayHandlers = {
    onPid: async (instanceId, pid) => {
      calls.push(`pid ${instanceId} ${pid}`);
    },
    onTermination: async (instanceId) => {
      calls.push(`termination ${instanceId}`);
    },
    onExit: async (instanceId, code) => {
      calls.push(`exit ${instanceId} ${code}`);
    },
    onEvent: async (instanceId, level, payload) => {
      calls.push(`event ${instanceId} ${level} ${JSON.stringify(payload)}`);
    },
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

/**
 * The buffer is append-only, one JSON object per line, written by processes the agent
 * does not supervise while it is down. Two things follow, and both are what these
 * tests are about: the file is often malformed at the end (a task killed mid-write),
 * and it must not be cleared until everything in it has been attempted.
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

  it('replays nothing when no task ever buffered anything', async () => {
    const { calls, handlers } = recordingHandlers();

    // The common case: the agent has never been down while a task was running.
    expect(await new OfflineReportReplayer(filePath).replay(handlers)).toBe(0);
    expect(calls).toEqual([]);
  });

  it('routes each report type to its handler', async () => {
    const { calls, handlers } = recordingHandlers();
    writeReports(pid('i1', 4211), termination('i2'), exit('i3', 1), event('i4', { message: 'done' }));

    expect(await new OfflineReportReplayer(filePath).replay(handlers)).toBe(4);
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

    expect(existsSync(filePath)).toBe(false);
  });

  it('does not replay the same reports on the next start', async () => {
    const { calls, handlers } = recordingHandlers();
    writeReports(exit('i1', 0));

    await new OfflineReportReplayer(filePath).replay(handlers);
    await new OfflineReportReplayer(filePath).replay(handlers);

    expect(calls).toEqual(['exit i1 0']);
  });

  it('skips the partial last line a task killed mid-write leaves behind', async () => {
    const { calls, handlers } = recordingHandlers();
    write(JSON.stringify(pid('i1', 4211)), '{"version":1,"type":"exit","instan');

    // The append-only format is chosen precisely so this costs at most one report.
    expect(await new OfflineReportReplayer(filePath).replay(handlers)).toBe(1);
    expect(calls).toEqual(['pid i1 4211']);
  });

  it('ignores blank lines, including the trailing newline every append leaves', async () => {
    const { calls, handlers } = recordingHandlers();
    write(JSON.stringify(pid('i1', 4211)), '', '   ', JSON.stringify(exit('i1', 0)), '');

    expect(await new OfflineReportReplayer(filePath).replay(handlers)).toBe(2);
    expect(calls).toEqual(['pid i1 4211', 'exit i1 0']);
  });

  it('carries on after a report the service refuses', async () => {
    const calls: string[] = [];
    const handlers: ReplayHandlers = {
      onPid: async () => {
        // The service pruned this instance while the agent was down.
        throw new Error('Task instance i1 does not exist.');
      },
      onTermination: async (instanceId) => {
        calls.push(`termination ${instanceId}`);
      },
      onExit: async (instanceId, code) => {
        calls.push(`exit ${instanceId} ${code}`);
      },
      onEvent: async () => undefined,
    };
    writeReports(pid('i1', 4211), exit('i2', 0));

    // One unreplayable report must not strand every later one in the file.
    expect(await new OfflineReportReplayer(filePath).replay(handlers)).toBe(2);
    expect(calls).toEqual(['exit i2 0']);
  });

  it('still clears the buffer after a report failed, since retrying cannot help', async () => {
    const handlers: ReplayHandlers = {
      onPid: async () => {
        throw new Error('Task instance i1 does not exist.');
      },
      onTermination: async () => undefined,
      onExit: async () => undefined,
      onEvent: async () => undefined,
    };
    writeReports(pid('i1', 4211));

    await new OfflineReportReplayer(filePath).replay(handlers);

    expect(existsSync(filePath)).toBe(false);
  });

  it('contains a handler that throws synchronously, not just one that rejects', async () => {
    const handlers = {
      onPid: () => {
        throw new Error('boom');
      },
    } as unknown as ReplayHandlers;
    writeReports(pid('i1', 4211));

    // A synchronous throw inside an async caller escapes a `.catch()` but not a
    // try/catch around the `await`. Replay runs at startup, so an uncontained throw
    // here stops the agent from starting at all.
    await expect(new OfflineReportReplayer(filePath).replay(handlers)).resolves.toBe(1);
  });

  it('surfaces a read failure that is not a missing file', async () => {
    const { handlers } = recordingHandlers();

    // A directory where the buffer should be is a misconfiguration, not an empty
    // buffer, and silently reporting "nothing to replay" would hide it forever.
    await expect(new OfflineReportReplayer(dir).replay(handlers)).rejects.toThrow();
  });

  it('reports how many were replayed, for the startup log line', async () => {
    const { handlers } = recordingHandlers();
    writeReports(pid('i1', 1), pid('i2', 2), pid('i3', 3));

    expect(await new OfflineReportReplayer(filePath).replay(handlers)).toBe(3);
  });
});
