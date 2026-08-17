import { AgentStatus, TaskAgent } from '@mini-cloud/shared';

export interface RecordHeartbeatInput {
  readonly agentId: string;
  readonly name: string;
}

export interface RecordHeartbeatOutput {
  readonly agent: TaskAgent;
}

export interface GetAgentInput {
  readonly agentId: string;
}

export interface GetAgentOutput {
  readonly agent: TaskAgent | null;
}

export interface ListAgentsInput {}

export interface ListAgentsOutput {
  readonly agents: ReadonlyArray<TaskAgent>;
}

export interface SetStatusInput {
  readonly agentId: string;
  readonly status: AgentStatus;
}

export interface SetStatusOutput {}

export interface ExpireAgentsInput {
  /** Epoch ms; agents unseen since before this are expired. */
  readonly before: number;
}

export interface ExpireAgentsOutput {
  /** Only the agents this call actually moved to offline. */
  readonly agents: ReadonlyArray<TaskAgent>;
}

export interface AgentDao {
  /** Registers the agent if new, otherwise marks it online and stamps `last_seen_at`. */
  recordHeartbeat(input: RecordHeartbeatInput): Promise<RecordHeartbeatOutput>;

  getAgent(input: GetAgentInput): Promise<GetAgentOutput>;

  listAgents(input: ListAgentsInput): Promise<ListAgentsOutput>;

  setStatus(input: SetStatusInput): Promise<SetStatusOutput>;

  /** Marks online agents unseen since `before` as offline. Returns the ones it changed. */
  expireAgents(input: ExpireAgentsInput): Promise<ExpireAgentsOutput>;
}
