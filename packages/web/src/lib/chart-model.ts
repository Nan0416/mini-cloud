import type { MetricAxis, MetricDatapoint, MetricUnit } from '@mini-cloud/shared';
import { bisectCenter } from 'd3-array';
import { scaleLinear, scaleTime, type ScaleLinear } from 'd3-scale';
import { area, line } from 'd3-shape';
import { timeDay, timeMonth, timeYear } from 'd3-time';
import { conversionFactor, displayUnitFor, formatTick, fractionDigitsForStep } from '@/lib/metric-units';

/**
 * The arithmetic of a time-series chart: scales, ticks, paths and hover lookup.
 *
 * d3 does the computing here and React does the drawing in `TimeSeriesChart`. Keeping
 * this a pure function of its input means the geometry is tested without a DOM, and
 * a component re-render cannot redo it unless the data or the size changed.
 */

export interface ChartSeries {
  readonly id: string;
  readonly unit: MetricUnit;
  readonly axis: MetricAxis;
  readonly datapoints: ReadonlyArray<MetricDatapoint>;
}

export interface ChartModelInput {
  readonly series: ReadonlyArray<ChartSeries>;
  /** Start of the first bucket. */
  readonly from: number;
  /** End of the window, exclusive, so the last bucket starts one period before it. */
  readonly to: number;
  readonly periodMs: number;
  readonly width: number;
  readonly height: number;
  /** The viewer's by default; fixed in tests. */
  readonly locale?: string;
}

export interface Tick {
  readonly position: number;
  readonly label: string;
}

export interface TimeTick extends Tick {
  /** Where the label hangs from its tick, so the ones at the edges stay inside the chart. */
  readonly anchor: 'start' | 'middle' | 'end';
}

export interface AxisModel {
  readonly side: MetricAxis;
  /**
   * The units of the series drawn against this axis that cannot be converted into one
   * another. More than one means the labels are bare numbers and the axis is wrong.
   */
  readonly units: ReadonlyArray<MetricUnit>;
  readonly ticks: ReadonlyArray<Tick>;
}

export interface ChartPoint {
  readonly x: number;
  readonly y: number;
}

export interface SeriesModel {
  readonly id: string;
  readonly line: string;
  /** A wash under the line, drawn only when it is the chart's one series. */
  readonly area: string | undefined;
  /** Datapoints with a gap on both sides, which a line has no segment to show. */
  readonly dots: ReadonlyArray<ChartPoint>;
  /** Per bucket, in the series' own unit; `undefined` where it reported nothing. */
  readonly values: ReadonlyArray<number | undefined>;
  /** Per bucket, the vertical position of that value. */
  readonly ys: ReadonlyArray<number | undefined>;
}

