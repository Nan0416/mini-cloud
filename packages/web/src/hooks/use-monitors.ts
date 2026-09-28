import type { CreateMonitorRequest, UpdateMonitorRequest } from '@mini-cloud/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/hooks/use-connection';
import { queryKeys } from '@/lib/query-keys';

/** The evaluator runs every minute, so a state on screen is never more than this far behind it. */
const MONITOR_POLL_MS = 30_000;

export function useMonitors() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.monitors(), queryFn: () => api.listMonitors(), refetchInterval: MONITOR_POLL_MS });
}

export function useMonitor(name: string) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.monitor(name), queryFn: () => api.getMonitor({ name }), refetchInterval: MONITOR_POLL_MS });
}

export function useMonitorHistory(name: string) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.monitorHistory(name), queryFn: () => api.listMonitorHistory({ name }), refetchInterval: MONITOR_POLL_MS });
}

export function useCreateMonitor() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateMonitorRequest) => api.createMonitor(request),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.monitors() }),
  });
}

export function useUpdateMonitor() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: UpdateMonitorRequest) => api.updateMonitor(request),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.monitors() }),
  });
}

export function useDeleteMonitor() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.deleteMonitor({ name }),
    onSuccess: (_response, name) => {
      // Dropped rather than invalidated, so the page's polling does not answer the delete with a 404.
      client.removeQueries({ queryKey: queryKeys.monitor(name) });
      return client.invalidateQueries({ queryKey: queryKeys.monitors() });
    },
  });
}
