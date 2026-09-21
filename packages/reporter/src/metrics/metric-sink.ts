import { EmfDocument, LoggerFactory } from '@mini-cloud/shared';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const logger = LoggerFactory.getLogger('MetricSink');

/** Where a flushed document goes. Implementations must never throw. */
export interface MetricSink {
  write(document: EmfDocument): Promise<void>;
}

export interface SpoolSinkProps {
  readonly spoolDir: string;
  /** Identifies the writing process, so two programs never share a file. */
  readonly writerId: string;
}

/** Replaces anything that would be awkward in a filename. */
function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

/** `YYYY-MM-DD-HH` in UTC, so rotation is the same everywhere. */
export function hourStamp(now: number): string {
  const date = new Date(now);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}-${pad(date.getUTCHours())}`;
}

/**
 * Appends documents to an hourly file the local agent tails.
 *
 * Going through disk rather than straight to the agent is what makes a metric
 * survive the agent restarting, or the program exiting between flushes — and it
 * means recording a metric never blocks on the network.
 *
 * Files are named after the *writer*, not the namespace: one program can publish to
 * several namespaces through one file, and nothing downstream has to recover a
 * namespace by parsing a filename.
 */
export class SpoolSink implements MetricSink {
  private readonly props: SpoolSinkProps;
  private created = false;

  constructor(props: SpoolSinkProps) {
    this.props = props;
  }

  filePath(now: number = Date.now()): string {
    return path.join(this.props.spoolDir, `${sanitize(this.props.writerId)}-${hourStamp(now)}.emf`);
  }

  async write(document: EmfDocument): Promise<void> {
    const target = this.filePath();
    try {
      if (!this.created) {
        await mkdir(this.props.spoolDir, { recursive: true });
        this.created = true;
      }
      // One append per document, terminated by a newline. A reader that stops at the
      // last newline it sees can never consume half a record.
      await appendFile(target, `${JSON.stringify(document)}\n`, { encoding: 'utf-8' });
    } catch (err) {
      // Swallowing keeps the promise that metrics cannot take down the task.
      logger.warn(`Failed to spool a metric document to ${target}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Keeps flushed documents in memory for the caller to take.
 *
 * For a producer that delivers its own documents rather than spooling them — the
 * agent's host metrics go straight into the batch it is already assembling, so
 * writing them to disk for itself to read back would be a round trip and a tick of
 * delay for nothing.
 */
export class MemorySink implements MetricSink {
  private documents: EmfDocument[] = [];

  async write(document: EmfDocument): Promise<void> {
    this.documents.push(document);
  }

  /** Everything written since the last drain. Taking it clears the buffer. */
  drain(): ReadonlyArray<EmfDocument> {
    const taken = this.documents;
    this.documents = [];
    return taken;
  }
}

/**
 * Writes documents to stdout, which is what `AWS_EMF_ENVIRONMENT=Local` does.
 *
 * Used when no spool directory is configured, so a program run by hand still produces
 * output you can read — and output the real CloudWatch agent would pick up.
 */
export class ConsoleSink implements MetricSink {
  async write(document: EmfDocument): Promise<void> {
    console.log(JSON.stringify(document));
  }
}
