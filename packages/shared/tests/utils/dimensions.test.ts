import { EMPTY_DIMENSIONS_HASH, hashDimensions, parseDimensionsHash, sameDimensions } from '../../src/utils/dimensions';

describe('hashDimensions', () => {
  it('gives one key whatever order the names were written in', () => {
    // The hash identifies a series across machines and restarts, so two callers
    // describing the same set must never produce two rows.
    expect(hashDimensions({ Operation: 'Ingest', Service: 'Api' })).toBe(hashDimensions({ Service: 'Api', Operation: 'Ingest' }));
  });

  it('distinguishes a set with no dimensions from one with an empty value', () => {
    expect(hashDimensions({})).toBe(EMPTY_DIMENSIONS_HASH);
    expect(hashDimensions({ Operation: '' })).not.toBe(EMPTY_DIMENSIONS_HASH);
  });

  it('orders names by code point rather than by locale', () => {
    // `localeCompare` would sort these differently under some locales, which would
    // give the same series two keys depending on which machine wrote it.
    expect(hashDimensions({ a: '1', B: '2' })).toBe(`${encodeURIComponent('B')}/2;${encodeURIComponent('a')}/1`);
  });

  it('escapes both delimiters so a value containing them stays unambiguous', () => {
    const hash = hashDimensions({ Path: 'a/b;c' });

    expect(hash).not.toContain('a/b');
    expect(parseDimensionsHash(hash)).toEqual({ Path: 'a/b;c' });
  });
});

describe('parseDimensionsHash', () => {
  it('round trips a set of several dimensions', () => {
    const dimensions = { Operation: 'Ingest', Region: 'home', Host: 'nans-macbook-pro' };

    expect(parseDimensionsHash(hashDimensions(dimensions))).toEqual(dimensions);
  });

  it('reads the empty hash back as an empty set', () => {
    expect(parseDimensionsHash(EMPTY_DIMENSIONS_HASH)).toEqual({});
    expect(parseDimensionsHash('')).toEqual({});
  });
});

describe('sameDimensions', () => {
  it('ignores key order', () => {
    expect(sameDimensions({ a: '1', b: '2' }, { b: '2', a: '1' })).toBe(true);
  });

  it('separates sets that differ only by an extra dimension', () => {
    // Each is its own series in CloudWatch, and summing across them would count the
    // same observation twice.
    expect(sameDimensions({ a: '1' }, { a: '1', b: '2' })).toBe(false);
  });
});
