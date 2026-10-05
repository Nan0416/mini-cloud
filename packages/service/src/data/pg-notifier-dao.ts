import { InternalServiceError, Notifier, NotifierTarget } from '@mini-cloud/shared';
import { Pool } from 'pg';
import {
  CreateNotifierInput,
  CreateNotifierOutput,
  DeleteNotifierInput,
  DeleteNotifierOutput,
  GetNotifierInput,
  GetNotifierOutput,
  ListDeliveryTargetsInput,
  ListDeliveryTargetsOutput,
  ListNotifiersInput,
  ListNotifiersOutput,
  NotifierCredentials,
  NotifierDao,
  UpdateNotifierInput,
  UpdateNotifierOutput,
} from './notifier-dao';
import { RESTRICT_VIOLATION, UNIQUE_VIOLATION, isPgError } from './pg-errors';
import { toNotifierType } from './row-parsers';

interface NotifierRow {
  readonly notifier_id: string;
  readonly name: string;
  readonly description: string | null;
  readonly type: string;
  readonly settings: Record<string, unknown>;
  readonly version: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface DeliveryTargetRow extends NotifierRow {
  readonly secrets: Record<string, unknown>;
}

// Every read but the delivery one names its columns, so `secrets` is never fetched by accident.
const NOTIFIER_COLUMNS = 'notifier_id, name, description, type, settings, version, created_at, updated_at';

function stringField(record: Record<string, unknown>, key: string, column: string, notifierId: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new InternalServiceError(`Notifier ${notifierId} has no ${column}.${key}.`);
  }
  return value;
}

function toTarget(row: NotifierRow): NotifierTarget {
  const type = toNotifierType(row.type, row.notifier_id);
  switch (type) {
    case 'discord':
      return {
        type,
        channel: stringField(row.settings, 'channel', 'settings', row.notifier_id),
        webhookId: stringField(row.settings, 'webhookId', 'settings', row.notifier_id),
      };
  }
}

function toNotifier(row: NotifierRow): Notifier {
  return {
    notifierId: row.notifier_id,
    name: row.name,
    description: row.description ?? undefined,
    target: toTarget(row),
    version: row.version,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  };
}

function toCredentials(row: DeliveryTargetRow): NotifierCredentials {
  const type = toNotifierType(row.type, row.notifier_id);
  switch (type) {
    case 'discord':
      return { type, webhookUrl: stringField(row.secrets, 'webhookUrl', 'secrets', row.notifier_id) };
  }
}

// Without the type, which has a column of its own.
function settingsOf(target: NotifierTarget): string {
  switch (target.type) {
    case 'discord':
      return JSON.stringify({ channel: target.channel, webhookId: target.webhookId });
  }
}

function secretsOf(credentials: NotifierCredentials): string {
  switch (credentials.type) {
    case 'discord':
      return JSON.stringify({ webhookUrl: credentials.webhookUrl });
  }
}

export class PgNotifierDao implements NotifierDao {
  constructor(private readonly pool: Pool) {}

  async listNotifiers(_input: ListNotifiersInput): Promise<ListNotifiersOutput> {
    const result = await this.pool.query<NotifierRow>(`SELECT ${NOTIFIER_COLUMNS} FROM notifier ORDER BY name ASC`);
    return { notifiers: result.rows.map(toNotifier) };
  }

  async getNotifier(input: GetNotifierInput): Promise<GetNotifierOutput> {
    const result = await this.pool.query<NotifierRow>(`SELECT ${NOTIFIER_COLUMNS} FROM notifier WHERE notifier_id = $1`, [input.notifierId]);
    const row = result.rows[0];
    return { notifier: row === undefined ? undefined : toNotifier(row) };
  }

  async createNotifier(input: CreateNotifierInput): Promise<CreateNotifierOutput> {
    // DO NOTHING rather than a read first, so two creates of one name cannot both succeed.
    const result = await this.pool.query<NotifierRow>(
      `INSERT INTO notifier (notifier_id, name, description, type, settings, secrets)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
       ON CONFLICT (name) DO NOTHING
       RETURNING ${NOTIFIER_COLUMNS}`,
      [input.notifierId, input.name, input.description ?? null, input.target.type, settingsOf(input.target), secretsOf(input.credentials)],
    );
    const row = result.rows[0];
    return { notifier: row === undefined ? undefined : toNotifier(row) };
  }

  async updateNotifier(input: UpdateNotifierInput): Promise<UpdateNotifierOutput> {
    // The name check is in the statement, so a rename onto a taken name writes nothing
    // instead of failing on the unique constraint. Two renames racing onto one name can
    // both pass it, and the loser is reported the same way.
    try {
      const result = await this.pool.query<NotifierRow>(
        `UPDATE notifier
            SET name = $3, description = $4, type = $5, settings = $6::jsonb, secrets = COALESCE($7::jsonb, secrets),
                version = version + 1, updated_at = now()
          WHERE notifier_id = $1 AND version = $2
            AND NOT EXISTS (SELECT 1 FROM notifier other WHERE other.name = $3 AND other.notifier_id <> $1)
          RETURNING ${NOTIFIER_COLUMNS}`,
        [
          input.notifierId,
          input.version,
          input.name,
          input.description ?? null,
          input.target.type,
          settingsOf(input.target),
          input.credentials === undefined ? null : secretsOf(input.credentials),
        ],
      );
      const row = result.rows[0];
      return { notifier: row === undefined ? undefined : toNotifier(row) };
    } catch (err) {
      if (isPgError(err, UNIQUE_VIOLATION, 'notifier_name_key')) {
        return {};
      }
      throw err;
    }
  }

  async deleteNotifier(input: DeleteNotifierInput): Promise<DeleteNotifierOutput> {
    // Guarded in the statement, so a notifier in use is a refusal to report. A monitor
    // linking it while the delete runs gets past the guard to the foreign key instead,
    // and is reported the same way.
    try {
      const result = await this.pool.query('DELETE FROM notifier WHERE notifier_id = $1 AND NOT EXISTS (SELECT 1 FROM monitor_notifier WHERE notifier_id = $1)', [
        input.notifierId,
      ]);
      if ((result.rowCount ?? 0) > 0) {
        return { deleted: true, usedBy: [] };
      }
    } catch (err) {
      if (!isPgError(err, RESTRICT_VIOLATION, 'monitor_notifier_notifier_id_fkey')) {
        throw err;
      }
    }
    const users = await this.pool.query<{ readonly monitor_name: string }>('SELECT monitor_name FROM monitor_notifier WHERE notifier_id = $1 ORDER BY monitor_name', [
      input.notifierId,
    ]);
    return { deleted: false, usedBy: users.rows.map((row) => row.monitor_name) };
  }

  async listDeliveryTargets(input: ListDeliveryTargetsInput): Promise<ListDeliveryTargetsOutput> {
    if (input.notifierIds.length === 0) {
      return { targets: [] };
    }
    const result = await this.pool.query<DeliveryTargetRow>(`SELECT ${NOTIFIER_COLUMNS}, secrets FROM notifier WHERE notifier_id = ANY($1::text[]) ORDER BY name ASC`, [
      [...input.notifierIds],
    ]);
    return { targets: result.rows.map((row) => ({ notifier: toNotifier(row), credentials: toCredentials(row) })) };
  }
}