export interface PlotArea {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface ChartModel {
  readonly width: number;
  readonly height: number;
  readonly plot: PlotArea;
  /** Every bucket start in the window, whether or not any series reported in it. */
  readonly buckets: ReadonlyArray<number>;
  readonly xs: ReadonlyArray<number>;
  readonly xTicks: ReadonlyArray<TimeTick>;
  readonly axes: ReadonlyArray<AxisModel>;
  /** One set of rules, from the first axis: two sets would cross each other. */
  readonly gridlines: ReadonlyArray<number>;
  readonly series: ReadonlyArray<SeriesModel>;
}

const MARGIN_TOP = 10;
/** Room under the plot for the time labels. */
const MARGIN_BOTTOM = 24;
/** Room beside the plot on a side with no axis, for a time label hanging over the edge. */
const MARGIN_BARE = 12;
/** An estimate of an 11px label's width per character, so no text has to be measured. */
const CHARACTER_WIDTH = 6.5;
const AXIS_LABEL_GAP = 8;
/** Pixels between y-axis ticks and between time ticks, roughly. */
const Y_TICK_SPACING = 48;
const X_TICK_SPACING = 110;
/** The closest two time labels may sit before the second is dropped. */
const MIN_X_TICK_GAP = 60;

interface AxisScale {
  readonly model: AxisModel;
  readonly scale: ScaleLinear<number, number>;
  /** Per series id: what converts its values into the axis unit. */
  readonly factors: ReadonlyMap<string, number>;
}

/** One side's scale. Built before the margins, because the margins are sized from its labels. */
function buildAxis(side: MetricAxis, series: ReadonlyArray<ChartSeries>, plotTop: number, plotBottom: number, locale: string | undefined): AxisScale {
  // The first series with data sets the unit, and others on its ladder convert into it.
  const reporting = series.filter((candidate) => candidate.datapoints.length > 0);
  const units: MetricUnit[] = [];
  for (const candidate of reporting) {
    if (!units.some((unit) => conversionFactor(candidate.unit, unit) !== undefined)) {
      units.push(candidate.unit);
    }
  }
  const unit = units.length === 1 ? units[0] : undefined;

  const factors = new Map<string, number>();
  let low = 0;
  let high = 0;
  for (const candidate of reporting) {
    const factor = unit === undefined ? 1 : (conversionFactor(candidate.unit, unit) ?? 1);
    factors.set(candidate.id, factor);
    for (const point of candidate.datapoints) {
      low = Math.min(low, point.value * factor);
      high = Math.max(high, point.value * factor);
    }
  }
  if (low === high) {
    high = low + 1;
  }

  // Ticks are made nice in the unit they are read in, so a memory axis steps by a
  // round number of GB rather than a round number of bytes that lands on 0.466 GB.
  const display = displayUnitFor(unit ?? 'None', Math.max(Math.abs(low), Math.abs(high)));
  const count = Math.max(2, Math.round((plotBottom - plotTop) / Y_TICK_SPACING));
  const readable = scaleLinear()
    .domain([low / display.divisor, high / display.divisor])
    .nice(count);
  const values = readable.ticks(count);
  const digits = fractionDigitsForStep(values.length > 1 ? values[1] - values[0] : 1);

  const [niceLow, niceHigh] = readable.domain();
  const scale = scaleLinear()
    .domain([niceLow * display.divisor, niceHigh * display.divisor])
    .range([plotBottom, plotTop]);

  const ticks = values.map((value) => ({ position: scale(value * display.divisor), label: formatTick(value * display.divisor, display, digits, locale) }));
  return { model: { side, units, ticks }, scale, factors };
}

function labelWidth(axis: AxisScale | undefined): number {
  if (axis === undefined) {
    return MARGIN_BARE;
  }
  const longest = Math.max(...axis.model.ticks.map((tick) => tick.label.length), 1);
  return Math.ceil(longest * CHARACTER_WIDTH) + AXIS_LABEL_GAP * 2;
}

/**
 * A time label that says as much as the tick needs: the time of day for most, the date
 * at midnight, the month on the first, the year on the first of January.
 */
export function formatTimeTick(date: Date, locale?: string): string {
  if (timeDay.floor(date) < date) {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }
  if (timeMonth.floor(date) < date) {
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date);
  }
  if (timeYear.floor(date) < date) {
    return new Intl.DateTimeFormat(locale, { month: 'short' }).format(date);
  }
  return new Intl.DateTimeFormat(locale, { year: 'numeric' }).format(date);
}

/**
 * When a bucket starts, always with the time: daily buckets start at midnight UTC,
 * which is the evening before west of Greenwich, so a bare date would name the wrong day.
 */
export function formatBucket(timestamp: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(timestamp));
}

