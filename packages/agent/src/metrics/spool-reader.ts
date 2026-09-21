import { LoggerFactory } from '@mini-cloud/shared';
import { open, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const logger = LoggerFactory.getLogger('MetricSpoolReader');

/** Spool files are named `<writer>-YYYY-MM-DD-HH.emf`. */
const SPOOL_FILENAME = /^(.+)-(\d{4})-(\d{2})-(\d{2})-(\d{2})\.emf$/;

/**
 * How long past its hour a spool file is still read.
 *
 * A program writing at 10:59:59.9 is still appending after the hour turns, so a
 * file is followed for a while past its own hour before being retired.
 */
const RETIRE_AFTER_MS = 65 * 60_000;

export interface SpoolReaderProps {
  readonly spoolDir: string;
  /** Where read positions are persisted, so a restart resumes rather than replays. */
  readonly offsetsPath: string;
}

interface Offsets {
  [file: string]: number;
}

export interface SpoolBatch {
  /** Complete lines, in the order they were written. */
  readonly lines: ReadonlyArray<string>;
  /** Offsets to persist once these lines are safely accounted for. */
  readonly offsets: Offsets;
}

/** The hour a spool file's name says it belongs to, or undefined if it is not one. */
export function spoolFileHour(filename: string): number | undefined {
  const match = SPOOL_FILENAME.exec(filename);
  if (match === null) {
    return undefined;
  }
  return Date.UTC(Number(match[2]), Number(match[3]) - 1, Number(match[4]), Number(match[5]));
}

export function isRetired(filename: string, now: number): boolean {
  const hour = spoolFileHour(filename);
  return hour !== undefined && now - hour > RETIRE_AFTER_MS;
}

/**
 * Follows the spool files programs append to, remembering how far it has read.
 *
 * Two rules keep this honest. A read stops at the **last newline** it saw, so a
 * document half-written when the read happened is left for next time rather than
 * parsed as garbage — the legacy agent shipped arbitrary byte ranges and left
 * reassembly to something else. And offsets are returned rather than saved, so the
 * caller decides when the data they cover is safe.
 */
export class SpoolReader {
  private readonly props: SpoolReaderProps;

  constructor(props: SpoolReaderProps) {
    this.props = props;
  }

  async read(): Promise<SpoolBatch> {
    const offsets = await this.loadOffsets();
    const files = await this.listSpoolFiles();
    const lines: string[] = [];
    const next: Offsets = { ...offsets };

    for (const file of files) {
      const from = offsets[file] ?? 0;
      const result = await this.readFrom(path.join(this.props.spoolDir, file), from);
      if (result === undefined) {
        continue;
      }
      lines.push(...result.lines);
      next[file] = result.offset;
    }

    return { lines, offsets: next };
  }

  /** Reads whole lines from `offset`, returning the offset just past the last one. */
  private async readFrom(file: string, savedOffset: number): Promise<{ lines: ReadonlyArray<string>; offset: number } | undefined> {
    let handle;
    try {
      handle = await open(file, 'r');
      const stats = await handle.stat();

      // A file shorter than where we last read was truncated and rewritten, so the
      // saved position points into content that no longer exists. Start again rather
      // than resume into the middle of a record.
      const offset = stats.size < savedOffset ? 0 : savedOffset;
      if (stats.size === offset) {
        return { lines: [], offset };
      }

      const length = stats.size - offset;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);

      const lastNewline = buffer.lastIndexOf(0x0a);
      if (lastNewline === -1) {
        // A single record still being written. Leave the offset where it was.
        return { lines: [], offset };
      }

      const complete = buffer.subarray(0, lastNewline).toString('utf-8');
      const lines = complete.split('\n').filter((line) => line.trim().length > 0);
      return { lines, offset: offset + lastNewline + 1 };
    } catch (err) {
      logger.warn(`Could not read the metrics spool file ${file}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    } finally {
      await handle?.close();
    }
  }

  private async listSpoolFiles(): Promise<ReadonlyArray<string>> {
    try {
      const entries = await readdir(this.props.spoolDir, { withFileTypes: true });
      return entries.filter((entry) => entry.isFile() && spoolFileHour(entry.name) !== undefined).map((entry) => entry.name);
    } catch {
      // No spool directory yet simply means nothing has recorded a metric.
      return [];
    }
  }

  async saveOffsets(offsets: Offsets): Promise<void> {
    try {
      await mkdir(path.dirname(this.props.offsetsPath), { recursive: true });
      await writeFile(this.props.offsetsPath, JSON.stringify(offsets, null, 2), { encoding: 'utf-8' });
    } catch (err) {
      // Losing the offsets costs a replay, which the batch id then deduplicates.
      logger.warn(`Could not save metric spool offsets: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async loadOffsets(): Promise<Offsets> {
    try {
      const raw = await readFile(this.props.offsetsPath, { encoding: 'utf-8' });
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return {};
      }
      const offsets: Offsets = {};
      for (const [file, value] of Object.entries(parsed)) {
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
          offsets[file] = value;
        }
      }
      return offsets;
    } catch {
      return {};
    }
  }

  /** Deletes spool files nothing will append to again, and forgets their offsets. */
  async retire(offsets: Offsets, now: number = Date.now()): Promise<Offsets> {
    const kept: Offsets = {};
    for (const [file, offset] of Object.entries(offsets)) {
      if (!isRetired(file, now)) {
        kept[file] = offset;
        continue;
      }
      try {
        await rm(path.join(this.props.spoolDir, file), { force: true });
        logger.debug(`Retired the metrics spool file ${file}.`);
      } catch (err) {
        // Keep the offset so the file is not re-read from zero next tick.
        kept[file] = offset;
        logger.warn(`Could not remove the retired spool file ${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return kept;
  }
}
