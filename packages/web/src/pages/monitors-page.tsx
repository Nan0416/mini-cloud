import type { Monitor } from '@mini-cloud/shared';
import { Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { DataTable, type Column } from '@/components/common/data-table';
import { PageHeader } from '@/components/common/page-header';
import { MonitorStateBadge } from '@/components/common/status-badge';
import { Timestamp } from '@/components/common/timestamp';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useMonitors } from '@/hooks/use-monitors';
import { describeCondition, describeMetric } from '@/lib/monitor-editor';
import { urls } from '@/lib/urls';

/** Alarms first, so the page opens on what needs attention. */
const STATE_ORDER = { ALARM: 0, INSUFFICIENT_DATA: 1, OK: 2 } as const;

const COLUMNS: ReadonlyArray<Column<Monitor>> = [
  {
    id: 'name',
    header: 'Name',
    cell: (monitor) => (
      <Link
        to={urls.monitor(monitor.name)}
        onClick={(event) => event.stopPropagation()}
        className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {monitor.name}
      </Link>
    ),
    compare: (left, right) => left.name.localeCompare(right.name),
  },
  {
    id: 'state',
    header: 'State',
    cell: (monitor) => <MonitorStateBadge state={monitor.state} />,
    compare: (left, right) => STATE_ORDER[left.state] - STATE_ORDER[right.state] || left.name.localeCompare(right.name),
  },
  {
    id: 'metric',
    header: 'Metric',
    cell: (monitor) => (
      <div className="min-w-0">
        <div className="truncate">{describeMetric(monitor.metric)}</div>
        <div className="truncate text-xs text-muted-foreground">{monitor.metric.namespace}</div>
      </div>
    ),
  },
  { id: 'condition', header: 'Condition', cell: (monitor) => <span className="tabular">{describeCondition(monitor)}</span> },
  {
    id: 'since',
    header: 'Since',
    cell: (monitor) => <Timestamp value={monitor.stateChangedAt} variant="relative" />,
    compare: (left, right) => left.stateChangedAt - right.stateChangedAt,
  },
  { id: 'notify', header: 'Notifies', cell: (monitor) => (monitor.notify ? 'Yes' : <span className="text-muted-foreground">No</span>) },
];

export function MonitorsPage() {
  const monitors = useMonitors();
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        title="Monitors"
        description="A threshold on one metric, evaluated every minute. A change of state is recorded, and sent on when the monitor notifies."
        actions={
          <Button asChild>
            <Link to={urls.createMonitor()}>
              <Plus className="size-4" />
              Create monitor
            </Link>
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <DataTable
          columns={COLUMNS}
          items={monitors.data?.monitors}
          rowKey={(monitor) => monitor.name}
          isLoading={monitors.isPending}
          error={monitors.error}
          onRetry={() => void monitors.refetch()}
          onRowClick={(monitor) => void navigate(urls.monitor(monitor.name))}
          search={(term, monitor) => [monitor.name, monitor.metric.metricName, monitor.metric.namespace].some((text) => text.toLowerCase().includes(term.toLowerCase()))}
          searchPlaceholder="Filter by name or metric"
          initialSort={{ columnId: 'state', direction: 'asc' }}
          emptyTitle="No monitors yet"
          emptyDescription="Create one here, or from a series on the Metrics page."
        />
      </Card>
    </>
  );
}
