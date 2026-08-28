import { useApi } from '@/hooks/use-connection';
import type { BroadcastRequest, SendToRequest } from '@mini-cloud/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { config } from '@/lib/config';
import { queryKeys } from '@/lib/query-keys';

export function useHubStatus() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.hubStatus(),
    queryFn: () => api.getHubStatus({}),
    refetchInterval: config.detailPollMs,
  });
}

export function useBroadcast() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: BroadcastRequest) => api.broadcast(request),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.hubStatus() }),
  });
}

export function useSendTo() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: SendToRequest) => api.sendTo(request),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.hubStatus() }),
  });
}
