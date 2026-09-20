import { MetricDimensions } from '../models/metric';

/**
 * The canonical form of a dimension set, used as the key that identifies a series.
 *
 * This string is stored in the database, so its encoding is a storage format rather
 * than an implementation detail: changing it is a migration.
 */

/** What an empty dimension set hashes to. A set with no dimensions is still a series. */
export const EMPTY_DIMENSIONS_HASH = '_none';

/**
 * Sorts by code point rather than `localeCompare`, which is locale-sensitive: two
 * machines with different locales would otherwise order the same set differently and
 * produce two keys for one series.
 */
function compareCodePoints(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * `encodeURIComponent(name)/encodeURIComponent(value)` pairs joined by `;`, sorted by
 * name. Both delimiters are percent-escaped by the encoder, so the result parses back
 * unambiguously whatever the values contain.
 */
export function hashDimensions(dimensions: MetricDimensions): string {
  const names = Object.keys(dimensions).sort(compareCodePoints);
  if (names.length === 0) {
    return EMPTY_DIMENSIONS_HASH;
  }
  return names.map((name) => `${encodeURIComponent(name)}/${encodeURIComponent(dimensions[name])}`).join(';');
}

export function parseDimensionsHash(hash: string): MetricDimensions {
  if (hash === EMPTY_DIMENSIONS_HASH || hash.length === 0) {
    return {};
  }
  const dimensions: Record<string, string> = {};
  for (const pair of hash.split(';')) {
    const separator = pair.indexOf('/');
    if (separator === -1) {
      continue;
    }
    dimensions[decodeURIComponent(pair.slice(0, separator))] = decodeURIComponent(pair.slice(separator + 1));
  }
  return dimensions;
}

/** Whether two sets name the same dimensions with the same values. */
export function sameDimensions(left: MetricDimensions, right: MetricDimensions): boolean {
  return hashDimensions(left) === hashDimensions(right);
}
