import { InternalServiceError, TaskAgent } from '@mini-cloud/shared';
import { Pool } from 'pg';
import { AgentDao } from './agent-dao';
import { toAgentStatus } from './row-parsers';

interface AgentRow {
  readonly agent_id: string;
  readonly name: string;
  readonly status: string;
  readonly last_seen_at: Date | null;
  readonly registered_at: Date;
}

function toAgent(row: AgentRow): TaskAgent {
  return {
    agentId: row.agent_id,
    name: row.name,
    status: toAgentStatus(row.status, row.agent_id),
    lastSeenAt: row.last_seen_at === null ? undefined : row.last_seen_at.getTime(),
    registeredAt: row.registered_at.getTime(),
  };
}

const SELECT_COLUMNS = 'agent_id, name, status, last_seen_at, registered_at';

export class PgAgentDao implements AgentDao {
  constructor(private readonly pool: Pool) {}

  async recordHeartbeat(agentId: string, name: string): Promise<TaskAgent> {
    const result = await this.pool.query<AgentRow>(
      `INSERT INTO agent (agent_id, name, status, last_seen_at) VALUES ($1, $2, 'online', now())
       ON CONFLICT (agent_id) DO UPDATE SET name = EXCLUDED.name, status = 'online', last_seen_at = now()
       RETURNING ${SELECT_COLUMNS}`,
      [agentId, name],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new InternalServiceError(`Heartbeat upsert for agent ${agentId} returned no row.`);
    }
    return toAgent(row);
  }

  async getAgent(agentId: string): Promise<TaskAgent | null> {
    const result = await this.pool.query<AgentRow>(`SELECT ${SELECT_COLUMNS} FROM agent WHERE agent_id = $1`, [agentId]);
    const row = result.rows[0];
    return row === undefined ? null : toAgent(row);
  }

  async listAgents(): Promise<ReadonlyArray<TaskAgent>> {
    const result = await this.pool.query<AgentRow>(`SELECT ${SELECT_COLUMNS} FROM agent ORDER BY name ASC`);
    return result.rows.map(toAgent);
  }

  async setStatus(agentId: string, status: 'online' | 'offline'): Promise<void> {
    await this.pool.query('UPDATE agent SET status = $2 WHERE agent_id = $1', [agentId, status]);
  }

  async expireAgents(before: number): Promise<ReadonlyArray<TaskAgent>> {
    const result = await this.pool.query<AgentRow>(
      `UPDATE agent SET status = 'offline'
       WHERE status = 'online' AND (last_seen_at IS NULL OR last_seen_at < $1)
       RETURNING ${SELECT_COLUMNS}`,
      [new Date(before)],
    );
    return result.rows.map(toAgent);
  }
}
