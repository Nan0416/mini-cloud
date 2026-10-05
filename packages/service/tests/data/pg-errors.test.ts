import { FOREIGN_KEY_VIOLATION, isPgError } from '../../src/data/pg-errors';

describe('isPgError', () => {
  const violation = Object.assign(new Error('violates foreign key constraint'), { code: '23503', constraint: 'monitor_notifier_notifier_id_fkey' });

  it('matches on the SQLSTATE, and on the constraint when one is named', () => {
    expect(isPgError(violation, FOREIGN_KEY_VIOLATION)).toBe(true);
    expect(isPgError(violation, FOREIGN_KEY_VIOLATION, 'monitor_notifier_notifier_id_fkey')).toBe(true);
    expect(isPgError(violation, FOREIGN_KEY_VIOLATION, 'monitor_notifier_monitor_name_fkey')).toBe(false);
    expect(isPgError(violation, '23505')).toBe(false);
  });

  it('is false for anything that is not an error from the database', () => {
    expect(isPgError(new Error('connection reset'), FOREIGN_KEY_VIOLATION)).toBe(false);
    expect(isPgError(undefined, FOREIGN_KEY_VIOLATION)).toBe(false);
    expect(isPgError('23503', FOREIGN_KEY_VIOLATION)).toBe(false);
  });
});
