import { useApi } from '@/hooks/use-connection';
import type { CreateTaskRequest, ListTaskInstancesRequest, UpdateTaskRequest } from '@mini-cloud/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { config } from '@/lib/config';
import { queryKeys } from '@/lib/query-keys';

export function useTasks() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.tasks(),
    queryFn: () => api.listTasks({}),
    refetchInterval: config.listPollMs,
  });
}

export function useTask(taskId: string, version?: number) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.task(taskId, version),
    queryFn: () => api.getTask({ taskId, version }),
  });
}

export function useTaskDynamics(taskId: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.taskDynamics(taskId),
    queryFn: () => api.getTaskDynamics({ taskId }),
  });
}

export function useCreateTask() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateTaskRequest) => api.createTask(request),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.tasks() }),
  });
}

export function useUpdateTask() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: UpdateTaskRequest) => api.updateTask(request),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.tasks() }),
  });
}

export function useDeleteTask() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.deleteTask({ taskId }),
    onSuccess: (_response, taskId) => {
      // Dropped rather than invalidated: invalidating would refetch a task that no
      // longer exists, and the detail page's polling would answer the delete with a
      // pair of 404s before the navigation away completes.
      client.removeQueries({ queryKey: ['tasks', taskId] });
      return client.invalidateQueries({ queryKey: queryKeys.tasks() });
    },
  });
}

export function useSetTaskActive(taskId: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (active: boolean) => api.setTaskActive({ taskId, active }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.taskDynamics(taskId) }),
  });
}

export function useSetTaskTargetAgents(taskId: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (targetAgentIds: ReadonlyArray<string>) => api.setTaskTargetAgents({ taskId, targetAgentIds }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.taskDynamics(taskId) }),
  });
}

export interface LaunchVariables {
  readonly targetAgentIds: ReadonlyArray<string>;
  readonly arguments?: ReadonlyArray<string>;
}

export function useLaunchTask(taskId: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variables: LaunchVariables) => api.launchTask({ taskId, targetAgentIds: variables.targetAgentIds, arguments: variables.arguments }),
    // The launch creates instance rows the caller is about to look at, so every
    // instance list is dropped rather than just the one for this task: the overview
    // and the running-instances panel are showing the same new rows.
    onSuccess: () => client.invalidateQueries({ queryKey: ['instances'] }),
  });
}

export function useInstances(filter: ListTaskInstancesRequest = {}, options: { readonly refetchMs?: number } = {}) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.instances(filter),
    queryFn: () => api.listTaskInstances(filter),
    refetchInterval: options.refetchMs ?? config.listPollMs,
  });
}

export function useInstance(instanceId: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.instance(instanceId),
    queryFn: () => api.getTaskInstance({ instanceId }),
    refetchInterval: config.detailPollMs,
  });
}

export function useInstanceEvents(instanceId: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.instanceEvents(instanceId),
    queryFn: () => api.listTaskEvents({ instanceId }),
    refetchInterval: config.detailPollMs,
  });
}

export function useTerminateInstance() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (instanceId: string) => api.terminateTaskInstance({ instanceId }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['instances'] }),
  });
}
