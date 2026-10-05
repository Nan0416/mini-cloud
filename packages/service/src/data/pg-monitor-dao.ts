import { EvaluatedDatapoint, Monitor, MonitorStateChange } from '@mini-cloud/shared';
import { Pool, PoolClient } from 'pg';
import {
  ChangeStateInput,
  ChangeStateOutput,
  CreateMonitorInput,
  CreateMonitorOutput,
  DeleteMonitorInput,
  DeleteMonitorOutput,
  GetMonitorInput,
  GetMonitorOutput,
  ListMonitorsInput,
  ListMonitorsOutput,
  ListStateChangesInput,
  ListStateChangesOutput,
  MarkEvaluatedInput,
  MarkEvaluatedOutput,
  MonitorDao,
  UpdateMonitorInput,
  UpdateMonitorOutput,
} from './monitor-dao';
import { FOREIGN_KEY_VIOLATION, isPgError } from './pg-errors';
import { toMetricStatistic, toMonitorComparison, toMonitorSeverity, toMonitorState, toTreatMissingData } from './row-parsers';

interface MonitorRow {
  readonly name: string;
  readonly description: string | null;
  readonly namespace: string;
  readonly metric_name: string;
  readonly dimensions: Record<string, string>;
  readonly statistic: string;
  // BIGINT, which node-postgres returns as a string so as not to lose precision.
  readonly period_ms: string;
  readonly evaluation_periods: number;
  readonly datapoints_to_alarm: number;
  readonly comparison: string;
  readonly threshold: number;
  readonly treat_missing_data: string;
  readonly severity: number;
  readonly notify: boolean;
  readonly state: string;
  readonly state_reason: string;
  readonly state_changed_at: Date;
  readonly last_evaluated_at: Date | null;
  readonly version: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** A monitor read together with the notifiers it sends to. */
interface MonitorWithNotifiersRow extends MonitorRow {
  readonly notifier_ids: ReadonlyArray<string>;
}

interface StateChangeRow {
  readonly monitor_name: string;
  readonly from_state: string;
  readonly to_state: string;
  readonly reason: string;
  readonly datapoints: ReadonlyArray<EvaluatedDatapoint>;
  readonly threshold: number;
  readonly changed_at: Date;
}

function toMonitor(row: MonitorRow, notifierIds: ReadonlyArray<string>): Monitor {
  return {
    name: row.name,
    description: row.description ?? undefined,
    metric: { namespace: row.namespace, metricName: row.metric_name, dimensions: row.dimensions, statistic: toMetricStatistic(row.statistic, row.name) },
    periodMs: Number(row.period_ms),
    evaluationPeriods: row.evaluation_periods,
    datapointsToAlarm: row.datapoints_to_alarm,
    comparison: toMonitorComparison(row.comparison, row.name),
    threshold: row.threshold,
    treatMissingData: toTreatMissingData(row.treat_missing_data, row.name),
    severity: toMonitorSeverity(row.severity, row.name),
    notify: row.notify,
    notifierIds,
    state: toMonitorState(row.state, row.name),
    stateReason: row.state_reason,
    stateChangedAt: row.state_changed_at.getTime(),
    lastEvaluatedAt: row.last_evaluated_at === null ? undefined : row.last_evaluated_at.getTime(),
    version: row.version,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  };
}

function toStateChange(row: StateChangeRow): MonitorStateChange {
  return {
    monitorName: row.monitor_name,
    fromState: toMonitorState(row.from_state, row.monitor_name),
    toState: toMonitorState(row.to_state, row.monitor_name),
    reason: row.reason,
    datapoints: row.datapoints,
    threshold: row.threshold,
    changedAt: row.changed_at.getTime(),
  };
}

function definitionValues(input: UpdateMonitorInput | CreateMonitorInput): ReadonlyArray<unknown> {
  return [
    input.description ?? null,
    input.metric.namespace,
    input.metric.metricName,
    JSON.stringify(input.metric.dimensions),
    input.metric.statistic,
    input.periodMs,
    input.evaluationPeriods,
    input.datapointsToAlarm,
    input.comparison,
    input.threshold,
    input.treatMissingData,
    input.severity,
    input.notify,
  ];
}

// The notifiers ride along as an array, so a monitor is still one row and one query.
const SELECT_MONITORS = `
  SELECT m.*, COALESCE(ARRAY_AGG(mn.notifier_id ORDER BY mn.notifier_id) FILTER (WHERE mn.notifier_id IS NOT NULL), '{}') AS notifier_ids
    FROM monitor m
    LEFT JOIN monitor_notifier mn ON mn.monitor_name = m.name`;

/** Sorted as the read sorts them, so a monitor just written equals the same monitor read back. */
function sortedIds(ids: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...ids].sort();
}

export class PgMonitorDao implements MonitorDao {
  constructor(private readonly pool: Pool) {}

  async listMonitors(_input: ListMonitorsInput): Promise<ListMonitorsOutput> {
    const result = await this.pool.query<MonitorWithNotifiersRow>(`${SELECT_MONITORS} GROUP BY m.name ORDER BY m.name ASC`);
    return { monitors: result.rows.map((row) => toMonitor(row, row.notifier_ids)) };
  }

