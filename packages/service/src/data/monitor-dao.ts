import { EvaluatedDatapoint, Monitor, MonitorDefinition, MonitorState, MonitorStateChange } from '@mini-cloud/shared';

export interface ListMonitorsInput {}

export interface ListMonitorsOutput {
  readonly monitors: ReadonlyArray<Monitor>;
}

export interface GetMonitorInput {
  readonly name: string;
}

export interface GetMonitorOutput {
  readonly monitor?: Monitor;
}

export interface CreateMonitorInput extends MonitorDefinition {
  readonly name: string;
  /** Why a new monitor is in `INSUFFICIENT_DATA`. */
  readonly stateReason: string;
}

export interface CreateMonitorOutput {
  /** Absent when the name was already taken or a notifier was missing, and nothing was written. */
  readonly monitor?: Monitor;
  /** A notifier it names did not exist by the time it was linked, and nothing was written. */
  readonly notifierMissing?: boolean;
}

export interface UpdateMonitorInput extends MonitorDefinition {
  readonly name: string;
  /** Written only if this is still the stored version. */
  readonly version: number;
}

export interface UpdateMonitorOutput {
  /** Absent when no monitor of that name holds that version or a notifier was missing, and nothing was written. */
  readonly monitor?: Monitor;
  /** A notifier it names did not exist by the time it was linked, and nothing was written. */
  readonly notifierMissing?: boolean;
}

export interface DeleteMonitorInput {
  readonly name: string;
}

export interface DeleteMonitorOutput {
  readonly deleted: boolean;
}

export interface MarkEvaluatedInput {
  readonly name: string;
  readonly evaluatedAt: number;
}

export interface MarkEvaluatedOutput {}

export interface ChangeStateInput {
  readonly name: string;
  /** Written only if the monitor is still in this state. */
  readonly fromState: MonitorState;
  /** And only if its definition is still the one it was judged against. */
  readonly version: number;
  readonly toState: MonitorState;
  readonly reason: string;
  readonly datapoints: ReadonlyArray<EvaluatedDatapoint>;
  readonly threshold: number;
  readonly changedAt: number;
}

export interface ChangeStateOutput {
  /** Absent when the monitor was gone or no longer in `fromState`, and nothing was written. */
  readonly change?: MonitorStateChange;
}

export interface ListStateChangesInput {
  readonly name: string;
  readonly limit: number;
}

export interface ListStateChangesOutput {
  /** Newest first. */
  readonly changes: ReadonlyArray<MonitorStateChange>;
}

export interface MonitorDao {
  listMonitors(input: ListMonitorsInput): Promise<ListMonitorsOutput>;
  getMonitor(input: GetMonitorInput): Promise<GetMonitorOutput>;
  createMonitor(input: CreateMonitorInput): Promise<CreateMonitorOutput>;
  updateMonitor(input: UpdateMonitorInput): Promise<UpdateMonitorOutput>;
  deleteMonitor(input: DeleteMonitorInput): Promise<DeleteMonitorOutput>;

  /** Records an evaluation that left the state as it was. */
  markEvaluated(input: MarkEvaluatedInput): Promise<MarkEvaluatedOutput>;

  /** Moves the monitor to a new state and records the change, as one transaction. */
  changeState(input: ChangeStateInput): Promise<ChangeStateOutput>;

  listStateChanges(input: ListStateChangesInput): Promise<ListStateChangesOutput>;
}
