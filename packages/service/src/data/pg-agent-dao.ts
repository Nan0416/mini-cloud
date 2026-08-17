import { InternalServiceError, TaskAgent } from '@mini-cloud/shared';
import { Pool } from 'pg';
import {
  AgentDao,
  ExpireAgentsInput,
  ExpireAgentsOutput,
  GetAgentInput,
  GetAgentOutput,
  ListAgentsInput,
  ListAgentsOutput,
  RecordHeartbeatInput,
  RecordHeartbeatOutput,
  SetStatusInput,
  SetStatusOutput,
} from './agent-dao';
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

  async recordHeartbeat(input: RecordHeartbeatInput): Promise<RecordHeartbeatOutput> {
    const result = await this.pool.query<AgentRow>(
      `INSERT INTO agent (agent_id, name, status, last_seen_at) VALUES ($1, $2, 'online', now())
       ON CONFLICT (agent_id) DO UPDATE SET name = EXCLUDED.name, status = 'online', last_seen_at = now()
       RETURNING ${SELECT_COLUMNS}`,
      [input.agentId, input.name],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new InternalServiceError(`Heartbeat upsert for agent ${input.agentId} returned no row.`);
    }
    return { agent: toAgent(row) };
  }

  async getAgent(input: GetAgentInput): Promise<GetAgentOutput> {
    const result = await this.pool.query<AgentRow>(`SELECT ${SELECT_COLUMNS} FROM agent WHERE agent_id = $1`, [input.agentId]);
    const row = result.rows[0];
    return { agent: row === undefined ? null : toAgent(row) };
  }

  async listAgents(_input: ListAgentsInput): Promise<ListAgentsOutput> {
    const result = await this.pool.query<AgentRow>(`SELECT ${SELECT_COLUMNS} FROM agent ORDER BY name ASC`);
    return { agents: result.rows.map(toAgent) };
  }

  async setStatus(input: SetStatusInput): Promise<SetStatusOutput> {
    await this.pool.query('UPDATE agent SET status = $2 WHERE agent_id = $1', [input.agentId, input.status]);
    return {};
  }

  async expireAgents(input: ExpireAgentsInput): Promise<ExpireAgentsOutput> {
    const result = await this.pool.query<AgentRow>(
      `UPDATE agent SET status = 'offline'
       WHERE status = 'online' AND (last_seen_at IS NULL OR last_seen_at < $1)
       RETURNING ${SELECT_COLUMNS}`,
      [new Date(input.before)],
    );
    return { agents: result.rows.map(toAgent) };
  }
}
