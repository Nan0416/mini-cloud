import type { Task } from '@mini-cloud/shared';
import { Pencil, Rocket, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CopyText } from '@/components/common/copy-text';
import { DurationText } from '@/components/common/duration';
import { KeyValueGrid, type KeyValueItem } from '@/components/common/key-value-grid';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState, LoadingRows, Spinner } from '@/components/common/states';
import { AgentStatusBadge, ScheduleBadge, TaskTypeBadge, VersionBadge } from '@/components/common/status-badge';
import { Timestamp } from '@/components/common/timestamp';
import { enrichInstances, InstanceTable } from '@/components/instance/instance-table';
import { LaunchDialog } from '@/components/task/launch-dialog';
import { TargetAgentsDialog } from '@/components/task/target-agents-dialog';
import { commandLine, nextLaunchAt, resolveTargetAgents } from '@/components/task/task-helpers';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAgents } from '@/hooks/use-agents';
import { useDeleteTask, useInstances, useLaunchTask, useSetTaskActive, useSetTaskTargetAgents, useTask, useTaskDynamics, useTasks } from '@/hooks/use-tasks';
import { NA } from '@/lib/format';
import { urls } from '@/lib/urls';

const TABS: ReadonlyArray<string> = ['instances', 'environment'];

function parseVersion(raw: string | null): number | undefined {
  if (raw === null) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function summaryItems(
  task: Task,
  latestVersion: number | undefined,
  targetAgents: ReturnType<typeof resolveTargetAgents>,
  active: boolean | undefined,
): ReadonlyArray<KeyValueItem> {
  const items: KeyValueItem[] = [
    { label: 'Task id', value: <CopyText value={task.taskId} /> },
    { label: 'Version', value: <VersionBadge version={task.version} latest={task.version === latestVersion} /> },
    { label: 'Type', value: <TaskTypeBadge type={task.type} /> },
    { label: 'Updated', value: <Timestamp value={task.lastUpdatedAt} variant="long" /> },
    { label: 'Command', value: <CopyText value={commandLine(task)} className="w-full" />, wide: true },
    { label: 'Working directory', value: <CopyText value={task.cwd} className="w-full" />, wide: true },
    { label: 'Stdout', value: task.stdout === undefined ? <span className="text-muted-foreground">{NA}</span> : <CopyText value={task.stdout} /> },
    { label: 'Stderr', value: task.stderr === undefined ? <span className="text-muted-foreground">{NA}</span> : <CopyText value={task.stderr} /> },
  ];

  if (task.type === 'job') {
    items.push(
      { label: 'Interval', value: <DurationText ms={task.duration} /> },
      { label: 'Schedule', value: active === undefined ? <span className="text-muted-foreground">{NA}</span> : <ScheduleBadge active={active} /> },
      { label: 'Next launch', value: <Timestamp value={nextLaunchAt(task)} variant="long" /> },
    );
  } else {
    const check = task.healthCheck;
    items.push(
      {
        label: 'Health check',
        value:
          check === undefined ? (
            <span className="text-muted-foreground">None</span>
          ) : check.type === 'ping' ? (
            <span className="font-mono text-[0.8125rem]">Ping {check.url}</span>
          ) : (
            <span>Passive</span>
          ),
      },
      { label: 'Check period', value: <DurationText ms={check?.periodInMs} /> },
    );
  }

  const targeted = targetAgents.filter((agent) => agent.targeted);
  items.push({
    label: 'Target agents',
    wide: true,
    value:
      targeted.length === 0 ? (
        <span className="text-muted-foreground">None. The scheduler has nowhere to launch this.</span>
      ) : (
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
          {targeted.map((agent) => (
            <li key={agent.agentId} className="flex items-center gap-2">
              <span>{agent.name ?? agent.agentId}</span>
              <AgentStatusBadge status={agent.status} />
            </li>
          ))}
        </ul>
      ),
  });

  return items;
}

export function TaskPage() {
  const { taskId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const version = parseVersion(searchParams.get('version'));
  const tab = TABS.find((candidate) => candidate === searchParams.get('tab')) ?? 'instances';

  const task = useTask(taskId, version);
  // Fetched separately so the page can say "you are looking at v2 of 5" while
  // showing v2. Cheap, and cached under its own key.
  const latest = useTask(taskId);
  const dynamics = useTaskDynamics(taskId);
  const agents = useAgents();
  const tasks = useTasks();
  const instances = useInstances({ taskId, limit: 200 });

  const setActive = useSetTaskActive(taskId);
  const setTargets = useSetTaskTargetAgents(taskId);
  const launch = useLaunchTask(taskId);
  const remove = useDeleteTask();

  const [showLaunch, setShowLaunch] = useState(false);
  const [showTargets, setShowTargets] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  if (task.isPending) {
    return <LoadingRows rows={6} />;
  }
  if (task.error !== null) {
    return <ErrorState error={task.error} onRetry={() => void task.refetch()} />;
  }

  const current = task.data.task;
  const latestVersion = latest.data?.task.version;
  const isLatest = latestVersion !== undefined && current.version === latestVersion;
  const targetAgents = resolveTargetAgents(agents.data?.agents, dynamics.data?.dynamics);

  return (
    <>
      <PageHeader
        title={current.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {current.description ?? <span className="italic">No description</span>}
            {isLatest || latestVersion === undefined ? null : (
              <Link to={urls.task(taskId)} className="text-primary hover:underline">
                Viewing v{current.version} — go to latest (v{latestVersion})
              </Link>
            )}
          </span>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setShowDelete(true)} disabled={remove.isPending}>
              <Trash2 className="size-4" />
              Delete
            </Button>
            {isLatest ? (
              <Button asChild variant="outline">
                <Link to={urls.editTask(taskId)}>
                  <Pencil className="size-4" />
                  Edit
                </Link>
              </Button>
            ) : (
              // A real <button>, not a disabled <Link>: `disabled` on an anchor is
              // ignored, so the link form would still navigate.
              <Button variant="outline" disabled title="Only the latest version can be edited.">
                <Pencil className="size-4" />
                Edit
              </Button>
            )}
            <Button onClick={() => setShowLaunch(true)} disabled={!isLatest || launch.isPending || agents.data === undefined}>
              {launch.isPending ? <Spinner /> : <Rocket className="size-4" />}
              Launch
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle>Summary</CardTitle>
          <div className="flex items-center gap-3">
            {current.type === 'job' && dynamics.data !== undefined ? (
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={dynamics.data.dynamics.active}
                  disabled={setActive.isPending}
                  onCheckedChange={(checked) => {
                    setActive.mutate(checked, {
                      onError: (error) => toast.error('Could not change the schedule.', { description: error.message }),
                    });
                  }}
                />
                <span className="text-muted-foreground">Scheduled</span>
              </label>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => setShowTargets(true)} disabled={agents.data === undefined}>
              Edit targets
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <KeyValueGrid items={summaryItems(current, latestVersion, targetAgents, dynamics.data?.dynamics.active)} />
        </CardContent>
      </Card>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams);
          next.set('tab', value);
          setSearchParams(next, { replace: true });
        }}
      >
        <TabsList>
          <TabsTrigger value="instances">Instances</TabsTrigger>
          <TabsTrigger value="environment">Environment</TabsTrigger>
        </TabsList>

        <TabsContent value="instances">
          <Card className="overflow-hidden">
            <InstanceTable
              instances={enrichInstances(instances.data?.instances, tasks.data?.tasks, agents.data?.agents)}
              isLoading={instances.isPending}
              error={instances.error}
              onRetry={() => void instances.refetch()}
              showVersion
              showAgent
              showAgentStatus
              emptyTitle="This task has never been launched"
              emptyDescription="Use Launch above to run it now, or set an interval so the scheduler does."
            />
          </Card>
        </TabsContent>

        <TabsContent value="environment">
          <Card>
            <CardHeader>
              <CardTitle>Environment variables</CardTitle>
            </CardHeader>
            <CardContent>
              {current.env === undefined || Object.keys(current.env).length === 0 ? (
                <p className="text-sm text-muted-foreground">None. The process inherits the agent's environment.</p>
              ) : (
                <dl className="divide-y divide-border">
                  {Object.entries(current.env).map(([key, value]) => (
                    <div key={key} className="flex flex-wrap items-baseline justify-between gap-4 py-2">
                      <dt className="font-mono text-[0.8125rem] font-medium">{key}</dt>
                      <dd className="min-w-0 flex-1 text-right">
                        <CopyText value={value} className="justify-end text-muted-foreground" />
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <LaunchDialog
        open={showLaunch}
        onOpenChange={setShowLaunch}
        agents={targetAgents}
        isLaunching={launch.isPending}
        onLaunch={(agentIds) => {
          launch.mutate(
            { targetAgentIds: agentIds },
            {
              onSuccess: (response) => {
                setShowLaunch(false);
                const failed = response.results.filter((result) => result.status === 'initiation_failed');
                if (failed.length === 0) {
                  toast.success(`Launched on ${response.results.length} ${response.results.length === 1 ? 'agent' : 'agents'}.`);
                } else {
                  toast.warning(`${failed.length} of ${response.results.length} launches could not be dispatched.`, {
                    description: failed.map((result) => result.message ?? result.agentId).join('; '),
                  });
                }
              },
              onError: (error) => toast.error('Launch failed.', { description: error.message }),
            },
          );
        }}
      />

      <TargetAgentsDialog
        open={showTargets}
        onOpenChange={setShowTargets}
        agents={targetAgents}
        isSaving={setTargets.isPending}
        onSave={(agentIds) => {
          setTargets.mutate(agentIds, {
            onSuccess: () => {
              setShowTargets(false);
              toast.success('Target agents saved.');
            },
            onError: (error) => toast.error('Could not save the target agents.', { description: error.message }),
          });
        }}
      />

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {current.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Every version of this task and its schedule state are removed, and this cannot be undone. Instances it already produced are left in place — they keep showing the raw
              task id until the retention window expires.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                remove.mutate(taskId, {
                  onSuccess: () => {
                    toast.success(`Deleted ${current.name}.`);
                    navigate(urls.tasks());
                  },
                  onError: (error) => toast.error('Could not delete the task.', { description: error.message }),
                });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
