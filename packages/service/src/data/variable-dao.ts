import { ReplacementVariables } from '@mini-cloud/shared';

export interface VariableDao {
  listVariables(): Promise<ReplacementVariables>;

  /** Replaces the whole set, so removing a key from the input deletes it. */
  replaceVariables(variables: ReplacementVariables): Promise<ReplacementVariables>;
}
