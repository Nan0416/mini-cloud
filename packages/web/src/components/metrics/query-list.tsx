import { METRIC_STATISTICS, type MetricAxis, type MetricQuery, type MetricUnit } from '@mini-cloud/shared';
import { X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { axisAccepts, describeDimensions, isSameMetric, labelOf, type AxisUnits } from '@/lib/metric-graph-editor';

export interface QueryListProps {
  readonly queries: ReadonlyArray<MetricQuery>;
  readonly colors: ReadonlyArray<number>;
  /** Each query's unit, once its data has said; `undefined` until then. */
  readonly units: ReadonlyArray<MetricUnit | undefined>;
  readonly axisUnits: AxisUnits;
  /** By id and by what changed, so an edit made since the last render is not undone. */
  readonly onChange: (id: string, change: Partial<MetricQuery>) => void;
  readonly onRemove: (id: string) => void;
}

/**
 * The series on a graph. What a series reads is fixed once added; changing the metric
 * is removing it and adding another, so a query is never half-chosen.
 */
export function QueryList(props: QueryListProps) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Metric</TableHead>
            <TableHead className="w-32">Statistic</TableHead>
            <TableHead className="min-w-48">Label</TableHead>
            <TableHead className="w-28">Axis</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.queries.map((query, index) => (
            <QueryRow
              key={query.id}
              query={query}
              queries={props.queries}
              color={props.colors[index]}
              unit={props.units[index]}
              axisUnits={props.axisUnits}
              onChange={(change) => props.onChange(query.id, change)}
              onRemove={() => props.onRemove(query.id)}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

interface QueryRowProps {
  readonly query: MetricQuery;
  /** Every row, to tell which statistics another row already reads. */
  readonly queries: ReadonlyArray<MetricQuery>;
  readonly color: number;
  readonly unit: MetricUnit | undefined;
  readonly axisUnits: AxisUnits;
  readonly onChange: (change: Partial<MetricQuery>) => void;
  readonly onRemove: () => void;
}

function QueryRow(props: QueryRowProps) {
  const { query } = props;
  const axis = query.yAxis ?? 'left';
  // Statistics another row already reads of this metric: choosing one would leave two
  // rows on one series, which the graph cannot hold.
  const taken = new Set(props.queries.filter((candidate) => candidate.id !== query.id && isSameMetric(candidate, query)).map((candidate) => candidate.statistic));
  // An axis already reading another kind of unit is not offered: the series would have no scale.
  const accepts = (candidate: MetricAxis): boolean => candidate === axis || props.unit === undefined || axisAccepts(props.unit, candidate, props.axisUnits);

  return (
    <TableRow>
      <TableCell>
        <span aria-hidden className="block h-0.5 w-4 rounded-full" style={{ backgroundColor: `var(--chart-${props.color})` }} />
      </TableCell>
      <TableCell className="min-w-56">
        <div className="font-medium">{query.metricName}</div>
        <div className="text-xs text-muted-foreground">
          {query.namespace} · {describeDimensions(query.dimensions)}
          {props.unit === undefined ? null : ` · ${props.unit}`}
        </div>
      </TableCell>
      <TableCell>
        <Select value={query.statistic} onValueChange={(value) => props.onChange({ statistic: METRIC_STATISTICS.find((candidate) => candidate === value) ?? query.statistic })}>
          <SelectTrigger aria-label={`Statistic for ${labelOf(query)}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METRIC_STATISTICS.map((candidate) => (
              // A statistic another row already reads would make two rows one series.
              <SelectItem key={candidate} value={candidate} disabled={taken.has(candidate)}>
                {candidate}
                {taken.has(candidate) ? ' (already on the graph)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <LabelInput query={query} onCommit={(label) => props.onChange({ label })} />
      </TableCell>
      <TableCell>
        <Select value={axis} onValueChange={(value) => props.onChange({ yAxis: value === 'right' ? 'right' : undefined })}>
          <SelectTrigger aria-label={`Axis for ${labelOf(query)}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="left" disabled={!accepts('left')}>
              Left
            </SelectItem>
            <SelectItem value="right" disabled={!accepts('right')}>
              Right
            </SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Button size="icon-sm" variant="ghost" aria-label={`Remove ${labelOf(query)}`} onClick={props.onRemove}>
          <X />
        </Button>
      </TableCell>
    </TableRow>
  );
}

/**
 * Held locally and written to the link on blur or Enter. Written a keystroke at a time,
 * each one would be a navigation, and a navigation runs as a transition that can land
 * after the next keystroke and put back what was just typed.
 *
 * Seeded again when it is focused rather than remounted when it saves: remounting on
 * save takes the focus away mid-edit and loses anything typed since.
 */
function LabelInput(props: { readonly query: MetricQuery; readonly onCommit: (label: string | undefined) => void }) {
  const [value, setValue] = useState(props.query.label ?? '');

  const commit = () => {
    const label = value.trim() === '' ? undefined : value.trim();
    if (label !== props.query.label) {
      props.onCommit(label);
    }
  };

  return (
    <Input
      value={value}
      placeholder={labelOf({ ...props.query, label: undefined })}
      aria-label={`Label for ${labelOf(props.query)}`}
      onChange={(event) => setValue(event.target.value)}
      onFocus={() => setValue(props.query.label ?? '')}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit();
        }
      }}
    />
  );
}
