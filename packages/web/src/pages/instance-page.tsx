import { CircleStop } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { TERMINATION_PERMITTED_STATUSES } from '@mini-cloud/shared';
import { CopyText } from '@/components/common/copy-text';
import { KeyValueGrid, type KeyValueItem } from '@/components/common/key-value-grid';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState, LoadingRows, Spinner } from '@/components/common/states';
import { AgentStatusBadge, InstanceStatusBadge, TaskTypeBadge } from '@/components/common/status-badge';
import { Timestamp } from '@/components/common/timestamp';
import { EventTable } from '@/components/instance/event-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAgents } from '@/hooks/use-agents';
import { useInstance, useInstanceEvents, useTask, useTerminateInstance } from '@/hooks/use-tasks';
import { NA } from '@/lib/format';
import { urls } from '@/lib/urls';

export function InstancePage() {
  const { instanceId = '' } = useParams();
  const instance = useInstance(instanceId);
  const events = useInstanceEvents(instanceId);
  const agents = useAgents();
  const terminate = useTerminateInstance();

  // The instance names an exact task version, which is the definition it was
  // launched from — not whatever the task looks like now.
  const task = useTask(instance.data?.instance.taskId ?? '', instance.data?.instance.taskVersion);

  if (instance.isPending) {
    return <LoadingRows rows={6} />;
  }
  if (instance.error !== null) {
    return <ErrorState error={instance.error} onRetry={() => void instance.refetch()} />;
  }

  const current = instance.data.instance;
  const agent = agents.data?.agents.find((candidate) => candidate.agentId === current.agentId);
  const canTerminate = TERMINATION_PERMITTED_STATUSES.includes(current.status);

  const items: ReadonlyArray<KeyValueItem> = [
    { label: 'Instance id', value: <CopyText value={current.instanceId} /> },
    { label: 'Status', value: <InstanceStatusBadge status={current.status} /> },
    {
      label: 'Task',
      value: (
        <Link to={urls.task(current.taskId, { version: current.taskVersion })} className="text-primary hover:underline">
          {task.data?.task.name ?? current.taskId} <span className="font-mono text-xs">v{current.taskVersion}</span>
        </Link>
      ),
    },
    { label: 'Task type', value: task.data === undefined ? <span className="text-muted-foreground">{NA}</span> : <TaskTypeBadge type={task.data.task.type} /> },
    { label: 'Agent', value: <span>{agent?.name ?? current.agentId}</span> },
    { label: 'Agent status', value: agent === undefined ? <span className="text-muted-foreground">{NA}</span> : <AgentStatusBadge status={agent.status} /> },
    { label: 'PID', value: current.pid === undefined ? <span className="text-muted-foreground">Not reported yet</span> : <CopyText value={String(current.pid)} /> },
    { label: 'Created', value: <Timestamp value={current.createdAt} variant="long" /> },
    { label: 'Updated', value: <Timestamp value={current.lastUpdatedAt} variant="long" /> },
  ];

  return (
    <>
      <PageHeader
        title="Task instance"
        description={<span className="font-mono text-xs">{current.instanceId}</span>}
        actions={
          <Button
            variant="outline"
            disabled={!canTerminate || terminate.isPending}
            // The service refuses to terminate an instance with no pid yet, so the
            // reason is spelled out here rather than left as a disabled button.
            title={canTerminate ? undefined : `An instance that is "${current.status}" cannot be terminated.`}
            onClick={() => {
              terminate.mutate(instanceId, {
                onSuccess: () => toast.success('Termination sent.', { description: 'The agent sends SIGINT and reports back.' }),
                onError: (error) => toast.error('Could not terminate the instance.', { description: error.message }),
              });
            }}
          >
            {terminate.isPending ? <Spinner /> : <CircleStop className="size-4" />}
            Terminate
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <KeyValueGrid items={items} />
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Events</CardTitle>
        </CardHeader>
        <EventTable events={events.data?.events} isLoading={events.isPending} error={events.error} onRetry={() => void events.refetch()} />
      </Card>
    </>
  );
}
