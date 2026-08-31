import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listMigrationFiles } from '../../src/data/migrate';

/**
 * Ordering is the whole contract of a migration runner: a migration that alters a
 * table has to run after the one that created it. These tests pin the order down
 * without needing a database.
 */
describe('listMigrationFiles', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mini-cloud-migrations-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (...files: string[]): void => {
    for (const file of files) {
      writeFileSync(path.join(dir, file), '-- test migration\n');
    }
  };

  it('orders by sequence number regardless of the order the filesystem returns them', () => {
    write('003_c.sql', '001_a.sql', '002_b.sql');
    expect(listMigrationFiles(dir)).toEqual(['001_a.sql', '002_b.sql', '003_c.sql']);
  });

  it('orders numerically, not lexicographically', () => {
    // The case a plain .sort() gets wrong: it would put 10 and 100 before 2.
    write('1_a.sql', '2_b.sql', '10_j.sql', '100_x.sql');
    expect(listMigrationFiles(dir)).toEqual(['1_a.sql', '2_b.sql', '10_j.sql', '100_x.sql']);
  });

  it('treats zero padding as cosmetic', () => {
    write('001_a.sql', '2_b.sql', '0003_c.sql');
    expect(listMigrationFiles(dir)).toEqual(['001_a.sql', '2_b.sql', '0003_c.sql']);
  });

  it('ignores files that are not .sql', () => {
    write('001_a.sql', 'README.md', 'notes.txt');
    expect(listMigrationFiles(dir)).toEqual(['001_a.sql']);
  });

  it('skips a subdirectory that happens to end in .sql', () => {
    write('001_a.sql');
    mkdirSync(path.join(dir, 'archive.sql'));
    expect(listMigrationFiles(dir)).toEqual(['001_a.sql']);
  });

  it('rejects a filename with no sequence number, rather than guessing where it belongs', () => {
    write('001_a.sql', 'add_artifacts.sql');
    expect(() => listMigrationFiles(dir)).toThrow(/not named <sequence>_<name>\.sql/);
  });

  it('rejects two migrations sharing a sequence number', () => {
    // The merge-collision case: two branches each add an 002_.
    write('001_a.sql', '002_artifacts.sql', '002_issues.sql');
    expect(() => listMigrationFiles(dir)).toThrow(/share sequence number 2/);
  });

  it('returns nothing for an empty directory', () => {
    expect(listMigrationFiles(dir)).toEqual([]);
  });
});
