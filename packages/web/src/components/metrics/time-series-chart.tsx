import type { MetricAxis, MetricDatapoint, MetricUnit } from '@mini-cloud/shared';
import { AlertTriangle } from 'lucide-react';
import { memo, useMemo, useState, type KeyboardEvent } from 'react';
import { Spinner } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useElementWidth } from '@/hooks/use-element-width';
import { buildChartModel, formatBucket, nearestBucket, type ChartModel } from '@/lib/chart-model';
import { NA } from '@/lib/format';
import { formatMetricValue } from '@/lib/metric-units';
import { cn } from '@/lib/utils';

export interface ChartSeriesLoading {
  readonly kind: 'loading';
}

export interface ChartSeriesFailed {
  readonly kind: 'error';
  readonly message: string;
  /** Asks again. Absent when asking again cannot help, as with a refused percentile. */
  readonly retry?: () => void;
}

export interface ChartSeriesReady {
  readonly kind: 'ready';
  readonly unit: MetricUnit;
  readonly datapoints: ReadonlyArray<MetricDatapoint>;
}

export type ChartSeriesState = ChartSeriesLoading | ChartSeriesFailed | ChartSeriesReady;

export interface ChartSeriesView {
  readonly id: string;
  readonly label: string;
  /** 1 to 8: which `--chart-n` the series is drawn in. */
  readonly colorSlot: number;
  readonly axis: MetricAxis;
  readonly state: ChartSeriesState;
}

export interface TimeSeriesChartProps {
  readonly series: ReadonlyArray<ChartSeriesView>;
  /** The window read, as `GetMetricDataResponse` reports it; `to` is exclusive. */
  readonly from: number;
  readonly to: number;
  readonly periodMs: number;
  /** A refetch is under way: the last render stays, dimmed, rather than flashing a skeleton. */
  readonly stale?: boolean;
}

interface ReadySeries {
  readonly id: string;
  readonly label: string;
  readonly colorSlot: number;
  readonly axis: MetricAxis;
  readonly unit: MetricUnit;
  readonly datapoints: ReadonlyArray<MetricDatapoint>;
}

/** Includes the time labels, so the card never scrolls inside itself. */
const HEIGHT = 280;

const color = (slot: number): string => `var(--chart-${slot})`;

/**
 * Time series drawn as SVG by React from geometry `buildChartModel` computed with d3.
 *
 * Colours are the console's `--chart-n` tokens, so light and dark come from the same
 * stylesheet as the rest of the page. The hover readout is its own component with its
 * own state, so moving the pointer redraws a crosshair and not every line.
 */
export function TimeSeriesChart(props: TimeSeriesChartProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart');

  const ready = useMemo(
    () =>
      props.series.flatMap((series): ReadySeries[] =>
        series.state.kind === 'ready'
          ? [{ id: series.id, label: series.label, colorSlot: series.colorSlot, axis: series.axis, unit: series.state.unit, datapoints: series.state.datapoints }]
          : [],
      ),
    [props.series],
  );
  const bothAxes = props.series.some((series) => series.axis === 'left') && props.series.some((series) => series.axis === 'right');

  return (
    <figure className={cn('space-y-3 transition-opacity', props.stale === true && 'opacity-60')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* One series needs no legend: the title already names it. */}
        {props.series.length > 1 ? <Legend series={props.series} bothAxes={bothAxes} /> : <div />}
        <div className="flex gap-1" role="group" aria-label="Show as">
          <Button size="sm" variant={view === 'chart' ? 'secondary' : 'ghost'} aria-pressed={view === 'chart'} onClick={() => setView('chart')}>
            Chart
          </Button>
          <Button size="sm" variant={view === 'table' ? 'secondary' : 'ghost'} aria-pressed={view === 'table'} onClick={() => setView('table')}>
            Table
          </Button>
        </div>
      </div>

      {view === 'chart' ? (
        <ChartView series={ready} from={props.from} to={props.to} periodMs={props.periodMs} loading={props.series.some((series) => series.state.kind === 'loading')} />
      ) : (
        <TableView series={ready} />
      )}

      <Failures series={props.series} />
    </figure>
  );
}

function Legend(props: { readonly series: ReadonlyArray<ChartSeriesView>; readonly bothAxes: boolean }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {props.series.map((series) => (
        <li key={series.id} className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ backgroundColor: color(series.colorSlot) }} />
          <span>{series.label}</span>
          {props.bothAxes && series.axis === 'right' ? <span className="text-muted-foreground">(right axis)</span> : null}
          {series.state.kind === 'loading' ? <Spinner className="size-3 text-muted-foreground" /> : null}
          {series.state.kind === 'error' ? <AlertTriangle aria-label="Could not be read" className="size-3 text-destructive" /> : null}
        </li>
      ))}
    </ul>
  );
}

