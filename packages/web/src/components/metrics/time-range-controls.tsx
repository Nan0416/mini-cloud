import { autoPeriodFor, spanOf, type MetricTimeRange } from '@mini-cloud/shared';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatBucket } from '@/lib/chart-model';
import { formatDuration, localDateTimeToTimestamp, timestampToLocalDateTime } from '@/lib/format';
import { periodProblem } from '@/lib/metric-graph-editor';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const PRESETS = [
  { label: '1h', durationMs: HOUR },
  { label: '3h', durationMs: 3 * HOUR },
  { label: '12h', durationMs: 12 * HOUR },
  { label: '1d', durationMs: DAY },
  { label: '3d', durationMs: 3 * DAY },
  { label: '1w', durationMs: 7 * DAY },
  { label: '4w', durationMs: 28 * DAY },
] as const;

const PERIODS = [MINUTE, 5 * MINUTE, 15 * MINUTE, HOUR, 6 * HOUR, DAY];

const AUTO = 'auto';

interface TimeWindow {
  readonly from: number;
  readonly to: number;
}

export interface TimeRangeControlsProps {
  readonly range: MetricTimeRange;
  /** The graph's chosen period; `undefined` is automatic. */
  readonly periodMs: number | undefined;
  readonly onRangeChange: (range: MetricTimeRange) => void;
  readonly onPeriodChange: (periodMs: number | undefined) => void;
}

/** One row above the chart, because the range scopes every series on it. */
export function TimeRangeControls(props: TimeRangeControlsProps) {
  // The custom form's starting values, set when it opens; `undefined` while it is closed.
  const [custom, setCustom] = useState<TimeWindow | undefined>(undefined);
  const { range } = props;
  const span = spanOf(range);
  // A link's period need not be one of the offered ones, and a picker without it shows blank.
  const periods = props.periodMs === undefined || PERIODS.includes(props.periodMs) ? PERIODS : [...PERIODS, props.periodMs].sort((left, right) => left - right);

  const openCustom = () => {
    if (range.kind === 'absolute') {
      setCustom({ from: range.from, to: range.to });
      return;
    }
    const now = Date.now();
    setCustom({ from: now - range.durationMs, to: now });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Time range" className="flex flex-wrap gap-0.5 rounded-md border border-border p-0.5">
          {PRESETS.map((preset) => {
            const selected = range.kind === 'relative' && range.durationMs === preset.durationMs;
            return (
              <Button
                key={preset.label}
                size="sm"
                variant={selected ? 'secondary' : 'ghost'}
                aria-pressed={selected}
                className="h-7 px-2.5"
                onClick={() => {
                  setCustom(undefined);
                  props.onRangeChange({ kind: 'relative', durationMs: preset.durationMs });
                }}
              >
                {preset.label}
              </Button>
            );
          })}
          <Button size="sm" variant={range.kind === 'absolute' ? 'secondary' : 'ghost'} aria-pressed={range.kind === 'absolute'} className="h-7 px-2.5" onClick={openCustom}>
            Custom
          </Button>
        </div>

        {range.kind === 'absolute' ? (
          <span className="tabular text-sm text-muted-foreground">
            {formatBucket(range.from)} – {formatBucket(range.to)}
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <Label htmlFor="metric-period" className="text-muted-foreground">
            Period
          </Label>
          <Select value={props.periodMs === undefined ? AUTO : String(props.periodMs)} onValueChange={(value) => props.onPeriodChange(value === AUTO ? undefined : Number(value))}>
            <SelectTrigger id="metric-period" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>Auto ({formatDuration(autoPeriodFor(span))})</SelectItem>
              {periods.map((periodMs) => {
                const problem = periodProblem(span, periodMs);
                return (
                  <SelectItem key={periodMs} value={String(periodMs)} disabled={problem !== undefined}>
                    {formatDuration(periodMs)}
                    {problem === undefined ? '' : ` (${problem})`}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      </div>

      {custom === undefined ? null : (
        <CustomRange
          key={`${custom.from}:${custom.to}`}
          initial={custom}
          onApply={(window) => {
            setCustom(undefined);
            props.onRangeChange({ kind: 'absolute', ...window });
          }}
          onCancel={() => setCustom(undefined)}
        />
      )}
    </div>
  );
}

interface CustomRangeProps {
  readonly initial: TimeWindow;
  readonly onApply: (window: TimeWindow) => void;
  readonly onCancel: () => void;
}

/** Seeded once, on mount, so a poll landing mid-edit cannot overwrite what is being typed. */
function CustomRange(props: CustomRangeProps) {
  // Whole minutes, which is what the inputs step by: a seed with seconds would fail their validation.
  const [from, setFrom] = useState(() => timestampToLocalDateTime(Math.floor(props.initial.from / MINUTE) * MINUTE));
  const [to, setTo] = useState(() => timestampToLocalDateTime(Math.floor(props.initial.to / MINUTE) * MINUTE));

  const fromMs = localDateTimeToTimestamp(from);
  const toMs = localDateTimeToTimestamp(to);
  const problem = fromMs === undefined || toMs === undefined ? 'Enter both a start and an end.' : fromMs >= toMs ? 'The start must be before the end.' : undefined;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (fromMs !== undefined && toMs !== undefined && fromMs < toMs) {
      props.onApply({ from: fromMs, to: toMs });
    }
  };

  return (
    <form className="flex flex-wrap items-end gap-3 rounded-md border border-border p-3" onSubmit={submit}>
      <div className="space-y-1.5">
        <Label htmlFor="metric-from">From</Label>
        <Input id="metric-from" type="datetime-local" step={60} value={from} onChange={(event) => setFrom(event.target.value)} className="w-56" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="metric-to">To</Label>
        <Input id="metric-to" type="datetime-local" step={60} value={to} onChange={(event) => setTo(event.target.value)} className="w-56" />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={problem !== undefined}>
          Apply
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
      {problem === undefined ? null : <p className="w-full text-xs text-muted-foreground">{problem}</p>}
    </form>
  );
}
