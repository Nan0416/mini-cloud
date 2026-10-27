import {
  InvalidRequestError,
  LoggerFactory,
  NotFoundError,
  OfflineReport,
  OfflineReportType,
  ServiceUnreachableError,
  TASK_EVENT_LEVELS,
  assertInteger,
  assertNonEmptyString,
  assertOneOf,
  assertRecord,
  assertTimestamp,
} from '@mini-cloud/shared';
import { appendFile, readFile, rename, unlink } from 'node:fs/promises';

const logger = LoggerFactory.getLogger('OfflineReportReplayer');

/**
 * Passes a report may fail before it is dropped. Passes only start after a heartbeat
 * the service answered, so a report still failing this many times is the problem.
 */
export const MAX_REPLAY_ATTEMPTS = 5;

const REPORT_TYPES: ReadonlyArray<OfflineReportType> = ['pid', 'exit', 'termination', 'event'];

export interface ReplayHandlers {
  onPid(instanceId: string, pid: number): Promise<void>;
  onTermination(instanceId: string): Promise<void>;
  onExit(instanceId: string, code: number): Promise<void>;
  onEvent(instanceId: string, level: 'success' | 'warning' | 'error', payload: unknown, timestamp: number): Promise<void>;
}

export interface ReplayOutcome {
  /** Accepted by the service. */
  readonly delivered: number;
  /** Refused for good, or failed too often, and discarded. */
  readonly dropped: number;
  /** Not delivered for a reason that may pass, and left in the buffer for the next pass. */
  readonly kept: number;
}

interface ClaimedReports {
  readonly reports: ReadonlyArray<OfflineReport>;
  /** How much of the claimed file was read, so anything written after can be found. */
  readonly bytesRead: number;
}

const NOTHING_REPLAYED: ReplayOutcome = { delivered: 0, dropped: 0, kept: 0 };

/**
 * Replays reports that tasks buffered while they could not reach the agent.
 *
 * Runs whenever the service answers a heartbeat, so an instance that exited while
 * either side was unreachable reaches its true final status instead of being swept up
 * as a timeout. Within a pass, each instance's reports are applied in file order.
 */
export class OfflineReportReplayer {
  private readonly claimedPath: string;
  /** Failed passes per report still buffered, keyed by the report as written. */
  private readonly attempts = new Map<string, number>();
  private replaying = false;

  constructor(private readonly filePath: string) {
    this.claimedPath = `${filePath}.replaying`;
  }

  async replay(handlers: ReplayHandlers): Promise<ReplayOutcome> {
    // A pass that waits out a timeout can outlast the heartbeat interval, and a second
    // pass over the same claimed file would deliver every report in it twice.
    if (this.replaying) {
      return NOTHING_REPLAYED;
    }
    this.replaying = true;
    try {
      return await this.replayClaimed(handlers);
    } finally {
      this.replaying = false;
    }
  }

  private async replayClaimed(handlers: ReplayHandlers): Promise<ReplayOutcome> {
    const claimed = await this.claim();
    if (claimed === undefined) {
      return NOTHING_REPLAYED;
    }
    const { reports, bytesRead } = claimed;

    logger.info(`Replaying ${reports.length} buffered report(s) from ${this.filePath}.`);
    const kept: OfflineReport[] = [];
    // An instance with a report kept this pass holds its later ones back too: applied
    // ahead of it, `terminated` could land after the `exit_failure` it preceded.
    const held = new Set<string>();
    let delivered = 0;
    let dropped = 0;
    for (const [index, report] of reports.entries()) {
      if (held.has(report.instanceId)) {
        kept.push(report);
        continue;
      }
      const key = JSON.stringify(report);
      try {
        await this.apply(report, handlers);
        this.attempts.delete(key);
        delivered++;
      } catch (err) {
        if (err instanceof ServiceUnreachableError) {
          // Every later report would wait out the same timeout to learn the same thing.
          const rest = reports.slice(index);
          logger.warn(`The service stopped answering; keeping ${rest.length} report(s) for the next pass.`, err);
          kept.push(...rest);
          break;
        }
        const attempts = (this.attempts.get(key) ?? 0) + 1;
        if (isPermanent(err)) {
          this.attempts.delete(key);
          logger.warn(`Dropping a ${report.type} report for instance ${report.instanceId}, which the service refused.`, err);
          dropped++;
        } else if (attempts >= MAX_REPLAY_ATTEMPTS) {
          this.attempts.delete(key);
          logger.warn(`Dropping a ${report.type} report for instance ${report.instanceId} after ${attempts} failed passes.`, err);
          dropped++;
        } else {
          this.attempts.set(key, attempts);
          logger.warn(`Could not replay a ${report.type} report for instance ${report.instanceId}; keeping it for the next pass.`, err);
          kept.push(report);
          held.add(report.instanceId);
        }
      }
    }

    await this.release(kept, bytesRead);
    logger.info(`Replayed buffered reports: ${delivered} delivered, ${dropped} dropped, ${kept.length} kept.`);
    return { delivered, dropped, kept: kept.length };
  }