export function buildChartModel(input: ChartModelInput): ChartModel {
  const { width, height, periodMs, locale } = input;
  const plotTop = MARGIN_TOP;
  const plotBottom = Math.max(plotTop + 1, height - MARGIN_BOTTOM);

  const count = Math.max(0, Math.round((input.to - input.from) / periodMs));
  const buckets = Array.from({ length: count }, (_, index) => input.from + index * periodMs);

  const onSide = (side: MetricAxis) => input.series.filter((candidate) => candidate.axis === side);
  // A left axis even with nothing on it, so an empty chart still has a frame.
  const left = onSide('left').length > 0 || onSide('right').length === 0 ? buildAxis('left', onSide('left'), plotTop, plotBottom, locale) : undefined;
  const right = onSide('right').length > 0 ? buildAxis('right', onSide('right'), plotTop, plotBottom, locale) : undefined;

  const plot: PlotArea = {
    left: labelWidth(left),
    top: plotTop,
    right: Math.max(labelWidth(left) + 1, width - labelWidth(right)),
    bottom: plotBottom,
  };

  // A lone bucket has no span to scale across, so it is centred on one period.
  const first = buckets[0] ?? input.from;
  const last = buckets[buckets.length - 1] ?? input.from;
  const domain = first === last ? [first - periodMs / 2, first + periodMs / 2] : [first, last];
  const x = scaleTime()
    .domain(domain.map((ms) => new Date(ms)))
    .range([plot.left, plot.right]);
  const xs = buckets.map((bucket) => x(new Date(bucket)));

  const edge = 30;
  const xTicks: TimeTick[] = [];
  for (const date of x.ticks(Math.max(2, Math.floor((plot.right - plot.left) / X_TICK_SPACING)))) {
    const position = x(date);
    // d3 restarts every-other-day ticks on the first of each month, which can put the
    // 31st and the 1st a day apart and their labels on top of each other.
    const previous = xTicks[xTicks.length - 1];
    if (previous !== undefined && position - previous.position < MIN_X_TICK_GAP) {
      continue;
    }
    const anchor: TimeTick['anchor'] = position - plot.left < edge ? 'start' : plot.right - position < edge ? 'end' : 'middle';
    xTicks.push({ position, label: formatTimeTick(date, locale), anchor });
  }

  const axes = [left, right].filter((axis): axis is AxisScale => axis !== undefined);
  const lone = input.series.length === 1;

  const series = input.series.map((candidate): SeriesModel => {
    const axis = candidate.axis === 'right' && right !== undefined ? right : (left ?? right);
    const factor = axis?.factors.get(candidate.id) ?? 1;

    const values: Array<number | undefined> = buckets.map(() => undefined);
    for (const point of candidate.datapoints) {
      const index = Math.round((point.timestamp - input.from) / periodMs);
      if (index >= 0 && index < buckets.length) {
        values[index] = point.value;
      }
    }
    const ys = values.map((value) => (value === undefined || axis === undefined ? undefined : axis.scale(value * factor)));

    const points = xs.map((position, index) => ({ x: position, y: ys[index] }));
    const defined = (point: { y: number | undefined }): boolean => point.y !== undefined;
    const path = line<{ x: number; y: number | undefined }>()
      .defined(defined)
      .x((point) => point.x)
      .y((point) => point.y ?? 0)(points);
    const wash =
      lone && axis !== undefined
        ? area<{ x: number; y: number | undefined }>()
            .defined(defined)
            .x((point) => point.x)
            .y0(axis.scale(0))
            .y1((point) => point.y ?? 0)(points)
        : null;

    const dots: ChartPoint[] = [];
    ys.forEach((y, index) => {
      if (y !== undefined && ys[index - 1] === undefined && ys[index + 1] === undefined) {
        dots.push({ x: xs[index], y });
      }
    });

    return { id: candidate.id, line: path ?? '', area: wash ?? undefined, dots, values, ys };
  });

  return {
    width,
    height,
    plot,
    buckets,
    xs,
    xTicks,
    axes: axes.map((axis) => axis.model),
    gridlines: axes.length > 0 ? axes[0].model.ticks.map((tick) => tick.position) : [],
    series,
  };
}

/** The bucket nearest a horizontal position, which is where the crosshair snaps to. */
export function nearestBucket(model: ChartModel, position: number): number | undefined {
  if (model.xs.length === 0) {
    return undefined;
  }
  return bisectCenter(model.xs, position);
}
