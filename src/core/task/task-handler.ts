import { TaskClientForAgent, TaskClient } from '@ultrasa/mini-cloud-models';

export interface TaskHandler extends TaskClient, TaskClientForAgent {
  init(): Promise<void>;

  terminate(): Promise<void>;
}
