import { LoggerFactory, TaskEvent } from '@mini-cloud/shared';
import { Pool } from 'pg';
import { toTaskEventLevel, toTaskEventSource } from './row-parsers';
import { CreateEventInput, CreateEventOutput, ListEventsInput, ListEventsOutput, TaskEventDao } from './task-event-dao';

const logger = LoggerFactory.getLogger('PgTaskEventDao');

interface EventRow {
  readonly event_id: string;
  readonly instance_id: string;
  readonly source: string;
  readonly level: string;
  readonly payload: unknown;
  readonly occurred_at: Date;
}

function toEvent(row: EventRow): TaskEvent {
  return {
    eventId: row.event_id,
    instanceId: row.instance_id,
    source: toTaskEventSource(row.source, row.event_id),
    level: toTaskEventLevel(row.level, row.event_id),
    // JSONB comes back parsed: a string payload is a string, an object an object.
    payload: row.payload,
    timestamp: row.occurred_at.getTime(),
  };
}

export class PgTaskEventDao implements TaskEventDao {
  constructor(private readonly pool: Pool) {}

  async createEvent(input: CreateEventInput): Promise<CreateEventOutput> {
    try {
      await this.pool.query('INSERT INTO task_event (event_id, instance_id, source, level, payload, occurred_at) VALUES ($1, $2, $3, $4, $5, $6)', [
        input.eventId,
        input.instanceId,
        input.source,
        input.level,
        JSON.stringify(input.payload ?? null),
        new Date(input.timestamp),
      ]);
    } catch (err) {
      // 23503 = foreign key violation: the instance was pruned by retention while a
      // late event was still in flight. Dropping it is correct; failing the agent's
      // report is not.
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === '23503') {
        logger.warn(`Dropped event for instance ${input.instanceId}: the instance no longer exists.`);
        return {};
      }
      throw err;
    }
    return {};
  }

  async listEvents(input: ListEventsInput): Promise<ListEventsOutput> {
    const result = await this.pool.query<EventRow>(
      'SELECT event_id, instance_id, source, level, payload, occurred_at FROM task_event WHERE instance_id = $1 ORDER BY occurred_at ASC LIMIT $2',
      [input.instanceId, input.limit],
    );
    return { events: result.rows.map(toEvent) };
  }
}
