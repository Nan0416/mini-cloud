import { ReplacementVariables } from '@mini-cloud/shared';

export interface ListVariablesInput {}

export interface ListVariablesOutput {
  readonly variables: ReplacementVariables;
}

export interface ReplaceVariablesInput {
  readonly variables: ReplacementVariables;
}

export interface ReplaceVariablesOutput {
  /** The stored set after the replacement. */
  readonly variables: ReplacementVariables;
}

export interface VariableDao {
  listVariables(input: ListVariablesInput): Promise<ListVariablesOutput>;

  /** Replaces the whole set, so removing a key from the input deletes it. */
  replaceVariables(input: ReplaceVariablesInput): Promise<ReplaceVariablesOutput>;
}
