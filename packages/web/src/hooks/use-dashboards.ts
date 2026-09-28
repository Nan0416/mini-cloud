import type { CreateDashboardRequest, Dashboard, DashboardContent } from '@mini-cloud/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/hooks/use-connection';
import { saveDashboardEdit } from '@/lib/dashboard-editor';
import { queryKeys } from '@/lib/query-keys';

export function useDashboards() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.dashboards(), queryFn: () => api.listDashboards() });
}

export function useDashboard(name: string) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.dashboard(name), queryFn: () => api.getDashboard({ name }) });
}

export function useCreateDashboard() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateDashboardRequest) => api.createDashboard(request),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.dashboards() }),
  });
}

export interface DashboardEdit {
  readonly name: string;
  readonly edit: (content: DashboardContent) => DashboardContent;
}

/** Saves an edit to a dashboard. See `saveDashboardEdit` for why the edit is a function. */
export function useEditDashboard() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ name, edit }: DashboardEdit): Promise<Dashboard> => saveDashboardEdit(api, name, edit),
    onSuccess: (dashboard) => {
      client.setQueryData(queryKeys.dashboard(dashboard.name), { dashboard });
      return client.invalidateQueries({ queryKey: queryKeys.dashboards(), exact: true });
    },
  });
}

export function useDeleteDashboard() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.deleteDashboard({ name }),
    onSuccess: (_response, name) => {
      client.removeQueries({ queryKey: queryKeys.dashboard(name) });
      return client.invalidateQueries({ queryKey: queryKeys.dashboards() });
    },
  });
}
