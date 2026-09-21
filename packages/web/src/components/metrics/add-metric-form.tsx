import { METRIC_GRAPH_LIMITS, METRIC_STATISTICS, hashDimensions, type MetricDimensions, type MetricQuery, type MetricStatistic } from '@mini-cloud/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMetricDimensions, useMetricNames, useMetricNamespaces } from '@/hooks/use-metrics';
import { axisFor, nextColor, nextQueryId, type AxisUnits } from '@/lib/metric-graph-editor';

/** How a dimension set reads in a picker. The empty set is a series too. */
function describeDimensions(dimensions: MetricDimensions): string {
  const entries = Object.entries(dimensions);
  if (entries.length === 0) {
    return 'No dimensions';
  }
  return entries.map(([name, value]) => `${name}=${value}`).join(', ');
}

export interface AddMetricFormProps {
  readonly queries: ReadonlyArray<MetricQuery>;
  readonly axisUnits: AxisUnits;
  readonly onAdd: (query: MetricQuery) => void;
}

/**
 * Picks a namespace, a metric, one of its dimension sets and a statistic, and adds the
 * series. Each choice falls back to the first option until one is made, so the form is
 * always a complete query once the lists have loaded.
 */
export function AddMetricForm(props: AddMetricFormProps) {
  const [namespace, setNamespace] = useState<string | undefined>(undefined);
  const [metricName, setMetricName] = useState<string | undefined>(undefined);
  const [dimensionsHash, setDimensionsHash] = useState<string | undefined>(undefined);
  const [statistic, setStatistic] = useState<MetricStatistic>('avg');

  const namespaces = useMetricNamespaces();
  const selectedNamespace = namespace ?? namespaces.data?.namespaces[0];

  const names = useMetricNames(selectedNamespace);
  const selectedMetric = metricName ?? names.data?.metrics[0]?.metricName;
  const summary = names.data?.metrics.find((candidate) => candidate.metricName === selectedMetric);

  const dimensions = useMetricDimensions(selectedNamespace, selectedMetric);
  const dimensionSets = dimensions.data?.dimensionSets ?? [];
  const selectedSet = dimensionSets.find((set) => hashDimensions(set) === dimensionsHash) ?? dimensionSets[0];

  const axis = summary === undefined ? undefined : axisFor(summary.unit, props.axisUnits);
  const full = props.queries.length >= METRIC_GRAPH_LIMITS.queries;
  const refusal = full
    ? `A graph holds ${METRIC_GRAPH_LIMITS.queries} series, one per colour. Remove one, or start another graph.`
    : summary !== undefined && axis === undefined
      ? `This graph reads ${props.axisUnits.left.join(', ')} on the left and ${props.axisUnits.right.join(', ')} on the right, and ${summary.unit} can share neither scale. Start another graph for it.`
      : undefined;

  const add = () => {
    if (selectedNamespace === undefined || selectedMetric === undefined || selectedSet === undefined || axis === undefined || full) {
      return;
    }
    props.onAdd({
      id: nextQueryId(props.queries),
      namespace: selectedNamespace,
      metricName: selectedMetric,
      dimensions: selectedSet,
      statistic,
      color: nextColor(props.queries),
      yAxis: axis === 'right' ? 'right' : undefined,
    });
  };

  return (
    <div className="space-y-2">
      <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_8rem_auto]">
        <div className="space-y-1.5">
          <Label htmlFor="add-metric-namespace">Namespace</Label>
          <Select
            value={selectedNamespace ?? ''}
            onValueChange={(value) => {
              setNamespace(value);
              // A metric belongs to its namespace, so both choices below fall back to
              // the new namespace's first option.
              setMetricName(undefined);
              setDimensionsHash(undefined);
            }}
          >
            <SelectTrigger id="add-metric-namespace">
              <SelectValue placeholder="Choose a namespace" />
            </SelectTrigger>
            <SelectContent>
              {(namespaces.data?.namespaces ?? []).map((candidate) => (
                <SelectItem key={candidate} value={candidate}>
                  {candidate}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="add-metric-name">Metric</Label>
          <Select
            value={selectedMetric ?? ''}
            onValueChange={(value) => {
              setMetricName(value);
              setDimensionsHash(undefined);
            }}
          >
            <SelectTrigger id="add-metric-name">
              <SelectValue placeholder="Choose a metric" />
            </SelectTrigger>
            <SelectContent>
              {(names.data?.metrics ?? []).map((candidate) => (
                <SelectItem key={candidate.metricName} value={candidate.metricName}>
                  {candidate.metricName} <span className="text-muted-foreground">({candidate.unit})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="add-metric-dimensions">Dimensions</Label>
          <Select value={selectedSet === undefined ? '' : hashDimensions(selectedSet)} onValueChange={setDimensionsHash}>
            <SelectTrigger id="add-metric-dimensions">
              <SelectValue placeholder="Choose a dimension set" />
            </SelectTrigger>
            <SelectContent>
              {dimensionSets.map((set) => (
                <SelectItem key={hashDimensions(set)} value={hashDimensions(set)}>
                  {describeDimensions(set)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="add-metric-statistic">Statistic</Label>
          <Select value={statistic} onValueChange={(value) => setStatistic(METRIC_STATISTICS.find((candidate) => candidate === value) ?? 'avg')}>
            <SelectTrigger id="add-metric-statistic">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METRIC_STATISTICS.map((candidate) => (
                <SelectItem key={candidate} value={candidate}>
                  {candidate}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button onClick={add} disabled={selectedSet === undefined || axis === undefined || full}>
          <Plus />
          Add
        </Button>
      </div>
      {refusal === undefined ? null : <p className="text-xs text-muted-foreground">{refusal}</p>}
    </div>
  );
}
