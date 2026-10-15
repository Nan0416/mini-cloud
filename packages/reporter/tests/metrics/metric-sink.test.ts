import { EmfDocument } from '@mini-cloud/shared';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SpoolSink } from '../../src/metrics/metric-sink';

function document(value: number): EmfDocument {
  return { _aws: { Timestamp: 0, CloudWatchMetrics: [{ Namespace: 'Test', Dimensions: [[]], Metrics: [{ Name: 'Value' }] }] }, Value: value };
}

describe('SpoolSink', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'mini-cloud-sink-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('makes the spool directory again when it is removed while the program runs, and keeps the document written then', async () => {
    const spoolDir = path.join(root, 'spool');
    const sink = new SpoolSink({ spoolDir, writerId: 'daemon' });
    await sink.write(document(1));

    rmSync(spoolDir, { recursive: true, force: true });
    await sink.write(document(2));

    const lines = readFileSync(sink.filePath(), 'utf-8')
      .split('\n')
      .filter((line) => line.length > 0);
    expect(lines.map((line): unknown => JSON.parse(line))).toEqual([document(2)]);
  });

  it('still resolves when the directory cannot be made at all', async () => {
    writeFileSync(path.join(root, 'file'), '');
    const sink = new SpoolSink({ spoolDir: path.join(root, 'file', 'spool'), writerId: 'daemon' });

    await expect(sink.write(document(1))).resolves.toBeUndefined();
  });
});
