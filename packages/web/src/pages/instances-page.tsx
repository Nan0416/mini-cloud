import type { TaskInstanceStatus } from '@mini-cloud/shared';
import { TASK_INSTANCE_STATUSES } from '@mini-cloud/shared';
import { useState } from 'react';
import { PageHeader } from '@/components/common/page-header';
import { enrichInstances, InstanceTable } from '@/components/instance/instance-table';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAgents } from '@/hooks/use-agents';
import { useInstances, useTasks } from '@/hooks/use-tasks';

const ALL = 'all';

/** Sensible ceiling: the service defaults to unbounded, and a home fleet's history is long. */
const LIMIT = 500;

export function InstancesPage() {
  const [status, setStatus] = useState<TaskInstanceStatus | typeof ALL>('running');

  const tasks = useTasks();
  const agents = useAgents();
  const instances = useInstances({ status: status === ALL ? undefined : status, limit: LIMIT });

  return (
    <>
      <PageHeader title="Instances" description="Every launch, across every task and agent." />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <Label htmlFor="status-filter" className="text-muted-foreground">
            Status
          </Label>
          <Select value={status} onValueChange={(value) => setStatus(TASK_INSTANCE_STATUSES.find((candidate) => candidate === value) ?? ALL)}>
            <SelectTrigger id="status-filter" className="h-8 w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any status</SelectItem>
              {TASK_INSTANCE_STATUSES.map((candidate) => (
                <SelectItem key={candidate} value={candidate}>
                  {candidate}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <InstanceTable
          instances={enrichInstances(instances.data?.instances, tasks.data?.tasks, agents.data?.agents)}
          isLoading={instances.isPending}
          error={instances.error}
          onRetry={() => void instances.refetch()}
          showTask
          showVersion
          showAgent
          showAgentStatus
          pageSize={25}
          emptyTitle={status === ALL ? 'No instances yet' : `No instances are ${status}`}
          emptyDescription="Instances are created when a task is launched, either by you or by the scheduler."
        />
      </Card>
    </>
  );
}
