export const UNIQUE_VIOLATION = '23505';
export const FOREIGN_KEY_VIOLATION = '23503';
/** What an `ON DELETE RESTRICT` key raises, rather than a foreign key violation. */
export const RESTRICT_VIOLATION = '23001';

/**
 * Whether PostgreSQL refused a statement with this SQLSTATE, and, when one is named, on
 * this constraint. Checked by shape, since pg's error class is not exported for `instanceof`.
 */
export function isPgError(err: unknown, code: string, constraint?: string): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err) || err.code !== code) {
    return false;
  }
  return constraint === undefined || ('constraint' in err && err.constraint === constraint);
}
