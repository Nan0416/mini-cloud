import { TaskEvent, TaskEventLevel, TaskEventSource } from '@mini-cloud/shared';

export interface CreateTaskEventInput {
  readonly eventId: string;
  readonly instanceId: string;
  readonly source: TaskEventSource;
  readonly level: TaskEventLevel;
  /** Stored as JSONB; may be a string, an object, or any JSON value. */
  readonly payload: unknown;
  readonly timestamp: number;
}

export interface TaskEventDao {
  createEvent(input: CreateTaskEventInput): Promise<void>;

  listEvents(instanceId: string, limit: number): Promise<ReadonlyArray<TaskEvent>>;
}
