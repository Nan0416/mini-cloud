import { LoggerFactory, OfflineReport } from '@mini-cloud/shared';
import { readFile, unlink } from 'node:fs/promises';

const logger = LoggerFactory.getLogger('OfflineReportReplayer');

export interface ReplayHandlers {
  onPid(instanceId: string, pid: number): Promise<void>;
  onTermination(instanceId: string): Promise<void>;
  onExit(instanceId: string, code: number): Promise<void>;
  onEvent(instanceId: string, level: 'success' | 'warning' | 'error', payload: unknown, timestamp: number): Promise<void>;
}

/**
 * Replays reports that tasks buffered while the agent was down.
 *
 * Runs once at startup, before the agent accepts anything new, so an instance that
 * exited during the outage reaches its true final status instead of being swept up
 * as a launch timeout. Reports are applied in file order, which is the order they
 * happened.
 */
export class OfflineReportReplayer {
  constructor(private readonly filePath: string) {}

  async replay(handlers: ReplayHandlers): Promise<number> {
    const reports = await this.read();
    if (reports.length === 0) {
      return 0;
    }

    logger.info(`Replaying ${reports.length} buffered report(s) from ${this.filePath}.`);
    for (const report of reports) {
      try {
        await this.apply(report, handlers);
      } catch (err) {
        // One unreplayable report must not block the rest; the service may have
        // already pruned that instance.
        logger.warn(`Failed to replay a ${report.type} report for instance ${report.instanceId}.`, err);
      }
    }

    // Only clear the buffer once everything has been attempted, so a crash midway
    // through leaves the file intact for the next start.
    await this.clear();
    return reports.length;
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

  private async read(): Promise<ReadonlyArray<OfflineReport>> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, 'utf-8');
    } catch (err) {
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') {
        return [];
      }
      throw err;
    }

    const reports: OfflineReport[] = [];
    for (const line of contents.split('\n')) {
      if (line.trim().length === 0) {
        continue;
      }
      try {
        reports.push(JSON.parse(line));
      } catch {
        // Expected for the last line if a task was killed mid-write.
        logger.warn('Skipping an unparseable line in the offline report file.');
      }
    }
    return reports;
  }

  private async clear(): Promise<void> {
    try {
      await unlink(this.filePath);
    } catch (err) {
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') {
        return;
      }
      logger.warn(`Failed to clear ${this.filePath}; reports may be replayed again.`, err);
    }
  }
}