function Failures(props: { readonly series: ReadonlyArray<ChartSeriesView> }) {
  const failed = props.series.flatMap((series) =>
    series.state.kind === 'error' ? [{ id: series.id, label: series.label, message: series.state.message, retry: series.state.retry }] : [],
  );
  if (failed.length === 0) {
    return null;
  }
  return (
    <ul className="space-y-1 text-xs">
      {failed.map((failure) => (
        <li key={failure.id} className="flex gap-1.5">
          <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0 text-destructive" />
          <span>
            <span className="font-medium">{failure.label}</span> <span className="text-muted-foreground">{failure.message}</span>
            {failure.retry === undefined ? null : (
              <Button variant="link" size="sm" className="ml-1 h-auto p-0 text-xs" onClick={failure.retry}>
                Try again
              </Button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface ChartViewProps {
  readonly series: ReadonlyArray<ReadySeries>;
  readonly from: number;
  readonly to: number;
  readonly periodMs: number;
  readonly loading: boolean;
}

function ChartView(props: ChartViewProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const { series, from, to, periodMs } = props;
  const model = useMemo(() => (width === 0 ? undefined : buildChartModel({ series, from, to, periodMs, width, height: HEIGHT })), [series, from, to, periodMs, width]);
  const hasData = series.some((candidate) => candidate.datapoints.length > 0);

  return (
    <div className="space-y-2">
      {/* Always mounted, so it is measured before there is anything to draw in it. */}
      <div ref={ref} className="relative" style={{ height: HEIGHT }}>
        {!hasData ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{props.loading ? <Spinner /> : 'No data in this range.'}</div>
        ) : model === undefined ? null : (
          <>
            <Plot model={model} series={series} from={from} to={to} />
            <Readout model={model} series={series} />
          </>
        )}
      </div>
      {model === undefined ? null : <MixedUnits model={model} />}
    </div>
  );
}

interface PlotProps {
  readonly model: ChartModel;
  readonly series: ReadonlyArray<ReadySeries>;
  readonly from: number;
  readonly to: number;
}

/** Everything that stands still. Memoised, so it is redrawn when the model changes and not on hover. */
const Plot = memo(function Plot({ model, series, from, to }: PlotProps) {
  const { plot } = model;
  return (
    <svg
      width={model.width}
      height={model.height}
      className="absolute inset-0"
      role="img"
      aria-label={`${series.length === 1 ? series[0].label : `${series.length} series`} from ${formatBucket(from)} to ${formatBucket(to)}. The table view lists every value.`}
    >
      {model.gridlines.map((y) => (
        <line key={y} x1={plot.left} x2={plot.right} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} shapeRendering="crispEdges" />
      ))}

      {model.axes.map((axis) =>
        axis.ticks.map((tick) => (
          <text
            key={`${axis.side}:${tick.position}`}
            x={axis.side === 'left' ? plot.left - 8 : plot.right + 8}
            y={tick.position}
            dy="0.32em"
            textAnchor={axis.side === 'left' ? 'end' : 'start'}
            className="tabular fill-muted-foreground text-[11px]"
          >
            {tick.label}
          </text>
        )),
      )}

      {model.xTicks.map((tick) => (
        <text key={tick.position} x={tick.position} y={model.height - 6} textAnchor={tick.anchor} className="tabular fill-muted-foreground text-[11px]">
          {tick.label}
        </text>
      ))}

      {model.series.map((path, index) => (
        <g key={path.id}>
          {path.area === undefined ? null : <path d={path.area} fill={color(series[index].colorSlot)} fillOpacity={0.1} />}
          <path d={path.line} fill="none" stroke={color(series[index].colorSlot)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {path.dots.map((dot) => (
            <circle key={dot.x} cx={dot.x} cy={dot.y} r={4} fill={color(series[index].colorSlot)} stroke="var(--card)" strokeWidth={2} />
          ))}
        </g>
      ))}
    </svg>
  );
});

/**
 * The crosshair and tooltip. The crosshair snaps to the nearest bucket, and the tooltip
 * lists every series there, so the pointer never has to land on a line.
 */
function Readout({ model, series }: { readonly model: ChartModel; readonly series: ReadonlyArray<ReadySeries> }) {
  const [hovered, setHovered] = useState<number | undefined>(undefined);
  const last = model.buckets.length - 1;
  // A poll can return one bucket fewer than the one hovered, so the position is held
  // within the chart rather than trusted: past the end it would name no time at all.
  const index = hovered === undefined || last < 0 ? undefined : Math.min(hovered, last);

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const current = index ?? last;
    const moves: Readonly<Record<string, number>> = {
      ArrowLeft: Math.max(0, current - 1),
      ArrowRight: Math.min(last, current + 1),
      Home: 0,
      End: last,
    };
    if (event.key === 'Escape') {
      setHovered(undefined);
      return;
    }
    if (event.key in moves) {
      event.preventDefault();
      setHovered(moves[event.key]);
    }
  };

  const x = index === undefined ? undefined : model.xs[index];
  // Flipped to the left of the crosshair past the middle, so it never runs off the card.
  const flipped = x !== undefined && x > model.width / 2;

  return (
    <>
      <svg
        width={model.width}
        height={model.height}
        className="absolute inset-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        tabIndex={0}
        aria-label="Chart readout. Arrow keys move between times."
        onPointerMove={(event) => setHovered(nearestBucket(model, event.clientX - event.currentTarget.getBoundingClientRect().left))}
        onPointerLeave={() => setHovered(undefined)}
        onFocus={() => setHovered((current) => current ?? last)}
        onBlur={() => setHovered(undefined)}
        onKeyDown={onKeyDown}
      >
        {index === undefined || x === undefined ? null : (
          <g>
            <line x1={x} x2={x} y1={model.plot.top} y2={model.plot.bottom} stroke="var(--muted-foreground)" strokeOpacity={0.6} strokeWidth={1} shapeRendering="crispEdges" />
            {model.series.map((path, position) => {
              const y = path.ys[index];
              return y === undefined ? null : <circle key={path.id} cx={x} cy={y} r={4} fill={color(series[position].colorSlot)} stroke="var(--card)" strokeWidth={2} />;
            })}
          </g>
        )}
      </svg>

      <div
        aria-live="polite"
        className={cn(
          'pointer-events-none absolute z-10 min-w-40 rounded-md border border-border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md',
          index === undefined && 'sr-only',
        )}
        style={x === undefined ? undefined : { left: flipped ? x - 12 : x + 12, top: model.plot.top, transform: flipped ? 'translateX(-100%)' : undefined }}
      >
        {index === undefined ? null : (
          <>
            <p className="mb-1.5 text-muted-foreground">{formatBucket(model.buckets[index])}</p>
            <ul className="space-y-1">
              {series.map((candidate, position) => {
                const value = model.series[position].values[index];
                return (
                  <li key={candidate.id} className="flex items-center gap-2">
                    <span aria-hidden className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: color(candidate.colorSlot) }} />
                    <span className="tabular font-semibold">{value === undefined ? NA : formatMetricValue(value, candidate.unit)}</span>
                    <span className="truncate text-muted-foreground">{candidate.label}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </>
  );
}

function MixedUnits({ model }: { readonly model: ChartModel }) {
  const mixed = model.axes.filter((axis) => axis.units.length > 1);
  if (mixed.length === 0) {
    return null;
  }
  return (
    <ul className="space-y-1 text-xs text-muted-foreground">
      {mixed.map((axis) => (
        <li key={axis.side} className="flex gap-1.5">
          <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0 text-warning" />
          The {axis.side} axis has series in {axis.units.join(' and ')}, which cannot share a scale, so its labels are bare numbers. Move one to the{' '}
          {axis.side === 'left' ? 'right' : 'left'} axis.
        </li>
      ))}
    </ul>
  );
}

/** The chart's twin for anyone who cannot tell its colours apart or read a value off a line. */
function TableView({ series }: { readonly series: ReadonlyArray<ReadySeries> }) {
  const rows = useMemo(() => {
    const byTime = new Map<number, Map<string, number>>();
    for (const candidate of series) {
      for (const point of candidate.datapoints) {
        const row = byTime.get(point.timestamp) ?? new Map<string, number>();
        row.set(candidate.id, point.value);
        byTime.set(point.timestamp, row);
      }
    }
    // Newest first, which is what someone opening the table is usually after.
    return Array.from(byTime.entries()).sort((left, right) => right[0] - left[0]);
  }, [series]);

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height: HEIGHT }}>
        No data in this range.
      </div>
    );
  }

  return (
    <div className="scrollbar-thin overflow-auto rounded-md border border-border" style={{ maxHeight: HEIGHT }}>
      <Table>
        <TableHeader className="sticky top-0 bg-card">
          <TableRow>
            <TableHead>Time</TableHead>
            {series.map((candidate) => (
              // Metric names are case-sensitive, so they are not shouted like the other headers.
              <TableHead key={candidate.id} className="text-right normal-case tracking-normal">
                {candidate.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(([timestamp, values]) => (
            <TableRow key={timestamp}>
              <TableCell className="tabular whitespace-nowrap text-muted-foreground">{formatBucket(timestamp)}</TableCell>
              {series.map((candidate) => {
                const value = values.get(candidate.id);
                return (
                  <TableCell key={candidate.id} className="tabular text-right">
                    {value === undefined ? NA : formatMetricValue(value, candidate.unit)}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
