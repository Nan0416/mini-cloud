import { PgVariableDao } from '../../src/data/pg-variable-dao';
import { fakePool } from './test-helpers';

describe('PgVariableDao.listVariables', () => {
  it('folds the rows into one object', async () => {
    const pool = fakePool().on('SELECT name, value', {
      rows: [
        { name: 'ROOT', value: '/srv/app' },
        { name: 'STAGE', value: 'beta' },
      ],
    });

    const { variables } = await new PgVariableDao(pool.asPool()).listVariables({});

    expect(variables).toEqual({ ROOT: '/srv/app', STAGE: 'beta' });
    expect(pool.sql(0)).toContain('ORDER BY name ASC');
  });

  it('returns an empty set rather than failing when nothing is configured', async () => {
    expect((await new PgVariableDao(fakePool().asPool()).listVariables({})).variables).toEqual({});
  });
});

describe('PgVariableDao.replaceVariables', () => {
  it('deletes what is gone and upserts what remains, atomically', async () => {
    const pool = fakePool().on('SELECT name, value', { rows: [{ name: 'ROOT', value: '/srv/app' }] });

    await new PgVariableDao(pool.asPool()).replaceVariables({ variables: { ROOT: '/srv/app' } });

    // One transaction, because a set-replacement that a reader can observe half-applied
    // would hand a launching task a variable set that never existed.
    const inTransaction = pool.queries.filter((query) => query.onClient).map((query) => query.sql.replace(/\s+/g, ' ').trim());
    expect(inTransaction[0]).toBe('BEGIN');
    expect(inTransaction[1]).toContain('DELETE FROM replacement_variable WHERE NOT (name = ANY($1::text[]))');
    expect(inTransaction[2]).toContain('INSERT INTO replacement_variable');
    expect(inTransaction[3]).toBe('COMMIT');
    expect(pool.releases).toBe(1);
  });

  it('binds the names and values as two arrays in matching order', async () => {
    const pool = fakePool().on('SELECT name, value', { rows: [] });

    await new PgVariableDao(pool.asPool()).replaceVariables({ variables: { ROOT: '/srv/app', STAGE: 'beta' } });

    // unnest zips them back into pairs, so a mismatch would assign each name the
    // wrong value rather than fail.
    expect(pool.find('INSERT INTO replacement_variable').values).toEqual([
      ['ROOT', 'STAGE'],
      ['/srv/app', 'beta'],
    ]);
  });

  it('deletes everything and inserts nothing when handed an empty set', async () => {
    const pool = fakePool();

    await new PgVariableDao(pool.asPool()).replaceVariables({ variables: {} });

    // `NOT (name = ANY('{}'))` is true for every row, so the DELETE alone clears the
    // table — and an INSERT of two empty arrays would be a wasted round trip.
    expect(pool.find('DELETE FROM replacement_variable').values).toEqual([[]]);
    expect(pool.statements.some((sql) => sql.includes('INSERT INTO'))).toBe(false);
  });

  it('overwrites the value of a name that already exists', async () => {
    const pool = fakePool().on('SELECT name, value', { rows: [] });

    await new PgVariableDao(pool.asPool()).replaceVariables({ variables: { ROOT: '/new' } });

    // The DELETE spares names that are being kept, so those rows are still there when
    // the INSERT runs and it has to update rather than conflict.
    expect(pool.find('INSERT INTO replacement_variable').sql).toContain('ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value');
  });

  it('returns the set as stored, read back after the commit', async () => {
    const pool = fakePool().on('SELECT name, value', { rows: [{ name: 'ROOT', value: '/srv/app' }] });

    const { variables } = await new PgVariableDao(pool.asPool()).replaceVariables({ variables: { ROOT: '/srv/app' } });

    // Read back rather than echoed, so the caller sees what the database actually
    // holds — including anything a concurrent writer changed.
    expect(variables).toEqual({ ROOT: '/srv/app' });
    expect(pool.queries[pool.queries.length - 1]?.onClient).toBe(false);
  });

  it('rolls back, releases the client and rethrows when a statement fails', async () => {
    const pool = fakePool().failOn('INSERT INTO replacement_variable', new Error('value too long'));

    await expect(new PgVariableDao(pool.asPool()).replaceVariables({ variables: { ROOT: '/srv/app' } })).rejects.toThrow('value too long');

    expect(pool.statements[pool.statements.length - 1]).toBe('ROLLBACK');
    expect(pool.releases).toBe(1);
    // The failed replacement must not be followed by a read that reports success.
    expect(pool.statements.some((sql) => sql.includes('SELECT name, value'))).toBe(false);
  });
});
