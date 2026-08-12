import { InternalServiceError, TaskDynamics } from '@mini-cloud/shared';
import { Pool } from 'pg';
import { TaskDynamicsDao } from './task-dynamics-dao';

interface DynamicsRow {
  readonly task_id: string;
  readonly active: boolean;
  readonly target_agent_ids: string[];
}

function toDynamics(row: DynamicsRow): TaskDynamics {
  return { taskId: row.task_id, active: row.active, targetAgentIds: row.target_agent_ids };
}

export class PgTaskDynamicsDao implements TaskDynamicsDao {
  constructor(private readonly pool: Pool) {}

  async getDynamics(taskId: string): Promise<TaskDynamics | null> {
    const result = await this.pool.query<DynamicsRow>('SELECT task_id, active, target_agent_ids FROM task_dynamics WHERE task_id = $1', [taskId]);
    const row = result.rows[0];
    return row === undefined ? null : toDynamics(row);
  }

  async setActive(taskId: string, active: boolean): Promise<TaskDynamics> {
    const result = await this.pool.query<DynamicsRow>(
      `INSERT INTO task_dynamics (task_id, active) VALUES ($1, $2)
       ON CONFLICT (task_id) DO UPDATE SET active = EXCLUDED.active, updated_at = now()
       RETURNING task_id, active, target_agent_ids`,
      [taskId, active],
    );
    return this.expectRow(result.rows[0], taskId);
  }

  async setTargetAgents(taskId: string, targetAgentIds: ReadonlyArray<string>): Promise<TaskDynamics> {
    const result = await this.pool.query<DynamicsRow>(
      `INSERT INTO task_dynamics (task_id, target_agent_ids) VALUES ($1, $2)
       ON CONFLICT (task_id) DO UPDATE SET target_agent_ids = EXCLUDED.target_agent_ids, updated_at = now()
       RETURNING task_id, active, target_agent_ids`,
      [taskId, [...targetAgentIds]],
    );
    return this.expectRow(result.rows[0], taskId);
  }

  private expectRow(row: DynamicsRow | undefined, taskId: string): TaskDynamics {
    if (row === undefined) {
      throw new InternalServiceError(`Upserting dynamics for task ${taskId} returned no row.`);
    }
    return toDynamics(row);
  }
}
