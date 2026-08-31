import type { Pool, PoolClient, QueryResult } from 'pg';

/**
 * A `pg.Pool` stand-in that records what a DAO asked for and answers with rows the
 * test supplies.
 *
 * The DAOs hold no state of their own — every method is a statement plus a mapping
 * from rows to a domain model — so what is worth pinning down is exactly what this
 * records: which statements were issued, in what order, with which parameters, and
 * what the mapping made of the rows that came back. Those are also the parts that
 * break silently. Passing an epoch-ms number where a `timestamptz` is expected, or
 * reading `int8` as a number when pg hands back a string, type-checks fine and only
 * shows up as wrong data at runtime.
 *
 * The SQL itself — whether a join is right, whether a rank guard actually excludes
 * the row it should — is not something a fake can answer. That lives in
 * `tests/data-integration/`, against a real database.
 */

/** One statement a DAO issued. `onClient` marks it as inside a transaction. */
export interface RecordedQuery {
  readonly sql: string;
  readonly values: ReadonlyArray<unknown>;
  readonly onClient: boolean;
}

/**
 * What a matched statement should answer with, or throw instead.
 *
 * `rowCount` is `number | null` because that is pg's own type for it, and a DAO that
 * reads it without allowing for null is a crash waiting for the right statement.
 * Omitting it defaults to the number of rows; setting it to null is honoured.
 */
export type Reply = { readonly rows?: ReadonlyArray<object>; readonly rowCount?: number | null } | Error;

interface Rule {
  readonly fragment: string;
  readonly reply: Reply;
}

export class FakePool {
  readonly queries: RecordedQuery[] = [];
  /** How many transaction clients were handed back. Should always equal `connect` calls. */
  connects = 0;
  releases = 0;

  private readonly rules: Rule[] = [];

  /**
   * Answer any statement containing `fragment` with `reply`.
   *
   * Matching on a fragment rather than on call position keeps a test readable when a
   * method issues several statements — `replaceVariables` runs five — and means
   * adding a statement to a DAO does not silently shift every later expectation onto
   * the wrong query. Rules are tried in the order they were added; anything unmatched
   * answers with no rows.
   */
  on(fragment: string, reply: Reply): this {
    this.rules.push({ fragment, reply });
    return this;
  }

  /** Make every statement containing `fragment` reject with `error`. */
  failOn(fragment: string, error: Error): this {
    return this.on(fragment, error);
  }

  /** Every statement issued, whitespace collapsed so assertions fit on one line. */
  get statements(): ReadonlyArray<string> {
    return this.queries.map((query) => collapse(query.sql));
  }

  /** The statement at `index`, whitespace collapsed. */
  sql(index: number): string {
    return collapse(this.at(index).sql);
  }

  /** The parameters bound to the statement at `index`. */
  values(index: number): ReadonlyArray<unknown> {
    return this.at(index).values;
  }

  /** The one statement containing `fragment`. Throws unless exactly one matches. */
  find(fragment: string): RecordedQuery {
    const matches = this.queries.filter((query) => query.sql.includes(fragment));
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one statement containing "${fragment}", found ${matches.length}:\n${this.statements.join('\n')}`);
    }
    return matches[0] as RecordedQuery;
  }

  /** The DAOs take a `Pool`; this is the shape of it they actually touch. */
  asPool(): Pool {
    return this as unknown as Pool;
  }

  query = (sql: string, values?: unknown[]): Promise<QueryResult> => this.run(sql, values, false);

  connect = (): Promise<PoolClient> => {
    this.connects += 1;
    const client = {
      query: (sql: string, values?: unknown[]): Promise<QueryResult> => this.run(sql, values, true),
      release: (): void => {
        this.releases += 1;
      },
    };
    return Promise.resolve(client as unknown as PoolClient);
  };

  private at(index: number): RecordedQuery {
    const query = this.queries[index];
    if (query === undefined) {
      throw new Error(`No statement at index ${index}; ${this.queries.length} were issued:\n${this.statements.join('\n')}`);
    }
    return query;
  }

  private run(sql: string, values: unknown[] | undefined, onClient: boolean): Promise<QueryResult> {
    this.queries.push({ sql, values: values ?? [], onClient });

    const rule = this.rules.find((candidate) => sql.includes(candidate.fragment));
    if (rule?.reply instanceof Error) {
      return Promise.reject(rule.reply);
    }
    const reply = rule?.reply;
    const rows = reply?.rows ?? [];
    // `in` rather than `??`, so an explicit null survives instead of falling back.
    const rowCount = reply !== undefined && 'rowCount' in reply ? (reply.rowCount ?? null) : rows.length;
    return Promise.resolve({ rows, rowCount, command: '', oid: 0, fields: [] } as unknown as QueryResult);
  }
}

function collapse(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

/** `new FakePool()`, but reads better at the top of a test. */
export function fakePool(): FakePool {
  return new FakePool();
}

/**
 * `pg` returns `timestamptz` as a `Date`. Tests build rows with this so the epoch ms
 * they assert on is the same number they started from.
 */
export function at(epochMs: number): Date {
  return new Date(epochMs);
}
