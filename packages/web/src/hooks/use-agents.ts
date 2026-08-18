import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { config } from '@/lib/config';
import { queryKeys } from '@/lib/query-keys';

export function useAgents() {
  return useQuery({
    queryKey: queryKeys.agents(),
    queryFn: () => api.listAgents({}),
    refetchInterval: config.listPollMs,
  });
}

export function useTerminateAgent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.terminateAgent({ agentId }),
    // The agent goes offline asynchronously — it has to receive the command and stop
    // heartbeating — so the list is refetched rather than patched optimistically.
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.agents() }),
  });
}
