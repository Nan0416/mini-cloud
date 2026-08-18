import type { Task, TaskAgent, TaskInstance } from '@mini-cloud/shared';
import { Link, useNavigate } from 'react-router-dom';
import { DataTable, type Column } from '@/components/common/data-table';
import { CopyText } from '@/components/common/copy-text';
import { AgentStatusBadge, InstanceStatusBadge } from '@/components/common/status-badge';
import { Timestamp } from '@/components/common/timestamp';
import { NA } from '@/lib/format';
import { urls } from '@/lib/urls';

/** An instance joined against the task and agent it names, for display only. */
export interface EnrichedInstance extends TaskInstance {
  readonly taskName?: string;
  readonly agentName?: string;
  readonly agentStatus?: TaskAgent['status'];
}

export function enrichInstances(
  instances: ReadonlyArray<TaskInstance> | undefined,
  tasks: ReadonlyArray<Task> | undefined,
  agents: ReadonlyArray<TaskAgent> | undefined,
): ReadonlyArray<EnrichedInstance> | undefined {
  if (instances === undefined) {
    return undefined;
  }
  const taskById = new Map((tasks ?? []).map((task) => [task.taskId, task]));
  const agentById = new Map((agents ?? []).map((agent) => [agent.agentId, agent]));

  return instances.map((instance) => {
    const agent = agentById.get(instance.agentId);
    return {
      ...instance,
      // The task name is the *current* one: a task renamed since this instance ran
      // shows its new name, which is what you would search for.
      taskName: taskById.get(instance.taskId)?.name,
      agentName: agent?.name,
      agentStatus: agent?.status,
    };
  });
}

export interface InstanceColumnOptions {
  readonly showTask?: boolean;
  readonly showVersion?: boolean;
  readonly showAgent?: boolean;
  readonly showAgentStatus?: boolean;
}

function columns(options: InstanceColumnOptions): ReadonlyArray<Column<EnrichedInstance>> {
  const result: Column<EnrichedInstance>[] = [
    {
      id: 'instanceId',
      header: 'Instance',
      cell: (instance) => (
        <Link
          to={urls.instance(instance.instanceId)}
          onClick={(event) => event.stopPropagation()}
          className="font-mono text-[0.8125rem] text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {instance.instanceId}
        </Link>
      ),
    },
    { id: 'status', header: 'Status', cell: (instance) => <InstanceStatusBadge status={instance.status} /> },
  ];

  if (options.showTask === true) {
    result.push({
      id: 'task',
      header: 'Task',
      compare: (left, right) => (left.taskName ?? left.taskId).localeCompare(right.taskName ?? right.taskId),
      cell: (instance) => (
        <Link to={urls.task(instance.taskId)} onClick={(event) => event.stopPropagation()} className="text-primary hover:underline">
          {instance.taskName ?? instance.taskId}
        </Link>
      ),
    });
  }

  if (options.showVersion === true) {
    result.push({
      id: 'version',
      header: 'Version',
      compare: (left, right) => left.taskVersion - right.taskVersion,
      cell: (instance) => <span className="tabular font-mono text-xs text-muted-foreground">v{instance.taskVersion}</span>,
    });
  }

  if (options.showAgent === true) {
    result.push({
      id: 'agent',
      header: 'Agent',
      compare: (left, right) => (left.agentName ?? left.agentId).localeCompare(right.agentName ?? right.agentId),
      cell: (instance) => <span className="truncate">{instance.agentName ?? instance.agentId}</span>,
    });
  }

  if (options.showAgentStatus === true) {
    result.push({
      id: 'agentStatus',
      header: 'Agent status',
      cell: (instance) => (instance.agentStatus === undefined ? <span className="text-muted-foreground">{NA}</span> : <AgentStatusBadge status={instance.agentStatus} />),
    });
  }

  result.push(
    {
      id: 'pid',
      header: 'PID',
      cell: (instance) => (instance.pid === undefined ? <span className="text-muted-foreground">{NA}</span> : <CopyText value={String(instance.pid)} />),
    },
    {
      id: 'createdAt',
      header: 'Created',
      compare: (left, right) => left.createdAt - right.createdAt,
      cell: (instance) => <Timestamp value={instance.createdAt} />,
    },
    {
      id: 'lastUpdatedAt',
      header: 'Updated',
      compare: (left, right) => left.lastUpdatedAt - right.lastUpdatedAt,
      cell: (instance) => <Timestamp value={instance.lastUpdatedAt} />,
    },
  );

  return result;
}

function search(term: string, instance: EnrichedInstance): boolean {
  return (
    instance.instanceId.toLowerCase().includes(term) ||
    instance.status.includes(term) ||
    (instance.taskName ?? '').toLowerCase().includes(term) ||
    (instance.agentName ?? instance.agentId).toLowerCase().includes(term)
  );
}

export interface InstanceTableProps extends InstanceColumnOptions {
  readonly instances?: ReadonlyArray<EnrichedInstance>;
  readonly isLoading?: boolean;
  readonly error?: unknown;
  readonly onRetry?: () => void;
  readonly emptyTitle?: string;
  readonly emptyDescription?: string;
  readonly pageSize?: number;
}

export function InstanceTable(props: InstanceTableProps) {
  const navigate = useNavigate();

  return (
    <DataTable<EnrichedInstance>
      columns={columns(props)}
      items={props.instances}
      rowKey={(instance) => instance.instanceId}
      isLoading={props.isLoading}
      error={props.error}
      onRetry={props.onRetry}
      search={search}
      searchPlaceholder="Filter by id, status, task or agent…"
      initialSort={{ columnId: 'lastUpdatedAt', direction: 'desc' }}
      pageSize={props.pageSize ?? 20}
      onRowClick={(instance) => navigate(urls.instance(instance.instanceId))}
      emptyTitle={props.emptyTitle ?? 'No instances'}
      emptyDescription={props.emptyDescription}
    />
  );
}
