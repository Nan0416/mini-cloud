/**
 * Every route in one place, as functions rather than string literals scattered
 * through components. Renaming a route is then a single edit, and a typo in a link
 * is a compile error rather than a page that quietly 404s.
 */
export const urls = {
  overview: (): string => '/',

  tasks: (): string => '/tasks',
  createTask: (): string => '/tasks/new',
  task: (taskId: string, options: { readonly version?: number; readonly tab?: string } = {}): string => {
    const query = new URLSearchParams();
    if (options.version !== undefined) {
      query.set('version', String(options.version));
    }
    if (options.tab !== undefined) {
      query.set('tab', options.tab);
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return `/tasks/${encodeURIComponent(taskId)}${suffix}`;
  },
  editTask: (taskId: string): string => `/tasks/${encodeURIComponent(taskId)}/edit`,

  instances: (): string => '/instances',
  instance: (instanceId: string): string => `/instances/${encodeURIComponent(instanceId)}`,

  agents: (): string => '/agents',
  variables: (): string => '/variables',
  pubsub: (): string => '/pubsub',
};
