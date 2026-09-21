import { compactHistogram, histogramFrom, mergeHistograms, observationCount, percentileFrom, statisticsFrom } from '../../src/utils/histogram';

describe('mergeHistograms', () => {
  it('produces the same result whichever order two agents report in', () => {
    // This is the property that makes out-of-order reporting a non-event: one agent
    // can post the 10:00 bucket at 10:01 and another at 10:02, in either order.
    const left = histogramFrom([1, 2, 2]);
    const right = histogramFrom([2, 3]);

    expect(mergeHistograms(left, right)).toEqual(mergeHistograms(right, left));
  });

  it('is associative, so it does not matter how reports are batched', () => {
    const a = histogramFrom([1]);
    const b = histogramFrom([2]);
    const c = histogramFrom([1, 3]);

    expect(mergeHistograms(mergeHistograms(a, b), c)).toEqual(mergeHistograms(a, mergeHistograms(b, c)));
  });

  it('keeps every observation rather than replacing a value', () => {
    expect(observationCount(mergeHistograms(histogramFrom([5, 5]), histogramFrom([5])))).toBe(3);
  });
});

describe('compactHistogram', () => {
  it('leaves an ordinary distribution exactly as it is', () => {
    const histogram = histogramFrom([10, 20, 20, 30]);

    expect(compactHistogram(histogram, 100)).toEqual(histogram);
  });

  it('bounds the number of distinct values it keeps', () => {
    const values = Array.from({ length: 500 }, (_unused, index) => 1000 + index);

    expect(Object.keys(compactHistogram(histogramFrom(values), 100)).length).toBeLessThanOrEqual(100);
  });

  it('never loses or invents an observation while rounding', () => {
    const values = Array.from({ length: 500 }, (_unused, index) => 1000 + index);

    expect(observationCount(compactHistogram(histogramFrom(values), 100))).toBe(500);
  });

  it('rounds deterministically, so two agents still share a bucket', () => {
    // If rounding depended on what else was in the histogram, the same observation
    // from two machines would land in two buckets and the merge would double the
    // distinct count instead of the observation count.
    const many = Array.from({ length: 500 }, (_unused, index) => 1000 + index);
    const first = compactHistogram(histogramFrom(many), 100);
    const second = compactHistogram(histogramFrom(many), 100);

    expect(Object.keys(mergeHistograms(first, second))).toEqual(Object.keys(first));
  });
});

describe('statisticsFrom', () => {
  it('weights the sum by how many times each value was seen', () => {
    expect(statisticsFrom(histogramFrom([2, 2, 2, 10]))).toEqual({ sampleCount: 4, sum: 16, min: 2, max: 10 });
  });

  it('reports zeroes for an empty distribution rather than infinities', () => {
    expect(statisticsFrom({})).toEqual({ sampleCount: 0, sum: 0, min: 0, max: 0 });
  });
});

describe('percentileFrom', () => {
  it('orders values numerically, not as strings', () => {
    // The legacy implementation called `sort()` with no comparator, which ordered
    // these as "10", "100", "2" and made every percentile wrong for any metric whose
    // values spanned different digit counts.
    expect(percentileFrom(histogramFrom([2, 10, 100]), 0.5)).toBe(10);
  });

  it('returns the largest value at the top of the range', () => {
    expect(percentileFrom(histogramFrom([1, 2, 3, 4]), 1)).toBe(4);
  });

  it('returns the smallest value at the bottom of the range', () => {
    expect(percentileFrom(histogramFrom([1, 2, 3, 4]), 0)).toBe(1);
  });

  it('counts repeated observations, so a common value dominates', () => {
    const histogram = histogramFrom([1, 1, 1, 1, 1, 1, 1, 1, 1, 50]);

    expect(percentileFrom(histogram, 0.5)).toBe(1);
    expect(percentileFrom(histogram, 0.99)).toBe(50);
  });

  it('uses nearest rank, so p50 of ten values is the fifth smallest', () => {
    expect(percentileFrom(histogramFrom([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 0.5)).toBe(5);
  });

  it('answers zero for an empty distribution rather than NaN', () => {
    expect(percentileFrom({}, 0.9)).toBe(0);
  });
});
