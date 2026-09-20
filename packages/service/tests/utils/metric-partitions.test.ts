import { isExpired, leafBounds, leafName, parentTable, parseLeafName } from '../../src/utils/metric-partitions';

describe('leafName', () => {
  it('names a minute partition after its UTC day', () => {
    expect(leafName('1m', Date.UTC(2026, 8, 19, 14, 30))).toBe('metric_datum_1m_20260919');
  });

  it('names an hour partition after its UTC month', () => {
    expect(leafName('1h', Date.UTC(2026, 8, 19, 14, 30))).toBe('metric_datum_1h_202609');
  });

  it('names a day partition after its UTC year', () => {
    expect(leafName('1d', Date.UTC(2026, 8, 19, 14, 30))).toBe('metric_datum_1d_2026');
  });

  it('puts every instant in a day into the same minute partition', () => {
    const first = leafName('1m', Date.UTC(2026, 8, 19, 0, 0, 0));
    const last = leafName('1m', Date.UTC(2026, 8, 19, 23, 59, 59, 999));

    expect(first).toBe(last);
  });

  it('splits at the UTC boundary rather than the machine timezone', () => {
    // A boundary that moved with the host's timezone would file the same instant in
    // different partitions on different machines.
    expect(leafName('1m', Date.UTC(2026, 8, 19, 23, 59))).not.toBe(leafName('1m', Date.UTC(2026, 8, 20, 0, 1)));
  });

  it('hangs each leaf from the parent for its resolution', () => {
    expect(leafName('1h', Date.UTC(2026, 0, 1))).toContain(parentTable('1h'));
  });
});

describe('leafBounds', () => {
  it('covers exactly one day', () => {
    expect(leafBounds(Date.UTC(2026, 8, 19, 14, 30), 'day')).toEqual({ from: Date.UTC(2026, 8, 19), to: Date.UTC(2026, 8, 20) });
  });

  it('covers a whole month, whatever its length', () => {
    expect(leafBounds(Date.UTC(2026, 1, 14), 'month')).toEqual({ from: Date.UTC(2026, 1, 1), to: Date.UTC(2026, 2, 1) });
  });

  it('rolls a December month bound into the next year', () => {
    expect(leafBounds(Date.UTC(2026, 11, 31), 'month')).toEqual({ from: Date.UTC(2026, 11, 1), to: Date.UTC(2027, 0, 1) });
  });

  it('covers a whole year', () => {
    expect(leafBounds(Date.UTC(2026, 5, 5), 'year')).toEqual({ from: Date.UTC(2026, 0, 1), to: Date.UTC(2027, 0, 1) });
  });
});

describe('parseLeafName', () => {
  it('round trips a name back to the range it covers', () => {
    const timestamp = Date.UTC(2026, 8, 19, 5, 0);

    expect(parseLeafName('1m', leafName('1m', timestamp))).toEqual(leafBounds(timestamp, 'day'));
  });

  it('ignores a table that belongs to another resolution', () => {
    expect(parseLeafName('1m', 'metric_datum_1h_202609')).toBeUndefined();
    expect(parseLeafName('1m', 'task_instance')).toBeUndefined();
  });

  it('ignores a name whose stamp is the wrong shape', () => {
    // Retention drops whatever this returns bounds for, so anything it cannot read
    // with certainty has to come back undefined rather than guessed at.
    expect(parseLeafName('1m', 'metric_datum_1m_2026')).toBeUndefined();
    expect(parseLeafName('1m', 'metric_datum_1m_backup01')).toBeUndefined();
  });
});

describe('isExpired', () => {
  const bounds = leafBounds(Date.UTC(2026, 8, 19), 'day');

  it('keeps a partition while the cutoff is still inside it', () => {
    // Dropping it here would take rows that are still within retention.
    expect(isExpired(bounds, Date.UTC(2026, 8, 19, 12))).toBe(false);
  });

  it('keeps a partition whose last instant is exactly the cutoff', () => {
    expect(isExpired(bounds, Date.UTC(2026, 8, 19, 23, 59, 59, 999))).toBe(false);
  });

  it('drops a partition once the cutoff has reached its exclusive end', () => {
    expect(isExpired(bounds, Date.UTC(2026, 8, 20))).toBe(true);
  });
});
