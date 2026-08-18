import type { Task } from '@mini-cloud/shared';
import { Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { commandLine, nextLaunchAt } from './task-helpers';
import { DataTable, type Column } from '@/components/common/data-table';
import { DurationText } from '@/components/common/duration';
import { TaskTypeBadge } from '@/components/common/status-badge';
import { Timestamp } from '@/components/common/timestamp';
import { Button } from '@/components/ui/button';
import { NA } from '@/lib/format';
import { urls } from '@/lib/urls';

function columns(): ReadonlyArray<Column<Task>> {
  return [
    {
      id: 'name',
      header: 'Name',
      compare: (left, right) => left.name.localeCompare(right.name),
      cell: (task) => (
        <Link
          to={urls.task(task.taskId)}
          onClick={(event) => event.stopPropagation()}
          className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {task.name}
        </Link>
      ),
    },
    { id: 'type', header: 'Type', cell: (task) => <TaskTypeBadge type={task.type} /> },
    {
      id: 'cmd',
      header: 'Command',
      compare: (left, right) => left.cmd.localeCompare(right.cmd),
      className: 'max-w-[28rem]',
      cell: (task) => (
        <span className="block truncate font-mono text-[0.8125rem] text-muted-foreground" title={commandLine(task)}>
          {commandLine(task)}
        </span>
      ),
    },
    {
      id: 'interval',
      header: 'Interval',
      cell: (task) => (task.type === 'job' && task.duration !== undefined ? <DurationText ms={task.duration} /> : <span className="text-muted-foreground">{NA}</span>),
    },
    {
      id: 'nextLaunch',
      header: 'Next launch',
      compare: (left, right) => (nextLaunchAt(left) ?? Number.MAX_SAFE_INTEGER) - (nextLaunchAt(right) ?? Number.MAX_SAFE_INTEGER),
      cell: (task) => <Timestamp value={nextLaunchAt(task)} />,
    },
    {
      id: 'version',
      header: 'Version',
      compare: (left, right) => left.version - right.version,
      cell: (task) => <span className="tabular font-mono text-xs text-muted-foreground">v{task.version}</span>,
    },
    {
      id: 'lastUpdatedAt',
      header: 'Updated',
      compare: (left, right) => left.lastUpdatedAt - right.lastUpdatedAt,
      cell: (task) => <Timestamp value={task.lastUpdatedAt} />,
    },
  ];
}

function search(term: string, task: Task): boolean {
  return task.name.toLowerCase().includes(term) || task.type === term || commandLine(task).toLowerCase().includes(term) || task.taskId.toLowerCase().includes(term);
}

export function TaskTable(props: { readonly tasks?: ReadonlyArray<Task>; readonly isLoading?: boolean; readonly error?: unknown; readonly onRetry?: () => void }) {
  const navigate = useNavigate();

  return (
    <DataTable<Task>
      columns={columns()}
      items={props.tasks}
      rowKey={(task) => task.taskId}
      isLoading={props.isLoading}
      error={props.error}
      onRetry={props.onRetry}
      search={search}
      searchPlaceholder="Filter by name, command or type…"
      initialSort={{ columnId: 'name', direction: 'asc' }}
      pageSize={20}
      onRowClick={(task) => navigate(urls.task(task.taskId))}
      emptyTitle="No tasks yet"
      emptyDescription="A task is a command mini-cloud can launch on one of your agents — either a job that runs to completion or a service it keeps alive."
      emptyAction={
        <Button asChild size="sm">
          <Link to={urls.createTask()}>
            <Plus className="size-4" />
            Create a task
          </Link>
        </Button>
      }
    />
  );
}
