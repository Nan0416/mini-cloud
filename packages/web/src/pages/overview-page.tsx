import { Activity, ListTree, Radio, Server } from 'lucide-react';
import { Link } from 'react-router-dom';
import { enrichInstances, InstanceTable } from '@/components/instance/instance-table';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAgents } from '@/hooks/use-agents';
import { useHubStatus } from '@/hooks/use-pubsub';
import { useInstances, useTasks } from '@/hooks/use-tasks';
import { config } from '@/lib/config';
import { urls } from '@/lib/urls';

function StatCard(props: { readonly label: string; readonly value?: number; readonly detail?: string; readonly to: string; readonly icon: typeof Activity }) {
  const Icon = props.icon;
  return (
    <Link
      to={props.to}
      className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Card className="h-full transition-colors hover:border-primary/40 hover:bg-accent/40">
        <CardHeader className="flex-row items-center justify-between space-y-0 border-b-0 pb-1">
          <CardTitle className="text-sm font-medium text-muted-foreground">{props.label}</CardTitle>
          <Icon className="size-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="pt-0">
          {props.value === undefined ? <Skeleton className="h-8 w-12" /> : <p className="tabular text-3xl font-semibold tracking-tight">{props.value}</p>}
          <p className="mt-1 h-4 text-xs text-muted-foreground">{props.detail ?? ''}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

export function OverviewPage() {
  const tasks = useTasks();
  const agents = useAgents();
  const hub = useHubStatus();
  // Running only: on a home fleet this is the list you actually keep an eye on, and
  // it is the one query on this page whose answer changes minute to minute.
  const running = useInstances({ status: 'running' }, { refetchMs: config.detailPollMs });

  const onlineAgents = agents.data?.agents.filter((agent) => agent.status === 'online').length;
  const totalAgents = agents.data?.agents.length;
  const services = tasks.data?.tasks.filter((task) => task.type === 'service').length;

  return (
    <>
      <PageHeader title="Overview" description="What your fleet is doing right now." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Tasks"
          value={tasks.data?.tasks.length}
          detail={services === undefined ? undefined : `${services} ${services === 1 ? 'service' : 'services'}`}
          to={urls.tasks()}
          icon={ListTree}
        />
        <StatCard label="Running instances" value={running.data?.instances.length} to={urls.instances()} icon={Activity} />
        <StatCard label="Agents online" value={onlineAgents} detail={totalAgents === undefined ? undefined : `${totalAgents} registered`} to={urls.agents()} icon={Server} />
        <StatCard
          label="Hub subscribers"
          value={hub.data?.status.subscriberCount}
          detail={hub.data === undefined ? undefined : `${Object.keys(hub.data.status.topicToSubscriberCount).length} topics`}
          to={urls.pubsub()}
          icon={Radio}
        />
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Running instances</CardTitle>
        </CardHeader>
        <InstanceTable
          instances={enrichInstances(running.data?.instances, tasks.data?.tasks, agents.data?.agents)}
          isLoading={running.isPending}
          error={running.error}
          onRetry={() => void running.refetch()}
          showTask
          showAgent
          pageSize={10}
          emptyTitle="Nothing is running"
          emptyDescription="Launch a task, or wait for the scheduler to reach the next occurrence of a scheduled job."
        />
      </Card>
    </>
  );
}
