import { TaskEvent, TaskEventLevel, TaskEventSource } from '@mini-cloud/shared';

export interface CreateEventInput {
  readonly eventId: string;
  readonly instanceId: string;
  readonly source: TaskEventSource;
  readonly level: TaskEventLevel;
  /** Stored as JSONB; may be a string, an object, or any JSON value. */
  readonly payload: unknown;
  readonly timestamp: number;
}

export interface CreateEventOutput {}

export interface ListEventsInput {
  readonly instanceId: string;
  readonly limit: number;
}

export interface ListEventsOutput {
  readonly events: ReadonlyArray<TaskEvent>;
}

export interface TaskEventDao {
  createEvent(input: CreateEventInput): Promise<CreateEventOutput>;

  listEvents(input: ListEventsInput): Promise<ListEventsOutput>;
}
