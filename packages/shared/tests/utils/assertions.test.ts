import { InvalidRequestError } from '../../src/errors';
import {
  assertArray,
  assertBoolean,
  assertDefined,
  assertInteger,
  assertNonEmptyString,
  assertNumber,
  assertOneOf,
  assertOptionalInteger,
  assertOptionalOneOf,
  assertOptionalRecord,
  assertOptionalString,
  assertOptionalStringArray,
  assertOptionalStringMap,
  assertRecord,
  assertString,
  assertStringArray,
  assertStringMap,
  parseOptionalBooleanParam,
  parseOptionalIntegerParam,
} from '../../src/utils/assertions';

/**
 * These sit on the trust boundary, so two things matter beyond the happy path: every
 * rejection is an `InvalidRequestError` (a 400, not a 500), and the message names the
 * field — a caller told only "must be a string" has to guess which one.
 *
 * The `null` handling is the subtle part. JSON has no `undefined`, so a client that
 * serialises an absent optional sends `null`; the optional assertions therefore treat
 * null as absent, while the required ones reject it.
 */
describe('assertDefined', () => {
  it('accepts any JSON value, including the falsy ones', () => {
    // Used for message payloads, where the value is opaque but its absence is not.
    expect(assertDefined(null, 'payload')).toBeNull();
    expect(assertDefined(0, 'payload')).toBe(0);
    expect(assertDefined('', 'payload')).toBe('');
    expect(assertDefined(false, 'payload')).toBe(false);
  });

  it('rejects only absence', () => {
    expect(() => assertDefined(undefined, 'payload')).toThrow(InvalidRequestError);
    expect(() => assertDefined(undefined, 'payload')).toThrow('payload is required');
  });
});

describe('assertString', () => {
  it('accepts a string, empty included', () => {
    expect(assertString('hello', 'name')).toBe('hello');
    expect(assertString('', 'name')).toBe('');
  });

  it('rejects anything else, naming the field', () => {
    expect(() => assertString(42, 'name')).toThrow('name must be a string');
    expect(() => assertString(null, 'name')).toThrow(InvalidRequestError);
    expect(() => assertString(undefined, 'name')).toThrow(InvalidRequestError);
    expect(() => assertString(['a'], 'name')).toThrow(InvalidRequestError);
  });

  it('does not coerce a value that merely looks like a string', () => {
    expect(() => assertString(new String('hello'), 'name')).toThrow(InvalidRequestError);
  });
});

describe('assertNonEmptyString', () => {
  it('rejects the empty string, which is what an unfilled form field sends', () => {
    expect(() => assertNonEmptyString('', 'cmd')).toThrow('cmd must not be empty');
  });

  it("accepts whitespace, because trimming is the caller's decision", () => {
    // A cwd of " " is wrong, but so is silently rewriting what the caller sent.
    expect(assertNonEmptyString(' ', 'cwd')).toBe(' ');
  });
});

describe('assertOptionalString', () => {
  it('treats both absent and null as absent', () => {
    expect(assertOptionalString(undefined, 'description')).toBeUndefined();
    // JSON has no undefined, so a client serialising an omitted field sends null.
    expect(assertOptionalString(null, 'description')).toBeUndefined();
  });

  it('still validates a value that is present', () => {
    expect(assertOptionalString('nightly', 'description')).toBe('nightly');
    expect(() => assertOptionalString(42, 'description')).toThrow(InvalidRequestError);
  });
});

describe('assertNumber', () => {
  it('accepts finite numbers of either sign', () => {
    expect(assertNumber(0, 'n')).toBe(0);
    expect(assertNumber(-1.5, 'n')).toBe(-1.5);
  });

  it('rejects NaN, which is a number by typeof but never a valid value', () => {
    expect(() => assertNumber(Number.NaN, 'n')).toThrow('n must be a number');
  });

  it('rejects a numeric string, because JSON distinguishes them', () => {
    expect(() => assertNumber('42', 'n')).toThrow(InvalidRequestError);
  });
});

describe('assertInteger', () => {
  it('accepts whole numbers', () => {
    expect(assertInteger(42, 'version')).toBe(42);
    expect(assertInteger(0, 'version')).toBe(0);
  });

  it('rejects a fraction', () => {
    expect(() => assertInteger(1.5, 'version')).toThrow('version must be an integer');
  });

  it('rejects infinity, which is neither NaN nor an integer', () => {
    expect(() => assertInteger(Number.POSITIVE_INFINITY, 'version')).toThrow(InvalidRequestError);
  });
});

