import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultMigrationsDir, defaultMigrationSource, embeddedMigrations, listMigrationFiles } from '../../src/data/migrate';

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

describe('embeddedMigrations', () => {
  it('orders compiled-in SQL by exactly the rules the directory uses', () => {
    // Object key order is insertion order, which is whatever the generator happened to
    // emit. The sequence number has to decide, or a binary would apply its schema in a
    // different order than a checkout does — the one difference that cannot be
    // recovered from once it has run.
    const source = embeddedMigrations({ '010_j.sql': 'j', '002_b.sql': 'b', '001_a.sql': 'a' });

    expect(source.list()).toEqual(['001_a.sql', '002_b.sql', '010_j.sql']);
  });

  it('hands back the SQL it was compiled with', () => {
    expect(embeddedMigrations({ '001_a.sql': 'CREATE TABLE a ();' }).read('001_a.sql')).toBe('CREATE TABLE a ();');
  });

  it('refuses a name it does not have, rather than applying nothing and recording it', () => {
    // Only reachable if the compiled set and the applied set disagree. Returning empty
    // SQL here would mark a migration applied without running it, which is the failure
    // that is invisible until something reads the missing column.
    expect(() => embeddedMigrations({}).read('001_a.sql')).toThrow(/not compiled into this build/);
  });

  it('rejects a duplicate sequence the same way a directory does', () => {
    expect(() => embeddedMigrations({ '002_a.sql': 'a', '002_b.sql': 'b' }).list()).toThrow(/share sequence number 2/);
  });
});

describe('defaultMigrationSource', () => {
  it('reads the directory when nothing was compiled in, which is every build but the binary', () => {
    // `EMBEDDED_MIGRATIONS` is empty in the repository and replaced only by the SEA
    // bundler's alias, so this is the path `npm start` and the tests take.
    expect(defaultMigrationSource().describe()).toBe(defaultMigrationsDir());
  });
});
