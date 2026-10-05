import type { Monitor } from '@mini-cloud/shared';
import { ArrowRight, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { KeyValueGrid } from '@/components/common/key-value-grid';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common/states';
import { MonitorStateBadge, SeverityBadge } from '@/components/common/status-badge';
import { Timestamp } from '@/components/common/timestamp';
import { TimeRangeControls } from '@/components/metrics/time-range-controls';
import { MonitorChart } from '@/components/monitor/monitor-chart';
import { MonitorNotifiers } from '@/components/notifier/notifier-names';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDeleteMonitor, useMonitor, useMonitorHistory } from '@/hooks/use-monitors';
import { formatDuration } from '@/lib/format';
import { readWindow, windowSearch, withWindowRange, type GraphWindow } from '@/lib/graph-window';
import { describeDimensions } from '@/lib/metric-graph-editor';
import { COMPARISON_LABELS, TREAT_MISSING_DATA_LABELS, defaultMonitorWindow, describeCondition } from '@/lib/monitor-editor';
import { urls } from '@/lib/urls';

export function MonitorPage() {
  const name = useParams().name ?? '';
  const monitor = useMonitor(name);

  if (monitor.isPending) {
    return <LoadingRows rows={6} />;
  }
  if (monitor.isError) {
    return <ErrorState error={monitor.error} onRetry={() => void monitor.refetch()} />;
  }
  return <MonitorView monitor={monitor.data.monitor} />;
}

interface ReadWindow {
  readonly window: GraphWindow | undefined;
  readonly error: unknown;
}

function MonitorView({ monitor }: { readonly monitor: Monitor }) {
  const navigate = useNavigate();
  const { search } = useLocation();
  const remove = useDeleteMonitor();
  const [deleting, setDeleting] = useState(false);

  const fallback = useMemo(() => defaultMonitorWindow(monitor), [monitor]);
  const read = useMemo((): ReadWindow => {
    try {
      return { window: readWindow(new URLSearchParams(search), fallback), error: undefined };
    } catch (err) {
      return { window: undefined, error: err };
    }
  }, [search, fallback]);
  const showWindow = (window: GraphWindow) => void navigate({ search: windowSearch(window) });

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {monitor.name}
            <MonitorStateBadge state={monitor.state} />
            <SeverityBadge severity={monitor.severity} />
          </span>
        }
        description={monitor.description}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to={urls.editMonitor(monitor.name)}>
                <Pencil className="size-4" />
                Edit
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setDeleting(true)}>
              <Trash2 className="size-4" />
              Delete
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="space-y-1 pt-6">
          <p className="text-sm">{monitor.stateReason}</p>
          <p className="text-xs text-muted-foreground">
            {monitor.state === 'ALARM' ? 'In alarm' : monitor.state === 'OK' ? 'OK' : 'Insufficient data'} since <Timestamp value={monitor.stateChangedAt} variant="long" />. Last
            evaluated {monitor.lastEvaluatedAt === undefined ? 'never' : <Timestamp value={monitor.lastEvaluatedAt} variant="relative" />}.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {monitor.metric.statistic} of {monitor.metric.metricName}
          </CardTitle>
          <CardDescription>
            The dashed line is the threshold. The monitor judges the last {monitor.evaluationPeriods} {monitor.evaluationPeriods === 1 ? 'period' : 'periods'} of{' '}
            {formatDuration(monitor.periodMs)}; set the period to that to see the buckets it judges.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {read.window === undefined ? (
            <EmptyState
              title="This link's time window cannot be read"
              description={read.error instanceof Error ? read.error.message : String(read.error)}
              action={
                <Button asChild variant="outline">
                  <Link to={urls.monitor(monitor.name)}>Open on the default window</Link>
                </Button>
              }
            />
          ) : (
            <>
              <TimeRangeControls
                range={read.window.range}
                periodMs={read.window.periodMs}
                onRangeChange={(range) => read.window !== undefined && showWindow(withWindowRange(read.window, range))}
                onPeriodChange={(periodMs) => read.window !== undefined && showWindow({ range: read.window.range, periodMs })}
              />
              <MonitorChart metric={monitor.metric} threshold={monitor.threshold} window={read.window} />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Definition</CardTitle>
        </CardHeader>
        <CardContent>
          <KeyValueGrid
            items={[
              { label: 'Condition', value: describeCondition(monitor), wide: true },
              { label: 'Namespace', value: monitor.metric.namespace },
              { label: 'Metric', value: monitor.metric.metricName },
              { label: 'Dimensions', value: describeDimensions(monitor.metric.dimensions) },
              { label: 'Statistic', value: monitor.metric.statistic },
              { label: 'Comparison', value: COMPARISON_LABELS[monitor.comparison] },
              { label: 'Threshold', value: <span className="tabular">{monitor.threshold}</span> },
              { label: 'Missing data', value: TREAT_MISSING_DATA_LABELS[monitor.treatMissingData].label },
              { label: 'Severity', value: <SeverityBadge severity={monitor.severity} /> },
              { label: 'Notifies', value: <MonitorNotifiers monitor={monitor} />, wide: true },
            ]}
          />
        </CardContent>
      </Card>

      <History name={monitor.name} />

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {monitor.name}?</AlertDialogTitle>
            <AlertDialogDescription>Its history goes with it, and it is no longer evaluated. The metric itself is not touched.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                remove.mutate(monitor.name, {
                  onSuccess: () => {
                    toast.success(`Deleted ${monitor.name}.`);
                    void navigate(urls.monitors());
                  },
                  onError: (error) => toast.error('Could not delete the monitor.', { description: error.message }),
                })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function History({ name }: { readonly name: string }) {
  const history = useMonitorHistory(name);

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="text-base">History</CardTitle>
        <CardDescription>Every change of state, newest first, with the reason it was judged so and the threshold at the time.</CardDescription>
      </CardHeader>
      {history.isPending ? (
        <LoadingRows rows={3} />
      ) : history.isError ? (
        <ErrorState error={history.error} onRetry={() => void history.refetch()} />
      ) : history.data.changes.length === 0 ? (
        <EmptyState title="No changes yet" description="The first evaluation moves a new monitor out of insufficient data, if its series has any." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-48">When</TableHead>
              <TableHead className="w-72">Change</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.data.changes.map((change) => (
              <TableRow key={`${change.changedAt}:${change.toState}`}>
                <TableCell className="align-top">
                  <Timestamp value={change.changedAt} />
                </TableCell>
                <TableCell className="align-top">
                  <span className="flex items-center gap-2">
                    <MonitorStateBadge state={change.fromState} />
                    <ArrowRight className="size-3.5 text-muted-foreground" />
                    <MonitorStateBadge state={change.toState} />
                  </span>
                </TableCell>
                <TableCell className="align-top text-sm">{change.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