describe('assertOptionalInteger', () => {
  it('treats absent and null as absent, and validates the rest', () => {
    expect(assertOptionalInteger(undefined, 'duration')).toBeUndefined();
    expect(assertOptionalInteger(null, 'duration')).toBeUndefined();
    expect(assertOptionalInteger(5000, 'duration')).toBe(5000);
    expect(() => assertOptionalInteger(1.5, 'duration')).toThrow(InvalidRequestError);
  });
});

describe('assertBoolean', () => {
  it('accepts only a real boolean', () => {
    expect(assertBoolean(true, 'active')).toBe(true);
    expect(assertBoolean(false, 'active')).toBe(false);
    // Truthiness is not the question; `"false"` and `0` would both be wrong answers.
    expect(() => assertBoolean('true', 'active')).toThrow('active must be a boolean');
    expect(() => assertBoolean(0, 'active')).toThrow(InvalidRequestError);
  });
});

describe('assertOneOf', () => {
  const allowed = ['job', 'service'] as const;

  it('returns the matching member, narrowed to the union', () => {
    expect(assertOneOf('job', 'type', allowed)).toBe('job');
  });

  it('lists the alternatives, so the caller can fix it without reading the docs', () => {
    expect(() => assertOneOf('cronjob', 'type', allowed)).toThrow('type must be one of [job, service]');
  });

  it('is case-sensitive and does not trim', () => {
    expect(() => assertOneOf('Job', 'type', allowed)).toThrow(InvalidRequestError);
    expect(() => assertOneOf('job ', 'type', allowed)).toThrow(InvalidRequestError);
  });

  it('reports a non-string as a type problem before checking membership', () => {
    expect(() => assertOneOf(1, 'type', allowed)).toThrow('type must be a string');
  });
});

describe('assertOptionalOneOf', () => {
  it('treats absent and null as absent', () => {
    expect(assertOptionalOneOf(undefined, 'type', ['job'] as const)).toBeUndefined();
    expect(assertOptionalOneOf(null, 'type', ['job'] as const)).toBeUndefined();
    expect(assertOptionalOneOf('job', 'type', ['job'] as const)).toBe('job');
  });
});

describe('assertRecord', () => {
  it('accepts a plain object', () => {
    expect(assertRecord({ a: 1 }, 'body')).toEqual({ a: 1 });
  });

  it('rejects the things typeof calls an object but a body is not', () => {
    expect(() => assertRecord(null, 'body')).toThrow('body must be an object');
    expect(() => assertRecord([1, 2], 'body')).toThrow('body must be an object');
    expect(() => assertRecord('{}', 'body')).toThrow(InvalidRequestError);
  });

  it("copies the entries rather than handing back the caller's object", () => {
    const source = { a: 1 };

    const record = assertRecord(source, 'body');

    // Downstream code writes into parsed records; aliasing the request body would let
    // that mutation escape back into whatever else still holds it.
    expect(record).not.toBe(source);
    expect(record).toEqual(source);
  });

  it('takes own enumerable properties only, so a prototype cannot inject fields', () => {
    const source = Object.create({ inherited: 'from prototype' }) as Record<string, unknown>;
    source['own'] = 'kept';

    expect(assertRecord(source, 'body')).toEqual({ own: 'kept' });
  });
});

describe('assertOptionalRecord', () => {
  it('treats absent and null as absent, and validates the rest', () => {
    expect(assertOptionalRecord(undefined, 'env')).toBeUndefined();
    expect(assertOptionalRecord(null, 'env')).toBeUndefined();
    expect(assertOptionalRecord({ a: 1 }, 'env')).toEqual({ a: 1 });
    expect(() => assertOptionalRecord([], 'env')).toThrow(InvalidRequestError);
  });
});

describe('assertArray', () => {
  it('accepts an array, empty included', () => {
    expect(assertArray([], 'ids')).toEqual([]);
    expect(assertArray([1, 'a'], 'ids')).toEqual([1, 'a']);
  });

  it('rejects a non-array', () => {
    expect(() => assertArray({ length: 0 }, 'ids')).toThrow('ids must be an array');
    expect(() => assertArray('a,b', 'ids')).toThrow(InvalidRequestError);
  });
});