  private async apply(report: OfflineReport, handlers: ReplayHandlers): Promise<void> {
    switch (report.type) {
      case 'pid':
        await handlers.onPid(report.instanceId, report.pid);
        return;
      case 'termination':
        await handlers.onTermination(report.instanceId);
        return;
      case 'exit':
        await handlers.onExit(report.instanceId, report.code);
        return;
      case 'event':
        await handlers.onEvent(report.instanceId, report.level, report.payload, report.timestamp);
        return;
    }
  }

  /**
   * Moves the buffer aside before reading it, so a task appending meanwhile starts a
   * fresh file rather than writing into one this pass will delete. A claimed file that
   * already exists was left by a pass the agent did not finish, and goes first.
   */
  private async claim(): Promise<ClaimedReports | undefined> {
    const unfinished = await this.read(this.claimedPath);
    if (unfinished !== undefined) {
      return unfinished;
    }
    try {
      await rename(this.filePath, this.claimedPath);
    } catch (err) {
      if (isMissing(err)) {
        return undefined;
      }
      throw err;
    }
    return (await this.read(this.claimedPath)) ?? { reports: [], bytesRead: 0 };
  }

  /**
   * Kept reports go back on the end of the live buffer rather than staying claimed, so
   * reports buffered after them are not held back. So does anything that reached the
   * claimed file after it was read: a task that opened the buffer just before the
   * claim still writes into it.
   */
  private async release(kept: ReadonlyArray<OfflineReport>, bytesRead: number): Promise<void> {
    const late = (await this.read(this.claimedPath, bytesRead))?.reports ?? [];
    const remaining = [...kept, ...late];
    if (remaining.length > 0) {
      await appendFile(this.filePath, remaining.map((report) => `${JSON.stringify(report)}\n`).join(''), 'utf-8');
    }
    try {
      await unlink(this.claimedPath);
    } catch (err) {
      if (!isMissing(err)) {
        logger.warn(`Failed to clear ${this.claimedPath}; its reports may be replayed again.`, err);
      }
    }
  }

  private async read(filePath: string, fromByte = 0): Promise<ClaimedReports | undefined> {
    let contents: Buffer;
    try {
      contents = await readFile(filePath);
    } catch (err) {
      if (isMissing(err)) {
        return undefined;
      }
      throw err;
    }

    const reports: OfflineReport[] = [];
    for (const line of contents.subarray(fromByte).toString('utf-8').split('\n')) {
      if (line.trim().length === 0) {
        continue;
      }
      try {
        reports.push(toOfflineReport(JSON.parse(line)));
      } catch (err) {
        // Expected for the last line if a task was killed mid-write, and for a report
        // from a newer reporter than this agent knows how to replay.
        logger.warn(`Skipping a line in the offline report file that is not a report: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { reports, bytesRead: contents.length };
  }
}

/** Written by other processes, possibly another version, so nothing about it is trusted. */
function toOfflineReport(value: unknown): OfflineReport {
  const record = assertRecord(value, 'report');
  if (record['version'] !== 1) {
    throw new InvalidRequestError(`report version ${String(record['version'])} is not one this agent can replay`);
  }
  const type = assertOneOf(record['type'], 'type', REPORT_TYPES);
  const instanceId = assertNonEmptyString(record['instanceId'], 'instanceId');
  const timestamp = assertTimestamp(record['timestamp'], 'timestamp');
  switch (type) {
    case 'pid':
      return { version: 1, type, instanceId, timestamp, pid: assertInteger(record['pid'], 'pid') };
    case 'exit':
      return { version: 1, type, instanceId, timestamp, code: assertInteger(record['code'], 'code') };
    case 'termination':
      return { version: 1, type, instanceId, timestamp };
    case 'event':
      return { version: 1, type, instanceId, timestamp, level: assertOneOf(record['level'], 'level', TASK_EVENT_LEVELS), payload: record['payload'] };
  }
}

/**
 * The two answers a retry cannot change: the instance is gone, or the report is
 * malformed. Anything else — a 503 while the service starts, a 500 — may pass.
 */
function isPermanent(err: unknown): boolean {
  return err instanceof NotFoundError || err instanceof InvalidRequestError;
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT';
}
