import type { ListTaskInstancesRequest } from '@mini-cloud/shared';

/**
 * Every cache key the console uses, built from one place.
 *
 * Keys are hierarchical so that invalidating `['tasks']` also drops every task
 * detail and dynamics entry — a launch or a delete changes more than the one row it
 * names, and hand-listing the affected keys at each call site is how stale panels
 * appear after a mutation.
 */
export const queryKeys = {
  tasks: () => ['tasks'] as const,
  task: (taskId: string, version?: number) => ['tasks', taskId, version ?? 'latest'] as const,
  taskDynamics: (taskId: string) => ['tasks', taskId, 'dynamics'] as const,

  instances: (filter: ListTaskInstancesRequest = {}) => ['instances', filter] as const,
  instance: (instanceId: string) => ['instances', instanceId] as const,
  instanceEvents: (instanceId: string) => ['instances', instanceId, 'events'] as const,

  agents: () => ['agents'] as const,
  variables: () => ['variables'] as const,
  hubStatus: () => ['hub-status'] as const,
  ping: () => ['ping'] as const,
};
