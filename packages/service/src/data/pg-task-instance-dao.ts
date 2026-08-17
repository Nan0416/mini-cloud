import { LoggerFactory, TASK_INSTANCE_STATUS_RANK, TaskInstance } from '@mini-cloud/shared';
import { Pool } from 'pg';
import {
  CreateInstanceInput,
  CreateInstanceOutput,
  DeleteInstancesUpdatedBeforeInput,
  DeleteInstancesUpdatedBeforeOutput,
  GetInstanceInput,
  GetInstanceOutput,
  ListInstancesInput,
  ListInstancesOutput,
  ListStaleInstancesInput,
  ListStaleInstancesOutput,
  SetPidInput,
  SetPidOutput,
  TaskInstanceDao,
  UpdateStatusInput,
  UpdateStatusOutput,
} from './task-instance-dao';
import { toTaskInstanceStatus } from './row-parsers';

const logger = LoggerFactory.getLogger('PgTaskInstanceDao');

interface InstanceRow {
  readonly instance_id: string;
  readonly task_id: string;
  readonly task_version: number;
  readonly agent_id: string;
  readonly pid: number | null;
  readonly status: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function toInstance(row: InstanceRow): TaskInstance {
  return {
    instanceId: row.instance_id,
    taskId: row.task_id,
    taskVersion: row.task_version,
    agentId: row.agent_id,
    pid: row.pid ?? undefined,
    status: toTaskInstanceStatus(row.status, row.instance_id),
    createdAt: row.created_at.getTime(),
    lastUpdatedAt: row.updated_at.getTime(),
  };
}

const SELECT_COLUMNS = 'instance_id, task_id, task_version, agent_id, pid, status, created_at, updated_at';

export class PgTaskInstanceDao implements TaskInstanceDao {
  constructor(private readonly pool: Pool) {}

  async createInstance(input: CreateInstanceInput): Promise<CreateInstanceOutput> {
    await this.pool.query('INSERT INTO task_instance (instance_id, task_id, task_version, agent_id, status, status_rank) VALUES ($1, $2, $3, $4, $5, $6)', [
      input.instanceId,
      input.taskId,
      input.taskVersion,
      input.agentId,
      input.status,
      TASK_INSTANCE_STATUS_RANK[input.status],
    ]);
    return {};
  }

  async getInstance(input: GetInstanceInput): Promise<GetInstanceOutput> {
    const result = await this.pool.query<InstanceRow>(`SELECT ${SELECT_COLUMNS} FROM task_instance WHERE instance_id = $1`, [input.instanceId]);
    const row = result.rows[0];
    return { instance: row === undefined ? null : toInstance(row) };
  }

  async listInstances(input: ListInstancesInput): Promise<ListInstancesOutput> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    const add = (clause: string, value: unknown): void => {
      values.push(value);
      conditions.push(clause.replace('?', `$${values.length}`));
    };

    if (input.taskId !== undefined) {
      add('task_id = ?', input.taskId);
    }
    if (input.version !== undefined) {
      add('task_version = ?', input.version);
    }
    if (input.agentId !== undefined) {
      add('agent_id = ?', input.agentId);
    }
    if (input.status !== undefined) {
      add('status = ?', input.status);
    }
    if (input.from !== undefined) {
      add('updated_at >= ?', new Date(input.from));
    }
    if (input.to !== undefined) {
      add('updated_at < ?', new Date(input.to));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(input.limit ?? 200);
    const sql = `SELECT ${SELECT_COLUMNS} FROM task_instance ${where} ORDER BY updated_at DESC LIMIT $${values.length}`;

    const result = await this.pool.query<InstanceRow>(sql, values);
    return { instances: result.rows.map(toInstance) };
  }

  async updateStatus(input: UpdateStatusInput): Promise<UpdateStatusOutput> {
    const { instanceId, status } = input;
    const rank = TASK_INSTANCE_STATUS_RANK[status];
    // Equal ranks are allowed through, which is what lets an instance flip between
    // `running` and `health_check_failure` in either direction.
    const updated = await this.pool.query<{ status: string }>(
      `UPDATE task_instance SET status = $2, status_rank = $3, updated_at = now()
       WHERE instance_id = $1 AND status_rank <= $3
       RETURNING status`,
      [instanceId, status, rank],
    );

    const updatedRow = updated.rows[0];
    if (updatedRow !== undefined) {
      return { found: true, applied: true, currentStatus: toTaskInstanceStatus(updatedRow.status, instanceId) };
    }

    // Nothing was updated: either the instance is gone, or the guard rejected it.
    const existing = await this.pool.query<{ status: string }>('SELECT status FROM task_instance WHERE instance_id = $1', [instanceId]);
    const existingRow = existing.rows[0];
    if (existingRow === undefined) {
      return { found: false, applied: false };
    }
    logger.warn(`Ignored status "${status}" for instance ${instanceId}: it already advanced to "${existingRow.status}".`);
    return { found: true, applied: false, currentStatus: toTaskInstanceStatus(existingRow.status, instanceId) };
  }

  async setPid(input: SetPidInput): Promise<SetPidOutput> {
    const result = await this.pool.query('UPDATE task_instance SET pid = $2, updated_at = now() WHERE instance_id = $1', [input.instanceId, input.pid]);
    return { found: (result.rowCount ?? 0) > 0 };
  }

  async listStaleInstances(input: ListStaleInstancesInput): Promise<ListStaleInstancesOutput> {
    const result = await this.pool.query<InstanceRow>(`SELECT ${SELECT_COLUMNS} FROM task_instance WHERE status = $1 AND updated_at < $2`, [
      input.status,
      new Date(input.olderThan),
    ]);
    return { instances: result.rows.map(toInstance) };
  }

  async deleteInstancesUpdatedBefore(input: DeleteInstancesUpdatedBeforeInput): Promise<DeleteInstancesUpdatedBeforeOutput> {
    const result = await this.pool.query('DELETE FROM task_instance WHERE updated_at < $1', [new Date(input.before)]);
    return { deletedCount: result.rowCount ?? 0 };
  }
}
