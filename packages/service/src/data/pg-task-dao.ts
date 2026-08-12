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
  /** When version 1 of this task was written, i.e. when the task first existed. */
  readonly task_created_at: Date;
}

/**
 * The newest version of every task.
 *
 * `DISTINCT ON` keeps the first row per `task_id` under the given ordering, so
 * ordering by descending version yields the head of each task in one pass — no head
 * pointer to maintain and no correlated subquery per row. The window function runs
 * before `DISTINCT ON`, which is what lets each surviving row still carry the
 * original creation time of its whole task.
 */
const SELECT_LATEST_TASKS = `
  SELECT DISTINCT ON (t.task_id) t.*, MIN(t.created_at) OVER (PARTITION BY t.task_id) AS task_created_at
  FROM task t
`;

function toTask(row: TaskRow): Task {
  const base = {
    taskId: row.task_id,
    version: row.version,
    createdAt: row.task_created_at.getTime(),
    // A version is immutable, so when this version was written is exactly when the
    // task was last edited.
    lastUpdatedAt: row.created_at.getTime(),
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

  /**
   * A single INSERT. Because "latest" is derived rather than stored, writing a new
   * version needs no second write and therefore no transaction to keep two tables
   * agreeing with each other.
   */
  async createTaskVersion(input: CreateTaskVersionInput): Promise<void> {
    logger.info(`Inserting task ${input.taskId} version ${input.version}.`);
    await this.pool.query(
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
  }

  async getTaskVersion(taskId: string, version: number): Promise<Task | null> {
    const result = await this.pool.query<TaskRow>(
      `SELECT t.*, (SELECT MIN(created_at) FROM task WHERE task_id = $1) AS task_created_at
       FROM task t WHERE t.task_id = $1 AND t.version = $2`,
      [taskId, version],
    );
    const row = result.rows[0];
    return row === undefined ? null : toTask(row);
  }

  async getLatestTask(taskId: string): Promise<Task | null> {
    const result = await this.pool.query<TaskRow>(
      `SELECT t.*, (SELECT MIN(created_at) FROM task WHERE task_id = $1) AS task_created_at
       FROM task t WHERE t.task_id = $1 ORDER BY t.version DESC LIMIT 1`,
      [taskId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toTask(row);
  }

  async getLatestVersionNumber(taskId: string): Promise<number | null> {
    const result = await this.pool.query<{ version: number | null }>('SELECT MAX(version) AS version FROM task WHERE task_id = $1', [taskId]);
    // MAX over no rows yields one row holding NULL, not zero rows.
    return result.rows[0]?.version ?? null;
  }

  async listLatestTasks(): Promise<ReadonlyArray<Task>> {
    const result = await this.pool.query<TaskRow>(`${SELECT_LATEST_TASKS} ORDER BY t.task_id, t.version DESC`);
    const tasks = result.rows.map(toTask);
    // DISTINCT ON dictates the SQL ordering, so present the caller-facing order here.
    return [...tasks].sort((left, right) => right.createdAt - left.createdAt);
  }

  async deleteTask(taskId: string): Promise<void> {
    logger.info(`Deleting task ${taskId} and all of its versions.`);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
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
    // The filters live in the DISTINCT ON subquery so that "is this job schedulable"
    // is judged against the head version. Filtering afterwards would let an older
    // version that happened to be schedulable stand in for a head version that is not.
    const result = await this.pool.query<TaskRow & { target_agent_ids: string[] }>(
      `SELECT head.*, d.target_agent_ids
       FROM (${SELECT_LATEST_TASKS} ORDER BY t.task_id, t.version DESC) AS head
       JOIN task_dynamics d ON d.task_id = head.task_id
       WHERE head.type = 'job'
         AND d.active = TRUE
         AND head.first_launch_at IS NOT NULL
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
