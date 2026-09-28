import {
  METRIC_STATISTICS,
  MONITOR_COMPARISONS,
  MONITOR_LIMITS,
  TREAT_MISSING_DATA,
  assertMonitorName,
  hashDimensions,
  parseDimensionsHash,
  type MonitorDefinition,
  type MonitorMetric,
} from '@mini-cloud/shared';
import { useMemo, useState, type FormEvent } from 'react';
import { FormField } from '@/components/common/form-field';
import { Spinner } from '@/components/common/states';
import { MonitorChart } from '@/components/monitor/monitor-chart';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useMetricDimensions, useMetricNames, useMetricNamespaces } from '@/hooks/use-metrics';
import { formatDuration } from '@/lib/format';
import { describeDimensions } from '@/lib/metric-graph-editor';
import {
  COMPARISON_LABELS,
  MONITOR_PERIODS,
  TREAT_MISSING_DATA_LABELS,
  defaultMonitorWindow,
  definitionOf,
  maxEvaluationPeriods,
  type MonitorFormValues,
} from '@/lib/monitor-editor';

export interface MonitorFormProps {
  readonly mode: 'create' | 'edit';
  readonly initial: MonitorFormValues;
  readonly isSubmitting: boolean;
  readonly submitError?: string;
  readonly onCancel: () => void;
  /** `name` is what was typed on create; on edit the page already knows it. */
  readonly onSubmit: (name: string, definition: MonitorDefinition) => void;
}

