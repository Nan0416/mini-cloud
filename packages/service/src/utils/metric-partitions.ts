import { MetricResolution } from '@mini-cloud/shared';

/**
 * Names and bounds for the leaf partitions of `metric_datum`.
 *
 * Pure and separate from the manager that issues the DDL, so the arithmetic that
 * decides where a row lands — and, more sharply, which partitions retention is about
 * to drop — can be tested without a database.
 */

/** How wide a leaf partition is, per resolution. */
export type PartitionWidth = 'day' | 'month' | 'year';

export const PARTITION_WIDTH: Readonly<Record<MetricResolution, PartitionWidth>> = {
  // Four weeks of minutes is twenty-eight partitions; a day of them is a manageable
  // size to drop in one statement.
  '1m': 'day',
  '1h': 'month',
  '1d': 'year',
};

/** The parent each resolution's leaves hang from. */
export function parentTable(resolution: MetricResolution): string {
  return `metric_datum_${resolution}`;
}

export interface PartitionBounds {
  /** Inclusive lower bound, in milliseconds since the epoch. */
  readonly from: number;
  /** Exclusive upper bound. */
  readonly to: number;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/**
 * The half-open range of the leaf that holds this timestamp.
 *
 * Everything is UTC. A partition boundary that moved with the machine's timezone
 * would put the same instant in different partitions on different hosts.
 */
export function leafBounds(timestamp: number, width: PartitionWidth): PartitionBounds {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();

  if (width === 'year') {
    return { from: Date.UTC(year, 0, 1), to: Date.UTC(year + 1, 0, 1) };
  }
  if (width === 'month') {
    const month = date.getUTCMonth();
    return { from: Date.UTC(year, month, 1), to: Date.UTC(year, month + 1, 1) };
  }
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  return { from: Date.UTC(year, month, day), to: Date.UTC(year, month, day + 1) };
}

/** The leaf table that holds this timestamp, for example `metric_datum_1m_20260919`. */
export function leafName(resolution: MetricResolution, timestamp: number): string {
  const width = PARTITION_WIDTH[resolution];
  const date = new Date(leafBounds(timestamp, width).from);
  const year = pad(date.getUTCFullYear(), 4);

  if (width === 'year') {
    return `${parentTable(resolution)}_${year}`;
  }
  const month = pad(date.getUTCMonth() + 1, 2);
  if (width === 'month') {
    return `${parentTable(resolution)}_${year}${month}`;
  }
  return `${parentTable(resolution)}_${year}${month}${pad(date.getUTCDate(), 2)}`;
}

/** Postgres wants a timestamp literal for a partition bound. */
export function boundLiteral(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

/**
 * Whether a leaf holds nothing newer than `cutoff`, and so can be dropped whole.
 *
 * The upper bound is exclusive, so a partition is only expired once the cutoff has
 * passed its end — never while it still holds a row inside the retention window.
 */
export function isExpired(bounds: PartitionBounds, cutoff: number): boolean {
  return bounds.to <= cutoff;
}

/** Reads the bounds back out of a leaf's name, for deciding what to drop. */
export function parseLeafName(resolution: MetricResolution, name: string): PartitionBounds | undefined {
  const prefix = `${parentTable(resolution)}_`;
  if (!name.startsWith(prefix)) {
    return undefined;
  }
  const stamp = name.slice(prefix.length);
  const width = PARTITION_WIDTH[resolution];
  const expectedLength = width === 'year' ? 4 : width === 'month' ? 6 : 8;
  if (stamp.length !== expectedLength || !/^\d+$/.test(stamp)) {
    return undefined;
  }

  const year = Number(stamp.slice(0, 4));
  const month = width === 'year' ? 0 : Number(stamp.slice(4, 6)) - 1;
  const day = width === 'day' ? Number(stamp.slice(6, 8)) : 1;
  return leafBounds(Date.UTC(year, month, day), width);
}
