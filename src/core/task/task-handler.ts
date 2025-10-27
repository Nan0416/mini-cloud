import { TaskClientForAgent, TaskClient } from '../../models';

export interface TaskHandler extends TaskClient, TaskClientForAgent {
  init(): Promise<void>;

  terminate(): Promise<void>;
}
