import type { MetricUnit } from '@mini-cloud/shared';

/**
 * Showing a value in the unit a person would pick: 1.5 GB rather than 1572864 KB,
 * 250 ms rather than 0.25 Seconds.
 *
 * Every EMF unit belongs to a ladder of steps it can be shown in. A value moves along
 * its own ladder only, so bytes stay bytes and never turn into bits.
 */

interface Step {
  /** Size of one of this step, in the ladder's smallest step. */
  readonly size: number;
  readonly symbol: string;
}

interface Ladder {
  readonly steps: ReadonlyArray<Step>;
  /** Between the number and the symbol: "1.5 GB", but "1.5K" and "40%". */
  readonly separator: string;
}

function ladder(base: number, symbols: ReadonlyArray<string>, separator: string): Ladder {
  return { steps: symbols.map((symbol, index) => ({ size: Math.pow(base, index), symbol })), separator };
}

const BYTES = ladder(1024, ['B', 'KB', 'MB', 'GB', 'TB'], ' ');
const BYTE_RATE = ladder(1024, ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'], ' ');
// Network rates are quoted in powers of ten, unlike memory.
const BITS = ladder(1000, ['b', 'Kb', 'Mb', 'Gb', 'Tb'], ' ');
const BIT_RATE = ladder(1000, ['b/s', 'Kb/s', 'Mb/s', 'Gb/s', 'Tb/s'], ' ');
const COUNT = ladder(1000, ['', 'K', 'M', 'G', 'T'], '');
const COUNT_RATE = ladder(1000, ['/s', 'K/s', 'M/s', 'G/s', 'T/s'], '');
const PERCENT: Ladder = { steps: [{ size: 1, symbol: '%' }], separator: '' };
const TIME: Ladder = {
  steps: [
    { size: 1, symbol: 'µs' },
    { size: 1e3, symbol: 'ms' },
    { size: 1e6, symbol: 's' },
    { size: 6e7, symbol: 'min' },
    { size: 3.6e9, symbol: 'h' },
  ],
  separator: ' ',
};

interface Placement {
  readonly ladder: Ladder;
  /** Which step of the ladder the unit itself is. */
  readonly index: number;
}

/** A `Record` over the union, so a unit added to `MetricUnit` does not compile until it is placed here. */
const PLACEMENTS: Readonly<Record<MetricUnit, Placement>> = {
  Microseconds: { ladder: TIME, index: 0 },
  Milliseconds: { ladder: TIME, index: 1 },
  Seconds: { ladder: TIME, index: 2 },
  Bytes: { ladder: BYTES, index: 0 },
  Kilobytes: { ladder: BYTES, index: 1 },
  Megabytes: { ladder: BYTES, index: 2 },
  Gigabytes: { ladder: BYTES, index: 3 },
  Terabytes: { ladder: BYTES, index: 4 },
  Bits: { ladder: BITS, index: 0 },
  Kilobits: { ladder: BITS, index: 1 },
  Megabits: { ladder: BITS, index: 2 },
  Gigabits: { ladder: BITS, index: 3 },
  Terabits: { ladder: BITS, index: 4 },
  Percent: { ladder: PERCENT, index: 0 },
  Count: { ladder: COUNT, index: 0 },
  'Bytes/Second': { ladder: BYTE_RATE, index: 0 },
  'Kilobytes/Second': { ladder: BYTE_RATE, index: 1 },
  'Megabytes/Second': { ladder: BYTE_RATE, index: 2 },
  'Gigabytes/Second': { ladder: BYTE_RATE, index: 3 },
  'Terabytes/Second': { ladder: BYTE_RATE, index: 4 },
  'Bits/Second': { ladder: BIT_RATE, index: 0 },
  'Kilobits/Second': { ladder: BIT_RATE, index: 1 },
  'Megabits/Second': { ladder: BIT_RATE, index: 2 },
  'Gigabits/Second': { ladder: BIT_RATE, index: 3 },
  'Terabits/Second': { ladder: BIT_RATE, index: 4 },
  'Count/Second': { ladder: COUNT_RATE, index: 0 },
  None: { ladder: COUNT, index: 0 },
};

/** A step to show values in: divide a value by `divisor` and append `symbol`. */
export interface DisplayUnit {
  readonly divisor: number;
  readonly symbol: string;
  readonly separator: string;
}

/**
 * The largest step that `magnitude` holds at least one of, so what is shown is at
 * least 1 wherever the ladder allows. A whole axis takes one step from its largest
 * tick, so its labels share a unit.
 */
export function displayUnitFor(unit: MetricUnit, magnitude: number): DisplayUnit {
  const {
    ladder: { steps, separator },
    index,
  } = PLACEMENTS[unit];
  const own = steps[index].size;
  const amount = Math.abs(magnitude) * own;

  // Zero holds none of any step, and reads best in the unit it was reported in.
  let chosen = amount === 0 || !Number.isFinite(amount) ? index : 0;
  for (let candidate = 0; amount > 0 && candidate < steps.length; candidate += 1) {
    if (amount >= steps[candidate].size) {
      chosen = candidate;
    }
  }
  return { divisor: steps[chosen].size / own, symbol: steps[chosen].symbol, separator };
}

/**
 * What to multiply a value in `from` by to express it in `to`, or `undefined` when
 * the two measure different things and cannot share an axis.
 */
export function conversionFactor(from: MetricUnit, to: MetricUnit): number | undefined {
  const source = PLACEMENTS[from];
  const target = PLACEMENTS[to];
  if (source.ladder !== target.ladder) {
    return undefined;
  }
  return source.ladder.steps[source.index].size / target.ladder.steps[target.index].size;
}

/** Decimal places that tell apart ticks `step` apart, in the display unit. */
export function fractionDigitsForStep(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) {
    return 0;
  }
  // The epsilon absorbs 0.1 arriving as 0.09999999999999998 from a division.
  return Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
}

/** A value that rounds to nothing is shown as "0", which `Intl` would otherwise print as "-0". */
function withoutNegativeZero(value: number, fractionDigits: number): number {
  return Number(value.toFixed(fractionDigits)) === 0 ? 0 : value;
}

function withSymbol(number: string, display: DisplayUnit): string {
  return display.symbol === '' ? number : `${number}${display.separator}${display.symbol}`;
}

/** An axis label: every tick on an axis gets the same unit and the same decimal places. */
export function formatTick(value: number, display: DisplayUnit, fractionDigits: number, locale?: string): string {
  const number = new Intl.NumberFormat(locale, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(
    withoutNegativeZero(value / display.divisor, fractionDigits),
  );
  return withSymbol(number, display);
}

/** One value on its own, for a tooltip or a table cell, to about three significant figures. */
export function formatMetricValue(value: number, unit: MetricUnit, locale?: string): string {
  const display = displayUnitFor(unit, value);
  const scaled = value / display.divisor;
  const fractionDigits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: fractionDigits }).format(withoutNegativeZero(scaled, fractionDigits));
  return withSymbol(number, display);
}
