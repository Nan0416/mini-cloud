import type { CreateNotifierRequest, UpdateNotifierRequest } from '@mini-cloud/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/hooks/use-connection';
import { queryKeys } from '@/lib/query-keys';

export function useNotifiers() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.notifiers(), queryFn: () => api.listNotifiers() });
}

export function useCreateNotifier() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateNotifierRequest) => api.createNotifier(request),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.notifiers() }),
  });
}

export function useUpdateNotifier() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: UpdateNotifierRequest) => api.updateNotifier(request),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.notifiers() }),
  });
}

export function useDeleteNotifier() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (notifierId: string) => api.deleteNotifier({ notifierId }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.notifiers() }),
  });
}

export function useTestNotifier() {
  const api = useApi();
  return useMutation({ mutationFn: (notifierId: string) => api.testNotifier({ notifierId }) });
}