function nameProblem(name: string): string | undefined {
  try {
    assertMonitorName(name, 'The name');
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Seeded once, on mount: the edit page mounts it only after the monitor has loaded, so a
 * poll can never overwrite what is being typed.
 */
export function MonitorForm(props: MonitorFormProps) {
  const [values, setValues] = useState<MonitorFormValues>(props.initial);
  const [name, setName] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const patch = (change: Partial<MonitorFormValues>) => setValues((current) => ({ ...current, ...change }));

  const namespaces = useMetricNamespaces();
  const names = useMetricNames(values.namespace);
  const dimensions = useMetricDimensions(values.namespace, values.metricName);
  const dimensionSets = dimensions.data?.dimensionSets ?? [];

  const result = definitionOf(values);
  const namingProblem = props.mode === 'create' ? nameProblem(name) : undefined;
  const problem = namingProblem ?? result.problem;

  // Previewed as soon as a series is chosen, with the line added once there is a threshold to draw.
  const metric = useMemo((): MonitorMetric | undefined => {
    if (values.namespace === undefined || values.metricName === undefined || values.dimensionsHash === undefined) {
      return undefined;
    }
    return { namespace: values.namespace, metricName: values.metricName, dimensions: parseDimensionsHash(values.dimensionsHash), statistic: values.statistic };
  }, [values.namespace, values.metricName, values.dimensionsHash, values.statistic]);
  const typedN = Number(values.evaluationPeriods);
  const previewWindow = useMemo(
    () => defaultMonitorWindow({ periodMs: values.periodMs, evaluationPeriods: Number.isInteger(typedN) && typedN > 0 ? typedN : 1 }),
    [values.periodMs, typedN],
  );
  const typedThreshold = values.threshold.trim().length === 0 ? undefined : Number(values.threshold);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setShowErrors(true);
    if (problem === undefined && result.definition !== undefined) {
      props.onSubmit(name, result.definition);
    }
  };

  return (
    <form className="max-w-5xl space-y-6" onSubmit={submit}>
      {props.submitError === undefined ? null : (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{props.submitError}</div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Metric</CardTitle>
          <CardDescription>The series to watch, and the statistic of it that is compared with the threshold.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            {props.mode === 'create' ? (
              <FormField
                label="Name"
                htmlFor="monitor-name"
                error={showErrors ? namingProblem : undefined}
                hint="Letters, digits, hyphens and underscores. It cannot be changed later."
              >
                <Input id="monitor-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="nas-cpu-high" maxLength={MONITOR_LIMITS.nameLength} />
              </FormField>
            ) : null}
            <FormField label="Description" htmlFor="monitor-description" optional>
              <Textarea
                id="monitor-description"
                rows={1}
                value={values.description}
                onChange={(event) => patch({ description: event.target.value })}
                maxLength={MONITOR_LIMITS.descriptionLength}
              />
            </FormField>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Namespace" htmlFor="monitor-namespace">
              <Select value={values.namespace} onValueChange={(namespace) => patch({ namespace, metricName: undefined, dimensionsHash: undefined })}>
                <SelectTrigger id="monitor-namespace">
                  <SelectValue placeholder="Choose a namespace" />
                </SelectTrigger>
                <SelectContent>
                  {(namespaces.data?.namespaces ?? []).map((namespace) => (
                    <SelectItem key={namespace} value={namespace}>
                      {namespace}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Metric" htmlFor="monitor-metric">
              <Select value={values.metricName} onValueChange={(metricName) => patch({ metricName, dimensionsHash: undefined })} disabled={values.namespace === undefined}>
                <SelectTrigger id="monitor-metric">
                  <SelectValue placeholder="Choose a metric" />
                </SelectTrigger>
                <SelectContent>
                  {(names.data?.metrics ?? []).map((summary) => (
                    <SelectItem key={summary.metricName} value={summary.metricName}>
                      {summary.metricName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Dimensions" htmlFor="monitor-dimensions">
              <Select value={values.dimensionsHash} onValueChange={(dimensionsHash) => patch({ dimensionsHash })} disabled={values.metricName === undefined}>
                <SelectTrigger id="monitor-dimensions">
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
            </FormField>
            <FormField label="Statistic" htmlFor="monitor-statistic">
              <Select
                value={values.statistic}
                onValueChange={(statistic) => patch({ statistic: METRIC_STATISTICS.find((candidate) => candidate === statistic) ?? values.statistic })}
              >
                <SelectTrigger id="monitor-statistic">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METRIC_STATISTICS.map((statistic) => (
                    <SelectItem key={statistic} value={statistic}>
                      {statistic}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>

          {metric === undefined ? (
            <p className="text-sm text-muted-foreground">Choose a metric to see it graphed here, with the threshold drawn across it.</p>
          ) : (
            <MonitorChart metric={metric} threshold={typedThreshold !== undefined && Number.isFinite(typedThreshold) ? typedThreshold : undefined} window={previewWindow} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Condition</CardTitle>
          <CardDescription>In alarm when at least this many of the most recent periods breach the threshold. Evaluated every minute.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Comparison" htmlFor="monitor-comparison">
              <Select
                value={values.comparison}
                onValueChange={(comparison) => patch({ comparison: MONITOR_COMPARISONS.find((candidate) => candidate === comparison) ?? values.comparison })}
              >
                <SelectTrigger id="monitor-comparison">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONITOR_COMPARISONS.map((comparison) => (
                    <SelectItem key={comparison} value={comparison}>
                      {COMPARISON_LABELS[comparison]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Threshold" htmlFor="monitor-threshold" hint="In the metric's own unit.">
              <Input id="monitor-threshold" inputMode="decimal" value={values.threshold} onChange={(event) => patch({ threshold: event.target.value })} className="tabular" />
            </FormField>
            <FormField label="Period" htmlFor="monitor-period">
              <Select value={String(values.periodMs)} onValueChange={(period) => patch({ periodMs: Number(period) })}>
                <SelectTrigger id="monitor-period">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONITOR_PERIODS.map((periodMs) => (
                    <SelectItem key={periodMs} value={String(periodMs)}>
                      {formatDuration(periodMs)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Breaching" htmlFor="monitor-m">
                <Input
                  id="monitor-m"
                  type="number"
                  min={1}
                  value={values.datapointsToAlarm}
                  onChange={(event) => patch({ datapointsToAlarm: event.target.value })}
                  className="tabular"
                />
              </FormField>
              <FormField label="Out of" htmlFor="monitor-n">
                <Input
                  id="monitor-n"
                  type="number"
                  min={1}
                  max={maxEvaluationPeriods(values.periodMs)}
                  value={values.evaluationPeriods}
                  onChange={(event) => patch({ evaluationPeriods: event.target.value })}
                  className="tabular"
                />
              </FormField>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="Missing data" htmlFor="monitor-missing" hint={TREAT_MISSING_DATA_LABELS[values.treatMissingData].description}>
              <Select
                value={values.treatMissingData}
                onValueChange={(treatment) => patch({ treatMissingData: TREAT_MISSING_DATA.find((candidate) => candidate === treatment) ?? values.treatMissingData })}
              >
                <SelectTrigger id="monitor-missing">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TREAT_MISSING_DATA.map((treatment) => (
                    <SelectItem key={treatment} value={treatment}>
                      {TREAT_MISSING_DATA_LABELS[treatment].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Notifications" htmlFor="monitor-notify" hint="Evaluated and recorded either way; this only decides whether a change is sent on.">
              <label className="flex h-9 items-center gap-2 text-sm">
                <Switch id="monitor-notify" checked={values.notify} onCheckedChange={(notify) => patch({ notify })} />
                {values.notify ? 'Notify on every change of state' : 'Do not notify'}
              </label>
            </FormField>
          </div>

          {showErrors && problem !== undefined ? <p className="text-sm text-destructive">{problem}</p> : null}
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={props.onCancel} disabled={props.isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={props.isSubmitting || (showErrors && problem !== undefined)}>
          {props.isSubmitting ? <Spinner /> : null}
          {props.mode === 'create' ? 'Create monitor' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
