import { EnvironmentVariables, HealthCheck, InternalServiceError, LoggerFactory, Task, TaskIdentifier, TaskIdentifierWithHealthCheck } from '@mini-cloud/shared';
import { Pool } from 'pg';
import { CreateTaskVersionInput, ScheduledJob, TaskDao } from './task-dao';

const logger = LoggerFactory.getLogger('PgTaskDao');

interface TaskRow {
  readonly task_id: string;
  readonly version: number;
  readonly name: string;
  readonly description: string | null;
  readonly type: string;
  readonly cmd: string;
  readonly cwd: string;
  readonly arguments: string[] | null;
  readonly env: Record<string, string> | null;
  readonly stdout: string | null;
  readonly stderr: string | null;
  readonly health_check: HealthCheck | null;
  readonly duration_ms: string | null;
  readonly first_launch_at: Date | null;
  readonly created_at: Date;
  readonly head_updated_at: Date | null;
}

const SELECT_TASK = `
  SELECT t.*, h.updated_at AS head_updated_at
  FROM task t
  LEFT JOIN task_head h ON h.task_id = t.task_id AND h.version = t.version
`;

function toTask(row: TaskRow): Task {
  const base = {
    taskId: row.task_id,
    version: row.version,
    createdAt: row.created_at.getTime(),
    // A version is immutable, so its "last updated" is when it became the head.
    lastUpdatedAt: (row.head_updated_at ?? row.created_at).getTime(),
    name: row.name,
    description: row.description ?? undefined,
    cmd: row.cmd,
    cwd: row.cwd,
    arguments: row.arguments ?? undefined,
    env: row.env === null ? undefined : toEnv(row.env),
    stdout: row.stdout ?? undefined,
    stderr: row.stderr ?? undefined,
  };

  if (row.type === 'job') {
    return {
      ...base,
      type: 'job',
      // int8 arrives as a string from pg; a ms interval always fits a JS number.
      duration: row.duration_ms === null ? undefined : Number(row.duration_ms),
      firstLaunchAt: row.first_launch_at === null ? undefined : row.first_launch_at.getTime(),
    };
  }
  if (row.type === 'service') {
    return { ...base, type: 'service', healthCheck: row.health_check ?? undefined };
  }
  throw new InternalServiceError(`Task ${row.task_id} version ${row.version} has unrecognised type "${row.type}".`);
}

function toEnv(raw: Record<string, string>): EnvironmentVariables {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    env[key] = value;
  }
  return env;
}

export class PgTaskDao implements TaskDao {
  constructor(private readonly pool: Pool) {}

  async createTaskVersion(input: CreateTaskVersionInput): Promise<void> {
    logger.info(`Inserting task ${input.taskId} version ${input.version}.`);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO task (task_id, version, name, description, type, cmd, cwd, arguments, env, stdout, stderr, health_check, duration_ms, first_launch_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          input.taskId,
          input.version,
          input.name,
          input.description ?? null,
          input.type,
          input.cmd,
          input.cwd,
          input.arguments === undefined ? null : JSON.stringify(input.arguments),
          input.env === undefined ? null : JSON.stringify(input.env),
          input.stdout ?? null,
          input.stderr ?? null,
          input.healthCheck === undefined ? null : JSON.stringify(input.healthCheck),
          input.durationMs ?? null,
          input.firstLaunchAt === undefined ? null : new Date(input.firstLaunchAt),
        ],
      );
      // The head must move in the same transaction as the insert, otherwise a crash
      // in between would leave a version nothing points at.
      await client.query(
        `INSERT INTO task_head (task_id, version, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (task_id) DO UPDATE SET version = EXCLUDED.version, updated_at = now()`,
        [input.taskId, input.version],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getTaskVersion(taskId: string, version: number): Promise<Task | null> {
    const result = await this.pool.query<TaskRow>(`${SELECT_TASK} WHERE t.task_id = $1 AND t.version = $2`, [taskId, version]);
    const row = result.rows[0];
    return row === undefined ? null : toTask(row);
  }

  async getLatestTask(taskId: string): Promise<Task | null> {
    const result = await this.pool.query<TaskRow>(`${SELECT_TASK} WHERE t.task_id = $1 AND h.version IS NOT NULL`, [taskId]);
    const row = result.rows[0];
    return row === undefined ? null : toTask(row);
  }

  async getLatestVersionNumber(taskId: string): Promise<number | null> {
    const result = await this.pool.query<{ version: number }>('SELECT version FROM task_head WHERE task_id = $1', [taskId]);
    const row = result.rows[0];
    return row === undefined ? null : row.version;
  }

  async listLatestTasks(): Promise<ReadonlyArray<Task>> {
    const result = await this.pool.query<TaskRow>(`${SELECT_TASK} WHERE h.version IS NOT NULL ORDER BY t.created_at DESC`);
    return result.rows.map(toTask);
  }

  async deleteTask(taskId: string): Promise<void> {
    logger.info(`Deleting task ${taskId} and all of its versions.`);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM task_head WHERE task_id = $1', [taskId]);
      await client.query('DELETE FROM task_dynamics WHERE task_id = $1', [taskId]);
      await client.query('DELETE FROM task WHERE task_id = $1', [taskId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async listHealthChecks(identifiers: ReadonlyArray<TaskIdentifier>): Promise<ReadonlyArray<TaskIdentifierWithHealthCheck>> {
    if (identifiers.length === 0) {
      return [];
    }
    // One round trip for the whole set: unnest the (id, version) pairs and join.
    const result = await this.pool.query<{ task_id: string; version: number; health_check: HealthCheck }>(
      `SELECT t.task_id, t.version, t.health_check
       FROM task t
       JOIN unnest($1::text[], $2::int[]) AS wanted(task_id, version)
         ON wanted.task_id = t.task_id AND wanted.version = t.version
       WHERE t.health_check IS NOT NULL`,
      [identifiers.map((identifier) => identifier.taskId), identifiers.map((identifier) => identifier.version)],
    );

    return result.rows.map((row) => ({ taskId: row.task_id, version: row.version, healthCheck: row.health_check }));
  }

  async listScheduledJobs(): Promise<ReadonlyArray<ScheduledJob>> {
    // Spelled out rather than composed from SELECT_TASK: this query needs a column
    // from the dynamics join, and appending a JOIN to a shared SELECT list silently
    // leaves that column out of the result set.
    const result = await this.pool.query<TaskRow & { target_agent_ids: string[] }>(
      `SELECT t.*, h.updated_at AS head_updated_at, d.target_agent_ids
       FROM task t
       JOIN task_head h ON h.task_id = t.task_id AND h.version = t.version
       JOIN task_dynamics d ON d.task_id = t.task_id
       WHERE t.type = 'job'
         AND d.active = TRUE
         AND t.first_launch_at IS NOT NULL
         AND cardinality(d.target_agent_ids) > 0`,
    );

    const jobs: ScheduledJob[] = [];
    for (const row of result.rows) {
      const task = toTask(row);
      if (task.type !== 'job') {
        // Unreachable given the WHERE clause, but keeps the narrowing honest.
        continue;
      }
      jobs.push({ job: task, targetAgentIds: row.target_agent_ids });
    }
    return jobs;
  }
}
