import { ReplacementVariables } from '../../models/models/task-types/common';
import { Task } from '../task';

export interface VariableManager {
  replace(task: Task): Promise<Task>;
  reset(variables: ReplacementVariables): Promise<void>;
  list(): Promise<ReplacementVariables>;
}