  async getMonitor(input: GetMonitorInput): Promise<GetMonitorOutput> {
    const result = await this.pool.query<MonitorWithNotifiersRow>(`${SELECT_MONITORS} WHERE m.name = $1 GROUP BY m.name`, [input.name]);
    const row = result.rows[0];
    return { monitor: row === undefined ? undefined : toMonitor(row, row.notifier_ids) };
  }

  async createMonitor(input: CreateMonitorInput): Promise<CreateMonitorOutput> {
    return this.refusingMissingNotifiers(async (client) => {
      // DO NOTHING rather than a read first, so two creates of one name cannot both succeed.
      const result = await client.query<MonitorRow>(
        `INSERT INTO monitor (name, description, namespace, metric_name, dimensions, statistic, period_ms, evaluation_periods, datapoints_to_alarm, comparison, threshold, treat_missing_data, severity, notify, state_reason)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (name) DO NOTHING
         RETURNING *`,
        [input.name, ...definitionValues(input), input.stateReason],
      );
      const row = result.rows[0];
      if (row === undefined) {
        return {};
      }
      await this.linkNotifiers(client, input.name, input.notifierIds);
      return { monitor: toMonitor(row, sortedIds(input.notifierIds)) };
    });
  }

  async updateMonitor(input: UpdateMonitorInput): Promise<UpdateMonitorOutput> {
    return this.refusingMissingNotifiers(async (client) => {
      const result = await client.query<MonitorRow>(
        `UPDATE monitor
            SET description = $3, namespace = $4, metric_name = $5, dimensions = $6::jsonb, statistic = $7, period_ms = $8, evaluation_periods = $9,
                datapoints_to_alarm = $10, comparison = $11, threshold = $12, treat_missing_data = $13, severity = $14, notify = $15,
                version = version + 1, updated_at = now()
          WHERE name = $1 AND version = $2
          RETURNING *`,
        [input.name, input.version, ...definitionValues(input)],
      );
      const row = result.rows[0];
      if (row === undefined) {
        return {};
      }
      await client.query('DELETE FROM monitor_notifier WHERE monitor_name = $1', [input.name]);
      await this.linkNotifiers(client, input.name, input.notifierIds);
      return { monitor: toMonitor(row, sortedIds(input.notifierIds)) };
    });
  }

  async deleteMonitor(input: DeleteMonitorInput): Promise<DeleteMonitorOutput> {
    const result = await this.pool.query('DELETE FROM monitor WHERE name = $1', [input.name]);
    return { deleted: (result.rowCount ?? 0) > 0 };
  }

  async markEvaluated(input: MarkEvaluatedInput): Promise<MarkEvaluatedOutput> {
    await this.pool.query('UPDATE monitor SET last_evaluated_at = $2 WHERE name = $1', [input.name, new Date(input.evaluatedAt)]);
    return {};
  }

  async changeState(input: ChangeStateInput): Promise<ChangeStateOutput> {
    const changedAt = new Date(input.changedAt);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Guarded on the state and the definition it was judged against, so an evaluation
      // that raced an edit, a delete or another evaluation records nothing rather than a
      // change judged against settings that are no longer the monitor's.
      const moved = await client.query(
        `UPDATE monitor SET state = $3, state_reason = $4, state_changed_at = $5, last_evaluated_at = $5
          WHERE name = $1 AND state = $2 AND version = $6`,
        [input.name, input.fromState, input.toState, input.reason, changedAt, input.version],
      );
      if ((moved.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return {};
      }
      const inserted = await client.query<StateChangeRow>(
        `INSERT INTO monitor_state_change (monitor_name, from_state, to_state, reason, datapoints, threshold, changed_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         RETURNING *`,
        [input.name, input.fromState, input.toState, input.reason, JSON.stringify(input.datapoints), input.threshold, changedAt],
      );
      await client.query('COMMIT');
      const row = inserted.rows[0];
      return { change: row === undefined ? undefined : toStateChange(row) };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async listStateChanges(input: ListStateChangesInput): Promise<ListStateChangesOutput> {
    const result = await this.pool.query<StateChangeRow>('SELECT * FROM monitor_state_change WHERE monitor_name = $1 ORDER BY changed_at DESC, change_id DESC LIMIT $2', [
      input.name,
      input.limit,
    ]);
    return { changes: result.rows.map(toStateChange) };
  }

  private async linkNotifiers(client: PoolClient, monitorName: string, notifierIds: ReadonlyArray<string>): Promise<void> {
    if (notifierIds.length === 0) {
      return;
    }
    await client.query('INSERT INTO monitor_notifier (monitor_name, notifier_id) SELECT $1, UNNEST($2::text[])', [monitorName, [...notifierIds]]);
  }

  /**
   * A monitor save, in a transaction, with a notifier deleted since the caller checked it
   * reported as such rather than thrown. The foreign key is what catches it; the check
   * before the transaction cannot.
   */
  private async refusingMissingNotifiers<T extends object>(work: (client: PoolClient) => Promise<T>): Promise<T | { readonly notifierMissing: true }> {
    try {
      return await this.inTransaction(work);
    } catch (err) {
      if (isPgError(err, FOREIGN_KEY_VIOLATION, 'monitor_notifier_notifier_id_fkey')) {
        return { notifierMissing: true };
      }
      throw err;
    }
  }

  private async inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
