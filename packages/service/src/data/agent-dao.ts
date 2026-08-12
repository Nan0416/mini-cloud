import { TaskAgent } from '@mini-cloud/shared';

export interface AgentDao {
  /** Registers the agent if new, otherwise marks it online and stamps `last_seen_at`. */
  recordHeartbeat(agentId: string, name: string): Promise<TaskAgent>;

  getAgent(agentId: string): Promise<TaskAgent | null>;

  listAgents(): Promise<ReadonlyArray<TaskAgent>>;

  setStatus(agentId: string, status: 'online' | 'offline'): Promise<void>;

  /** Marks online agents unseen since `before` as offline. Returns the ones it changed. */
  expireAgents(before: number): Promise<ReadonlyArray<TaskAgent>>;
}
