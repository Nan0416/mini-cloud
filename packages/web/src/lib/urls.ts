import type { MetricGraph } from '@mini-cloud/shared';
import { windowSearch, type DashboardWindow } from '@/lib/dashboard-window';
import { DASHBOARD_PARAM, GRAPH_PARAM, WIDGET_PARAM, encodeMetricGraph } from '@/lib/metric-graph-url';

/** A graph on the metrics page, optionally being edited as one widget of a dashboard. */
export interface MetricsLink {
  readonly graph?: MetricGraph;
  readonly dashboard?: string;
  readonly widget?: string;
}

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
  metrics: (link: MetricsLink = {}): string => {
    const query = new URLSearchParams();
    if (link.graph !== undefined) {
      query.set(GRAPH_PARAM, encodeMetricGraph(link.graph));
    }
    if (link.dashboard !== undefined && link.widget !== undefined) {
      query.set(DASHBOARD_PARAM, link.dashboard);
      query.set(WIDGET_PARAM, link.widget);
    }
    return query.size > 0 ? `/metrics?${query.toString()}` : '/metrics';
  },
  dashboards: (): string => '/dashboards',
  /** Without a window, the dashboard opens on its own default. */
  dashboard: (name: string, window?: DashboardWindow): string => `/dashboards/${encodeURIComponent(name)}${window === undefined ? '' : `?${windowSearch(window)}`}`,
  variables: (): string => '/variables',
  pubsub: (): string => '/pubsub',
};
