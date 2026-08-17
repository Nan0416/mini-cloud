import { ReplacementVariables } from '@mini-cloud/shared';
import { Pool } from 'pg';
import { ListVariablesInput, ListVariablesOutput, ReplaceVariablesInput, ReplaceVariablesOutput, VariableDao } from './variable-dao';

interface VariableRow {
  readonly name: string;
  readonly value: string;
}

function toVariables(rows: ReadonlyArray<VariableRow>): ReplacementVariables {
  const variables: Record<string, string> = {};
  for (const row of rows) {
    variables[row.name] = row.value;
  }
  return variables;
}

/**
 * Replacement variables live in the database rather than a JSON file on disk, so
 * they participate in the same backups as everything else and a second service
 * process would see the same values.
 */
export class PgVariableDao implements VariableDao {
  constructor(private readonly pool: Pool) {}

  async listVariables(_input: ListVariablesInput): Promise<ListVariablesOutput> {
    const result = await this.pool.query<VariableRow>('SELECT name, value FROM replacement_variable ORDER BY name ASC');
    return { variables: toVariables(result.rows) };
  }

  async replaceVariables(input: ReplaceVariablesInput): Promise<ReplaceVariablesOutput> {
    const { variables } = input;
    const names = Object.keys(variables);
    const values = names.map((name) => variables[name]);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Delete-then-insert inside one transaction: a set-replacement should be
      // atomic, so a reader never sees a half-applied set.
      await client.query('DELETE FROM replacement_variable WHERE NOT (name = ANY($1::text[]))', [names]);
      if (names.length > 0) {
        await client.query(
          `INSERT INTO replacement_variable (name, value)
           SELECT * FROM unnest($1::text[], $2::text[])
           ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [names, values],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return this.listVariables({});
  }
}
