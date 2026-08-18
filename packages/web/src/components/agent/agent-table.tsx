import type { TaskAgent } from '@mini-cloud/shared';
import { PowerOff } from 'lucide-react';
import { useState } from 'react';
import { DataTable, type Column } from '@/components/common/data-table';
import { CopyText } from '@/components/common/copy-text';
import { AgentStatusBadge } from '@/components/common/status-badge';
import { Timestamp } from '@/components/common/timestamp';
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

export interface AgentTableProps {
  readonly agents?: ReadonlyArray<TaskAgent>;
  readonly isLoading?: boolean;
  readonly error?: unknown;
  readonly onRetry?: () => void;
  readonly onTerminate?: (agentId: string) => void;
  readonly terminatingAgentId?: string;
}

function search(term: string, agent: TaskAgent): boolean {
  return agent.name.toLowerCase().includes(term) || agent.agentId.toLowerCase().includes(term) || agent.status === term;
}

export function AgentTable(props: AgentTableProps) {
  const [pendingTerminate, setPendingTerminate] = useState<TaskAgent | undefined>(undefined);

  const columns: Column<TaskAgent>[] = [
    { id: 'name', header: 'Name', compare: (left, right) => left.name.localeCompare(right.name), cell: (agent) => <span className="font-medium">{agent.name}</span> },
    { id: 'agentId', header: 'Agent id', cell: (agent) => <CopyText value={agent.agentId} /> },
    { id: 'status', header: 'Status', cell: (agent) => <AgentStatusBadge status={agent.status} /> },
    {
      id: 'lastSeenAt',
      header: 'Last heartbeat',
      compare: (left, right) => (left.lastSeenAt ?? 0) - (right.lastSeenAt ?? 0),
      cell: (agent) => <Timestamp value={agent.lastSeenAt} variant="relative" />,
    },
    {
      id: 'registeredAt',
      header: 'Registered',
      compare: (left, right) => left.registeredAt - right.registeredAt,
      cell: (agent) => <Timestamp value={agent.registeredAt} />,
    },
  ];

  if (props.onTerminate !== undefined) {
    columns.push({
      id: 'actions',
      header: '',
      headerClassName: 'w-12',
      cell: (agent) => (
        <Button
          variant="ghost"
          size="icon-sm"
          // Terminating an offline agent would be dispatched to nobody: the command
          // travels over the agent's own topic, and an offline agent is not on it.
          disabled={agent.status === 'offline' || props.terminatingAgentId === agent.agentId}
          onClick={(event) => {
            event.stopPropagation();
            setPendingTerminate(agent);
          }}
          aria-label={`Terminate ${agent.name}`}
        >
          <PowerOff className="size-4" />
        </Button>
      ),
    });
  }

  return (
    <>
      <DataTable<TaskAgent>
        columns={columns}
        items={props.agents}
        rowKey={(agent) => agent.agentId}
        isLoading={props.isLoading}
        error={props.error}
        onRetry={props.onRetry}
        search={search}
        searchPlaceholder="Filter by name, id or status…"
        initialSort={{ columnId: 'name', direction: 'asc' }}
        emptyTitle="No agents have registered"
        emptyDescription="Agents self-register on their first heartbeat. Start one with `mini-cloud agent start --id <id>` on a machine that can reach this service."
      />

      <AlertDialog open={pendingTerminate !== undefined} onOpenChange={(open) => (open ? undefined : setPendingTerminate(undefined))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Terminate {pendingTerminate?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The agent process stops. Anything it is currently hosting keeps running, but nothing will report its status until the agent is started again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingTerminate !== undefined) {
                  props.onTerminate?.(pendingTerminate.agentId);
                }
                setPendingTerminate(undefined);
              }}
            >
              Terminate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
