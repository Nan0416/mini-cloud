import type { MetricDatapoint, MetricUnit } from '@mini-cloud/shared';
import { useId, useState } from 'react';

export interface MetricChartProps {
  readonly datapoints: ReadonlyArray<MetricDatapoint>;
  readonly unit: MetricUnit;
  readonly periodMs: number;
}

const VIEW_WIDTH = 900;
const VIEW_HEIGHT = 260;
const PADDING = { top: 16, right: 16, bottom: 28, left: 56 };

const PLOT_WIDTH = VIEW_WIDTH - PADDING.left - PADDING.right;
const PLOT_HEIGHT = VIEW_HEIGHT - PADDING.top - PADDING.bottom;

/** Short enough for an axis label, and honest about the magnitude. */
function formatValue(value: number, unit: MetricUnit): string {
  if (unit === 'Bytes') {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let scaled = value;
    let index = 0;
    while (Math.abs(scaled) >= 1024 && index < units.length - 1) {
      scaled /= 1024;
      index += 1;
    }
    return `${scaled.toFixed(scaled >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
  }
  if (Math.abs(value) >= 10_000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(2);
}

function formatTime(timestamp: number, periodMs: number): string {
  const date = new Date(timestamp);
  // A day-wide bucket has no meaningful time of day, so the label is the date.
  if (periodMs >= 86_400_000) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Rounds the top of the axis up to something a person would have chosen.
 *
 * An axis that ends at the highest observation puts the peak exactly on the frame,
 * which reads as clipped rather than as the maximum.
 */
function niceCeiling(value: number): number {
  if (value <= 0) {
    return 1;
  }
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * A time series, drawn as inline SVG.
 *
 * Hand-drawn rather than pulled from a charting library so that every colour is one
 * of the console's own tokens and light and dark are handled by the same stylesheet
 * as the rest of the page. It is a line, a filled area and a hover readout — the
 * shapes this data actually needs.
 */
export function MetricChart(props: MetricChartProps) {
  const gradientId = useId();
  const [hovered, setHovered] = useState<number | undefined>(undefined);

  const points = props.datapoints;
  if (points.length === 0) {
    return <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">No data in this range.</div>;
  }

  const first = points[0].timestamp;
  const last = points[points.length - 1].timestamp;
  // A single point has no span to scale across, so it is drawn at the left edge.
  const span = last - first === 0 ? 1 : last - first;

  const highest = Math.max(...points.map((point) => point.value));
  const lowest = Math.min(...points.map((point) => point.value), 0);
  const top = niceCeiling(highest === lowest ? highest + 1 : highest);
  const range = top - lowest === 0 ? 1 : top - lowest;

  const x = (timestamp: number): number => PADDING.left + ((timestamp - first) / span) * PLOT_WIDTH;
  const y = (value: number): number => PADDING.top + PLOT_HEIGHT - ((value - lowest) / range) * PLOT_HEIGHT;

  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.timestamp).toFixed(2)} ${y(point.value).toFixed(2)}`).join(' ');
  const area = `${line} L ${x(last).toFixed(2)} ${(PADDING.top + PLOT_HEIGHT).toFixed(2)} L ${x(first).toFixed(2)} ${(PADDING.top + PLOT_HEIGHT).toFixed(2)} Z`;

  const gridValues = [lowest, lowest + range / 2, top];
  // Deduplicated by timestamp: with exactly two datapoints the midpoint and the last
  // are the same element, which renders twice under the same React key.
  const labelled = new Map(
    (points.length === 1 ? [points[0]] : [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]]).map((point) => [point.timestamp, point]),
  );
  const timeLabels = Array.from(labelled.values());
  const active = hovered === undefined ? undefined : points[hovered];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="h-[260px] w-full"
        role="img"
        aria-label={`Time series of ${points.length} points`}
        onMouseLeave={() => setHovered(undefined)}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const position = ((event.clientX - box.left) / box.width) * VIEW_WIDTH;
          const timestamp = first + ((position - PADDING.left) / PLOT_WIDTH) * span;
          let nearest = 0;
          for (let index = 1; index < points.length; index += 1) {
            if (Math.abs(points[index].timestamp - timestamp) < Math.abs(points[nearest].timestamp - timestamp)) {
              nearest = index;
            }
          }
          setHovered(nearest);
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridValues.map((value) => (
          <g key={value}>
            <line x1={PADDING.left} y1={y(value)} x2={VIEW_WIDTH - PADDING.right} y2={y(value)} stroke="var(--border)" strokeWidth="1" />
            <text x={PADDING.left - 8} y={y(value) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
              {formatValue(value, props.unit)}
            </text>
          </g>
        ))}

        {timeLabels.map((point) => (
          <text key={point.timestamp} x={x(point.timestamp)} y={VIEW_HEIGHT - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
            {formatTime(point.timestamp, props.periodMs)}
          </text>
        ))}

        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {/* A lone point would be invisible as a line, so it is drawn as a dot. */}
        {points.length === 1 ? <circle cx={x(points[0].timestamp)} cy={y(points[0].value)} r="3.5" fill="var(--primary)" /> : null}

        {active === undefined ? null : (
          <g>
            <line x1={x(active.timestamp)} y1={PADDING.top} x2={x(active.timestamp)} y2={PADDING.top + PLOT_HEIGHT} stroke="var(--border)" strokeWidth="1" />
            <circle cx={x(active.timestamp)} cy={y(active.value)} r="4" fill="var(--primary)" stroke="var(--background)" strokeWidth="2" />
          </g>
        )}
      </svg>

      {active === undefined ? null : (
        <div className="pointer-events-none absolute left-0 top-0 rounded-md border border-border bg-background/95 px-2 py-1 text-xs shadow-sm">
          <span className="font-medium">{formatValue(active.value, props.unit)}</span>
          <span className="text-muted-foreground"> · {new Date(active.timestamp).toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}
