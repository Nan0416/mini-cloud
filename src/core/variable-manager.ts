import { ReplacementVariables, Task } from '../models';

export interface VariableManager {
  replace(task: Task): Promise<Task>;
  reset(variables: ReplacementVariables): Promise<void>;
  list(): Promise<ReplacementVariables>;
}
