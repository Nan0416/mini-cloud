import { EmfDocument } from '@mini-cloud/shared';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SpoolSink } from '../../src/metrics/metric-sink';

/** Frozen, so the hourly file a write lands in is the one the test reads. */
const NOW = Date.UTC(2026, 9, 14, 15, 30);

function document(value: number): EmfDocument {
  return { _aws: { Timestamp: 0, CloudWatchMetrics: [{ Namespace: 'Test', Dimensions: [[]], Metrics: [{ Name: 'Value' }] }] }, Value: value };
}

describe('SpoolSink', () => {
  let root: string;
  let spoolDir: string;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    root = mkdtempSync(path.join(tmpdir(), 'mini-cloud-sink-'));
    spoolDir = path.join(root, 'spool');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('makes the spool directory again when it is removed while the program runs, and keeps the document written then', async () => {
    const sink = new SpoolSink({ spoolDir, writerId: 'daemon' });
    await sink.write(document(1));

    rmSync(spoolDir, { recursive: true, force: true });
    await sink.write(document(2));

    const lines = readFileSync(sink.filePath(NOW), 'utf-8')
      .split('\n')
      .filter((line) => line.length > 0);
    expect(lines.map((line): unknown => JSON.parse(line))).toEqual([document(2)]);
  });

  it('still resolves when the spool directory is replaced by something it cannot write into', async () => {
    const sink = new SpoolSink({ spoolDir, writerId: 'daemon' });
    await sink.write(document(1));

    rmSync(spoolDir, { recursive: true, force: true });
    writeFileSync(spoolDir, '');

    await expect(sink.write(document(2))).resolves.toBeUndefined();
  });
});
