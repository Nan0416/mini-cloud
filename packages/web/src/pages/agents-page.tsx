import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { AgentTable } from '@/components/agent/agent-table';
import { Card } from '@/components/ui/card';
import { useAgents, useTerminateAgent } from '@/hooks/use-agents';

export function AgentsPage() {
  const agents = useAgents();
  const terminate = useTerminateAgent();

  return (
    <>
      <PageHeader title="Agents" description="Machines running `mini-cloud agent`. They register themselves on their first heartbeat." />

      <Card className="overflow-hidden">
        <AgentTable
          agents={agents.data?.agents}
          isLoading={agents.isPending}
          error={agents.error}
          onRetry={() => void agents.refetch()}
          terminatingAgentId={terminate.isPending ? terminate.variables : undefined}
          onTerminate={(agentId) => {
            terminate.mutate(agentId, {
              onSuccess: () => toast.success('Termination sent.', { description: 'The agent goes offline once it stops heartbeating.' }),
              onError: (error) => toast.error('Could not terminate the agent.', { description: error.message }),
            });
          }}
        />
      </Card>
    </>
  );
}
