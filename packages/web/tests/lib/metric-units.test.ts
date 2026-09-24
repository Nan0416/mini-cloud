import { METRIC_UNITS } from '@mini-cloud/shared';
import { conversionFactor, displayUnitFor, formatMetricValue, formatTick, fractionDigitsForStep } from '@/lib/metric-units';

const EN = 'en-US';

describe('formatMetricValue', () => {
  it('counts bytes in powers of two, as memory is sized', () => {
    expect(formatMetricValue(1536, 'Bytes', EN)).toBe('1.5 KB');
    expect(formatMetricValue(1024 ** 3, 'Bytes', EN)).toBe('1 GB');
  });

  it('starts from the unit reported, so a value in Kilobytes is not read as bytes', () => {
    expect(formatMetricValue(1536, 'Kilobytes', EN)).toBe('1.5 MB');
    expect(formatMetricValue(0.5, 'Kilobytes', EN)).toBe('512 B');
  });

  it('counts bits in powers of ten, as network rates are quoted', () => {
    expect(formatMetricValue(1500, 'Bits/Second', EN)).toBe('1.5 Kb/s');
    expect(formatMetricValue(2_000_000, 'Kilobits', EN)).toBe('2 Gb');
  });

  it('shows a duration in the unit that suits it', () => {
    expect(formatMetricValue(0.25, 'Seconds', EN)).toBe('250 ms');
    expect(formatMetricValue(1500, 'Milliseconds', EN)).toBe('1.5 s');
    expect(formatMetricValue(90, 'Seconds', EN)).toBe('1.5 min');
    expect(formatMetricValue(750, 'Microseconds', EN)).toBe('750 µs');
  });

  it('abbreviates large counts without a space', () => {
    expect(formatMetricValue(12_345, 'Count', EN)).toBe('12.3K');
    expect(formatMetricValue(42, 'Count/Second', EN)).toBe('42/s');
    expect(formatMetricValue(3_400_000, 'None', EN)).toBe('3.4M');
  });

  it('writes a percentage without a space', () => {
    expect(formatMetricValue(42.123, 'Percent', EN)).toBe('42.1%');
  });

  it('keeps about three significant figures', () => {
    expect(formatMetricValue(1.23456, 'None', EN)).toBe('1.23');
    expect(formatMetricValue(123.456, 'None', EN)).toBe('123');
  });

  it('shows zero in the unit reported rather than the smallest step', () => {
    expect(formatMetricValue(0, 'Seconds', EN)).toBe('0 s');
    expect(formatMetricValue(0, 'Megabytes', EN)).toBe('0 MB');
  });

  it('keeps the sign of a negative value and scales by its size', () => {
    expect(formatMetricValue(-2048, 'Bytes', EN)).toBe('-2 KB');
  });

  it('has a way to show every unit CloudWatch accepts', () => {
    for (const unit of METRIC_UNITS) {
      expect(formatMetricValue(1234.5, unit, EN)).toMatch(/\d/);
    }
  });
});

describe('displayUnitFor', () => {
  it('picks one step for an axis from its largest tick, so every label shares it', () => {
    const display = displayUnitFor('Bytes', 1.5 * 1024 ** 3);

    expect(display.symbol).toBe('GB');
    expect(formatTick(0.5 * 1024 ** 3, display, 1, EN)).toBe('0.5 GB');
    expect(formatTick(0, display, 1, EN)).toBe('0.0 GB');
  });

  it('never goes below the smallest step, however small the value', () => {
    expect(displayUnitFor('Count', 0.001).divisor).toBe(1);
  });
});

describe('conversionFactor', () => {
  it('converts along one ladder, so Kilobytes and Megabytes can share an axis', () => {
    expect(conversionFactor('Megabytes', 'Kilobytes')).toBe(1024);
    expect(conversionFactor('Milliseconds', 'Seconds')).toBe(0.001);
    expect(conversionFactor('Count', 'None')).toBe(1);
  });

  it('refuses to convert between things that measure different quantities', () => {
    expect(conversionFactor('Bytes', 'Bits')).toBeUndefined();
    expect(conversionFactor('Bytes', 'Bytes/Second')).toBeUndefined();
    expect(conversionFactor('Percent', 'Count')).toBeUndefined();
  });
});

describe('fractionDigitsForStep', () => {
  it('gives as many decimal places as the tick spacing needs, and no more', () => {
    expect(fractionDigitsForStep(100)).toBe(0);
    expect(fractionDigitsForStep(1)).toBe(0);
    expect(fractionDigitsForStep(0.5)).toBe(1);
    expect(fractionDigitsForStep(0.2)).toBe(1);
    expect(fractionDigitsForStep(0.05)).toBe(2);
  });

  it('is not thrown by a spacing that arrives with floating-point error', () => {
    expect(fractionDigitsForStep(0.3 - 0.2)).toBe(1);
  });

  it('gives none for a spacing it cannot measure', () => {
    expect(fractionDigitsForStep(0)).toBe(0);
    expect(fractionDigitsForStep(Number.NaN)).toBe(0);
  });
});

describe('formatTick', () => {
  it('never labels a tick minus zero', () => {
    expect(formatTick(-0.0001, displayUnitFor('None', 1), 0, EN)).toBe('0');
  });
});
