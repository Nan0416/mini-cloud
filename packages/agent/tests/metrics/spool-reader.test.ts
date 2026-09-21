import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SpoolReader, isRetired, spoolFileHour } from '../../src/metrics/spool-reader';

const HOUR = Date.UTC(2026, 8, 19, 14);
const FILE = 'inst-1-2026-09-19-14.emf';

describe('spoolFileHour', () => {
  it('reads the hour a file belongs to out of its name', () => {
    expect(spoolFileHour(FILE)).toBe(HOUR);
  });

  it('accepts a writer id containing dashes', () => {
    expect(spoolFileHour('my-instance-id-2026-09-19-14.emf')).toBe(HOUR);
  });

  it('ignores a file that is not a spool file', () => {
    expect(spoolFileHour('offline-reports.jsonl')).toBeUndefined();
    expect(spoolFileHour('inst-1-2026-09-19-14.emf.tmp')).toBeUndefined();
  });
});

describe('isRetired', () => {
  it('keeps following a file past its own hour, because a program may still be writing', () => {
    expect(isRetired(FILE, HOUR + 61 * 60_000)).toBe(false);
  });

  it('retires a file once nothing can still be appending to it', () => {
    expect(isRetired(FILE, HOUR + 70 * 60_000)).toBe(true);
  });
});

describe('SpoolReader', () => {
  let dir: string;
  let reader: SpoolReader;

  const spoolFile = (): string => path.join(dir, 'spool', FILE);

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'mini-cloud-spool-'));
    await mkdir(path.join(dir, 'spool'), { recursive: true });
    reader = new SpoolReader({ spoolDir: path.join(dir, 'spool'), offsetsPath: path.join(dir, 'offsets.json') });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns nothing when no program has recorded a metric', async () => {
    const empty = new SpoolReader({ spoolDir: path.join(dir, 'missing'), offsetsPath: path.join(dir, 'offsets.json') });

    expect((await empty.read()).lines).toEqual([]);
  });

  it('reads whole lines', async () => {
    await writeFile(spoolFile(), '{"a":1}\n{"a":2}\n');

    expect((await reader.read()).lines).toEqual(['{"a":1}', '{"a":2}']);
  });

  it('leaves a record that is still being written for the next read', async () => {
    // A read that stopped mid-record would hand the parser garbage and lose the
    // observation, which is exactly what the legacy agent did.
    await writeFile(spoolFile(), '{"a":1}\n{"a":2');

    const batch = await reader.read();

    expect(batch.lines).toEqual(['{"a":1}']);
    expect(batch.offsets[FILE]).toBe('{"a":1}\n'.length);
  });

  it('returns nothing at all while the only record is incomplete', async () => {
    await writeFile(spoolFile(), '{"a":1');

    const batch = await reader.read();

    expect(batch.lines).toEqual([]);
    expect(batch.offsets[FILE]).toBe(0);
  });

  it('picks up where it left off once the offsets are saved', async () => {
    await writeFile(spoolFile(), '{"a":1}\n');
    await reader.saveOffsets((await reader.read()).offsets);

    await appendFile(spoolFile(), '{"a":2}\n');

    expect((await reader.read()).lines).toEqual(['{"a":2}']);
  });

  it('re-reads from the start when offsets were never saved', async () => {
    // Offsets are returned rather than saved by the reader, so the caller can make
    // the data durable first. A tick that failed before that simply replays.
    await writeFile(spoolFile(), '{"a":1}\n');
    await reader.read();

    expect((await reader.read()).lines).toEqual(['{"a":1}']);
  });

  it('starts over when a file was truncated beneath a saved offset', async () => {
    await writeFile(spoolFile(), '{"a":1}\n{"a":2}\n');
    await reader.saveOffsets((await reader.read()).offsets);

    await writeFile(spoolFile(), '{"b":1}\n');

    expect((await reader.read()).lines).toEqual(['{"b":1}']);
  });

  it('ignores files in the spool directory that are not spool files', async () => {
    await writeFile(path.join(dir, 'spool', 'notes.txt'), 'hello\n');

    expect((await reader.read()).lines).toEqual([]);
  });

  it('survives an unreadable offsets file rather than refusing to start', async () => {
    await writeFile(path.join(dir, 'offsets.json'), 'not json');
    await writeFile(spoolFile(), '{"a":1}\n');

    expect((await reader.read()).lines).toEqual(['{"a":1}']);
  });

  it('removes a file nothing can still be appending to, and forgets it', async () => {
    await writeFile(spoolFile(), '{"a":1}\n');
    const batch = await reader.read();

    const kept = await reader.retire(batch.offsets, HOUR + 70 * 60_000);

    expect(kept).toEqual({});
    expect(existsSync(spoolFile())).toBe(false);
  });

  it('keeps a file that is still within its following window', async () => {
    await writeFile(spoolFile(), '{"a":1}\n');
    const batch = await reader.read();

    const kept = await reader.retire(batch.offsets, HOUR + 30 * 60_000);

    expect(Object.keys(kept)).toEqual([FILE]);
    expect(existsSync(spoolFile())).toBe(true);
  });

  it('saves offsets as readable JSON, so a stuck spool can be inspected', async () => {
    await writeFile(spoolFile(), '{"a":1}\n');
    await reader.saveOffsets((await reader.read()).offsets);

    expect(JSON.parse(await readFile(path.join(dir, 'offsets.json'), { encoding: 'utf-8' }))).toEqual({ [FILE]: 8 });
  });
});
