import { MONITOR_HISTORY_PAGE_SIZE, type CreateMonitorRequest, type MonitorStateChange, type UpdateMonitorRequest } from '@mini-cloud/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

/** Only the newest page polls: a change is only ever recorded at the top, so an older page cannot gain one. */
export function useMonitorHistory(name: string, after?: number) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.monitorHistory(name, after),
    queryFn: () => api.listMonitorHistory({ name, after }),
    refetchInterval: after === undefined ? MONITOR_POLL_MS : false,
    // The page being left stays on screen until the next arrives, rather than collapsing to a skeleton.
    placeholderData: keepPreviousData,
  });
}

/**
 * Every change in a window, with the one before it, for drawing on the chart. All of it
 * rather than a page: a band left out would show the monitor in the wrong state.
 */
export function useMonitorHistoryBetween(name: string, range: { readonly from: number; readonly to: number } | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.monitorHistoryBetween(name, range?.from ?? 0, range?.to ?? 0),
    queryFn: async () => {
      const changes: MonitorStateChange[] = [];
      let after: number | undefined;
      do {
        const page = await api.listMonitorHistory({ name, from: range?.from, to: range?.to, limit: MONITOR_HISTORY_PAGE_SIZE.max, after });
        changes.push(...page.changes);
        after = page.nextCursor;
      } while (after !== undefined);
      return changes;
    },
    enabled: range !== undefined,
    placeholderData: keepPreviousData,
  });
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
