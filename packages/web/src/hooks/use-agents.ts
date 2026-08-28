import { useApi } from '@/hooks/use-connection';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { config } from '@/lib/config';
import { queryKeys } from '@/lib/query-keys';

export function useAgents() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.agents(),
    queryFn: () => api.listAgents({}),
    refetchInterval: config.listPollMs,
  });
}

export function useTerminateAgent() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.terminateAgent({ agentId }),
    // The agent goes offline asynchronously — it has to receive the command and stop
    // heartbeating — so the list is refetched rather than patched optimistically.
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.agents() }),
  });
}
