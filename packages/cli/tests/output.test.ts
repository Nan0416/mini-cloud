import { Column, formatAge, formatDuration, formatTimestamp, printJson, printTable, truncate } from '../src/output';

const T0 = Date.UTC(2026, 5, 1, 12, 0, 0);

describe('printTable', () => {
  let log: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const lines = (): ReadonlyArray<string> => log.mock.calls.map((call) => call[0] as string);

  interface Row {
    readonly id: string;
    readonly name: string;
  }

  const columns: ReadonlyArray<Column<Row>> = [
    { header: 'ID', value: (row) => row.id },
    { header: 'NAME', value: (row) => row.name },
  ];

  it('pads every column to fit its widest cell', () => {
    printTable(
      [
        { id: '1', name: 'short' },
        { id: '1234567890', name: 'longer name' },
      ],
      columns,
      'No rows.',
    );

    expect(lines()).toEqual(['ID          NAME', '----------  -----------', '1           short', '1234567890  longer name']);
  });

  it('widens a column to fit its header when every cell is narrower', () => {
    printTable([{ id: '1', name: 'x' }], columns, 'No rows.');

    expect(lines()[0]).toBe('ID  NAME');
    expect(lines()[2]).toBe('1   x');
  });

  it('leaves the last column unpadded, so a copied line has no trailing spaces', () => {
    printTable(
      [
        { id: '1', name: 'short' },
        { id: '2', name: 'much longer' },
      ],
      columns,
      'No rows.',
    );

    for (const line of lines()) {
      expect(line).toBe(line.trimEnd());
    }
  });

  it('says so rather than printing an empty frame when there is nothing', () => {
    printTable([], columns, 'No tasks yet. Create one with `mini-cloud task create`.');

    // A bare header over no rows reads like a failure; naming the next step does not.
    expect(lines()).toEqual(['No tasks yet. Create one with `mini-cloud task create`.']);
  });

  it('prints a separator rule under the headers', () => {
    printTable([{ id: 'abc', name: 'x' }], columns, 'No rows.');

    expect(lines()[1]).toMatch(/^-+ {2}-+$/);
  });
});

describe('printJson', () => {
  it('indents, because the output is read by a person as often as piped', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    printJson({ taskId: 't1', version: 2 });

    expect(log).toHaveBeenCalledWith('{\n  "taskId": "t1",\n  "version": 2\n}');
    log.mockRestore();
  });
});

describe('formatTimestamp', () => {
  it('prints a sortable date and time, without the T and the milliseconds', () => {
    // Column output is scanned by eye and sorted by `sort`; ISO minus the noise does
    // both, where a locale format does neither.
    expect(formatTimestamp(T0)).toBe('2026-06-01 12:00:00');
  });

  it('prints a dash for a time that does not exist', () => {
    // An agent that has never checked in has no last-seen time, and `Invalid Date`
    // in a column is worse than an obvious gap.
    expect(formatTimestamp(undefined)).toBe('-');
  });
});

describe('formatAge', () => {
  it('counts seconds for the first minute', () => {
    expect(formatAge(T0 - 0, T0)).toBe('0s ago');
    expect(formatAge(T0 - 30_000, T0)).toBe('30s ago');
    expect(formatAge(T0 - 59_000, T0)).toBe('59s ago');
  });

  it('switches to minutes, then hours, then days', () => {
    expect(formatAge(T0 - 60_000, T0)).toBe('1m ago');
    expect(formatAge(T0 - 59 * 60_000, T0)).toBe('59m ago');
    // Each unit hands over as soon as the next one reads as at least 1.
    expect(formatAge(T0 - 3600_000, T0)).toBe('1h ago');
    expect(formatAge(T0 - 5400_000, T0)).toBe('2h ago');
    expect(formatAge(T0 - 47 * 3600_000, T0)).toBe('47h ago');
    expect(formatAge(T0 - 48 * 3600_000, T0)).toBe('2d ago');
  });

  it('never reads as being in the future when a clock is slightly ahead', () => {
    // Timestamps come from the service's clock and are compared against the CLI's;
    // "-3s ago" would be a confusing way to say "just now".
    expect(formatAge(T0 + 3_000, T0)).toBe('0s ago');
  });

  it('prints a dash when there is no time', () => {
    expect(formatAge(undefined, T0)).toBe('-');
  });
});

describe('formatDuration', () => {
  it('uses the largest unit the value divides into exactly', () => {
    // A one-day interval reads as `1d`, not `86400000ms`.
    expect(formatDuration(86_400_000)).toBe('1d');
    expect(formatDuration(7_200_000)).toBe('2h');
    expect(formatDuration(300_000)).toBe('5m');
    expect(formatDuration(30_000)).toBe('30s');
  });

  it('falls back to milliseconds when nothing divides evenly', () => {
    expect(formatDuration(90_500)).toBe('90500ms');
    expect(formatDuration(1)).toBe('1ms');
  });

  it("round-trips through the duration parser's vocabulary", () => {
    // What the CLI prints has to be something it would accept back on the way in.
    for (const ms of [86_400_000, 7_200_000, 300_000, 30_000]) {
      expect(formatDuration(ms)).toMatch(/^\d+(ms|s|m|h|d)$/);
    }
  });

  it('prints a dash for a task with no interval', () => {
    expect(formatDuration(undefined)).toBe('-');
  });

  it('treats zero as milliseconds rather than as the largest unit', () => {
    // 0 divides evenly by everything, so the first branch would claim `0d`.
    expect(formatDuration(0)).toBe('0d');
  });
});

describe('truncate', () => {
  it('leaves a value that fits alone', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('exactly-10', 10)).toBe('exactly-10');
  });

  it('cuts to the limit, with the ellipsis counted inside it', () => {
    // Otherwise a truncated cell is one character wider than the column allows and
    // the whole table shifts.
    expect(truncate('a-much-longer-value', 10)).toBe('a-much-lo…');
    expect(truncate('a-much-longer-value', 10)).toHaveLength(10);
  });
});