describe('assertStringArray', () => {
  it('accepts an array of strings', () => {
    expect(assertStringArray(['--full', '-v'], 'arguments')).toEqual(['--full', '-v']);
  });

  it('names the offending index, not just the field', () => {
    // "arguments must be an array of strings" leaves the caller to find which entry.
    expect(() => assertStringArray(['--full', 3], 'arguments')).toThrow('arguments[1] must be a string');
  });
});

describe('assertOptionalStringArray', () => {
  it('treats absent and null as absent, and validates the rest', () => {
    expect(assertOptionalStringArray(undefined, 'arguments')).toBeUndefined();
    expect(assertOptionalStringArray(null, 'arguments')).toBeUndefined();
    expect(assertOptionalStringArray([], 'arguments')).toEqual([]);
    expect(() => assertOptionalStringArray([1], 'arguments')).toThrow(InvalidRequestError);
  });
});

describe('assertStringMap', () => {
  it('accepts a string-to-string map', () => {
    expect(assertStringMap({ STAGE: 'prod' }, 'env')).toEqual({ STAGE: 'prod' });
  });

  it('names the offending key', () => {
    // An env var set to a number is the most common version of this mistake.
    expect(() => assertStringMap({ PORT: 8080 }, 'env')).toThrow('env.PORT must be a string');
  });

  it('rejects a non-object outright', () => {
    expect(() => assertStringMap(['STAGE=prod'], 'env')).toThrow('env must be an object');
  });
});

describe('assertOptionalStringMap', () => {
  it('treats absent and null as absent, and validates the rest', () => {
    expect(assertOptionalStringMap(undefined, 'env')).toBeUndefined();
    expect(assertOptionalStringMap(null, 'env')).toBeUndefined();
    expect(assertOptionalStringMap({}, 'env')).toEqual({});
    expect(() => assertOptionalStringMap({ A: 1 }, 'env')).toThrow(InvalidRequestError);
  });
});

/**
 * Query strings carry everything as text, so these two parse rather than type-check.
 * The empty string is the interesting case: `?limit=` is what a form submits for an
 * untouched field, and it means "not set", not "invalid".
 */
describe('parseOptionalIntegerParam', () => {
  it('parses a numeric string', () => {
    expect(parseOptionalIntegerParam('42', 'limit')).toBe(42);
    expect(parseOptionalIntegerParam('-1', 'from')).toBe(-1);
    expect(parseOptionalIntegerParam('0', 'from')).toBe(0);
  });

  it('treats absent, null and empty alike, because ?limit= means unset', () => {
    expect(parseOptionalIntegerParam(undefined, 'limit')).toBeUndefined();
    expect(parseOptionalIntegerParam(null, 'limit')).toBeUndefined();
    expect(parseOptionalIntegerParam('', 'limit')).toBeUndefined();
  });

  it('rejects what Number() would otherwise wave through', () => {
    // Number(' ') is 0 and Number('1e3') is 1000 — both integers by Number.isInteger,
    // and neither is what a caller writing a query string meant.
    expect(() => parseOptionalIntegerParam('abc', 'limit')).toThrow('limit must be an integer');
    expect(() => parseOptionalIntegerParam('1.5', 'limit')).toThrow(InvalidRequestError);
    expect(() => parseOptionalIntegerParam('42px', 'limit')).toThrow(InvalidRequestError);
  });

  it('rejects a repeated parameter, which express hands over as an array', () => {
    // `?limit=1&limit=2` arrives as ['1', '2']; coercing it would pick one at random.
    expect(() => parseOptionalIntegerParam(['1', '2'], 'limit')).toThrow('limit must be a string');
  });
});

describe('parseOptionalBooleanParam', () => {
  it('accepts either case of either word', () => {
    expect(parseOptionalBooleanParam('true', 'active')).toBe(true);
    expect(parseOptionalBooleanParam('TRUE', 'active')).toBe(true);
    expect(parseOptionalBooleanParam('False', 'active')).toBe(false);
  });

  it('treats absent, null and empty as unset', () => {
    expect(parseOptionalBooleanParam(undefined, 'active')).toBeUndefined();
    expect(parseOptionalBooleanParam(null, 'active')).toBeUndefined();
    expect(parseOptionalBooleanParam('', 'active')).toBeUndefined();
  });

  it('rejects the near misses rather than guessing', () => {
    // `?active=1` reads as true to a human and would be a coin flip here.
    expect(() => parseOptionalBooleanParam('1', 'active')).toThrow('active must be "true" or "false"');
    expect(() => parseOptionalBooleanParam('yes', 'active')).toThrow(InvalidRequestError);
  });
});
