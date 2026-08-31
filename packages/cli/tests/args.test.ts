import { InvalidRequestError } from '@mini-cloud/shared';
import { collect, parseDuration, parseKeyValues, parsePositiveInteger, parseTimestamp } from '../src/args';

/**
 * These run as commander parse callbacks, so a rejection here happens before any
 * command body — and before any HTTP request. That is the point of putting the domain
 * rules in the callback rather than in the command: `--every 5x` fails locally with a
 * message naming the flag, instead of reaching the service as a 400.
 */
describe('parseDuration', () => {
  it('accepts each unit', () => {
    expect(parseDuration('500ms', 'every')).toBe(500);
    expect(parseDuration('30s', 'every')).toBe(30_000);
    expect(parseDuration('5m', 'every')).toBe(300_000);
    expect(parseDuration('2h', 'every')).toBe(7_200_000);
    expect(parseDuration('1d', 'every')).toBe(86_400_000);
  });

  it('treats a bare number as milliseconds', () => {
    expect(parseDuration('1000', 'every')).toBe(1_000);
    expect(parseDuration('0', 'every')).toBe(0);
  });

  it('ignores surrounding whitespace, which a quoted shell argument keeps', () => {
    expect(parseDuration('  5m  ', 'every')).toBe(300_000);
  });

  it('names the flag when the value is unusable', () => {
    // "must be a duration" leaves the reader to work out which of three flags it was.
    expect(() => parseDuration('5x', 'every')).toThrow('--every must look like 30s, 5m, 2h or 1d (got "5x")');
    expect(() => parseDuration('', 'every')).toThrow(InvalidRequestError);
  });

  it('rejects the near misses rather than guessing', () => {
    for (const value of ['5 m', '-5m', '5.5m', 'm5', '5min', '5S']) {
      expect(() => parseDuration(value, 'every')).toThrow(InvalidRequestError);
    }
  });
});

describe('parseTimestamp', () => {
  it('resolves `now` to the current time', () => {
    const before = Date.now();

    const parsed = parseTimestamp('now', 'at');

    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(Date.now());
  });

  it('accepts epoch milliseconds', () => {
    expect(parseTimestamp('1800000000000', 'at')).toBe(1_800_000_000_000);
  });

  it('accepts an ISO timestamp', () => {
    expect(parseTimestamp('2026-06-01T12:00:00.000Z', 'at')).toBe(Date.UTC(2026, 5, 1, 12, 0, 0));
  });

  it('accepts a date with no time', () => {
    expect(parseTimestamp('2026-06-01', 'at')).toBe(Date.UTC(2026, 5, 1));
  });

  it('names the flag and lists the accepted forms when it cannot parse', () => {
    expect(() => parseTimestamp('tomorrow', 'at')).toThrow('--at must be an ISO timestamp, epoch milliseconds, or "now" (got "tomorrow")');
    expect(() => parseTimestamp('2026-13-45', 'at')).toThrow(InvalidRequestError);
  });
});

describe('parseKeyValues', () => {
  it('turns repeated KEY=VALUE arguments into a map', () => {
    expect(parseKeyValues(['STAGE=prod', 'DATA_DIR=/srv/data'], '--env')).toEqual({ STAGE: 'prod', DATA_DIR: '/srv/data' });
  });

  it('keeps everything after the first equals, so a value may contain one', () => {
    // Connection strings and URLs routinely do.
    expect(parseKeyValues(['DSN=postgres://u:p@h/db?ssl=true'], '--env')).toEqual({ DSN: 'postgres://u:p@h/db?ssl=true' });
  });

  it('accepts an empty value, which is how a variable is set to nothing', () => {
    expect(parseKeyValues(['EMPTY='], '--env')).toEqual({ EMPTY: '' });
  });

  it('returns an empty map for no arguments', () => {
    expect(parseKeyValues([], '--env')).toEqual({});
  });

  it('lets a later argument win, matching how a shell assignment reads', () => {
    expect(parseKeyValues(['STAGE=beta', 'STAGE=prod'], '--env')).toEqual({ STAGE: 'prod' });
  });

  it('rejects an entry with no equals, or with an empty key', () => {
    expect(() => parseKeyValues(['STAGE'], '--env')).toThrow('--env must look like KEY=VALUE (got "STAGE")');
    // `=value` would otherwise become a variable with an empty name.
    expect(() => parseKeyValues(['=prod'], '--env')).toThrow(InvalidRequestError);
  });
});

describe('parsePositiveInteger', () => {
  it('accepts a positive whole number', () => {
    expect(parsePositiveInteger('1', 'limit')).toBe(1);
    expect(parsePositiveInteger('500', 'limit')).toBe(500);
  });

  it('rejects zero, negatives and fractions', () => {
    // A limit of 0 returns nothing, which reads as "the service has no data".
    for (const value of ['0', '-1', '1.5']) {
      expect(() => parsePositiveInteger(value, 'limit')).toThrow(InvalidRequestError);
    }
  });

  it('rejects what Number() would otherwise wave through', () => {
    // Number('') is 0 and Number(' ') is 0; both are integers by Number.isInteger.
    for (const value of ['abc', '', ' ', '1e3px']) {
      expect(() => parsePositiveInteger(value, 'limit')).toThrow('--limit must be a positive integer');
    }
  });
});

describe('collect', () => {
  it('accumulates a repeatable option in the order it was given', () => {
    // `--agent a --agent b` — commander calls this once per occurrence with the
    // accumulator so far.
    expect(collect('b', collect('a', []))).toEqual(['a', 'b']);
  });

  it('does not mutate the accumulator it was handed', () => {
    const previous = ['a'];

    collect('b', previous);

    expect(previous).toEqual(['a']);
  });
});
