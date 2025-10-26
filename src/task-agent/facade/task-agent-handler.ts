import { TaskReporterClient } from '../../models';
import { TaskAgentClient } from '../../models/clients/task-agent-client';

/**
 * Implemented by task agent, and run in task agent.
 *
 * The handler receives
 * * requests from local task instances.
 * * requests from remote task service through websocket
 */
export interface TaskAgentHandler extends TaskAgentClient, TaskReporterClient {
  init(): Promise<void>;

  terminate(): Promise<void>;
}
