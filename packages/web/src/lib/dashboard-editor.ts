import type { MiniCloudClient } from '@mini-cloud/client';
import {
  ConflictError,
  InvalidRequestError,
  assertDashboardName,
  METRIC_GRAPH_VERSION,
  type Dashboard,
  type DashboardContent,
  type DashboardWidget,
  type MetricGraph,
  type MetricQuery,
} from '@mini-cloud/shared';
import type { GraphWindow } from '@/lib/graph-window';
import { EMPTY_GRAPH, labelOf } from '@/lib/metric-graph-editor';

/** The rules a dashboard is edited by, kept apart from the pages so they can be tested. */

export const DASHBOARD_NAME_HINT = 'Letters, digits, hyphens and underscores. It is the dashboard’s link, so it cannot be changed later.';

/** Why a new dashboard cannot have this name, or `undefined` when it can. Blank is not yet a problem. */
export function dashboardNameProblem(name: string, taken: ReadonlyArray<string>): string | undefined {
  if (name.length === 0) {
    return undefined;
  }
  try {
    assertDashboardName(name, 'The name');
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return taken.includes(name) ? `There is already a dashboard called ${name}.` : undefined;
}

/** Where a dashboard opens when its link names no window. */
export function defaultWindowOf(dashboard: Dashboard): GraphWindow {
  return { range: dashboard.defaultRange ?? EMPTY_GRAPH.range, periodMs: dashboard.defaultPeriodMs };
}

/** What an update writes: everything but what the service keeps for itself. */
export function contentOf(dashboard: Dashboard): DashboardContent {
  return { widgets: dashboard.widgets, defaultRange: dashboard.defaultRange, defaultPeriodMs: dashboard.defaultPeriodMs };
}

/** The first `w<n>` no widget has. */
export function nextWidgetId(widgets: ReadonlyArray<DashboardWidget>): string {
  const taken = new Set(widgets.map((widget) => widget.id));
  let candidate = 1;
  while (taken.has(`w${candidate}`)) {
    candidate += 1;
  }
  return `w${candidate}`;
}

/** A widget's heading: its own title, the one series it plots, or how many it plots. */
export function titleOf(widget: DashboardWidget): string {
  if (widget.title !== undefined) {
    return widget.title;
  }
  return widget.queries.length === 1 ? labelOf(widget.queries[0]) : `${widget.queries.length} series`;
}

/** A widget drawn over the dashboard's window, as the metrics page would draw it. */
export function graphOf(widget: DashboardWidget, window: GraphWindow): MetricGraph {
  return { version: METRIC_GRAPH_VERSION, queries: widget.queries, range: window.range, periodMs: window.periodMs };
}

export function withWidgetAdded(content: DashboardContent, queries: ReadonlyArray<MetricQuery>, title: string | undefined): DashboardContent {
  return { ...content, widgets: [...content.widgets, { id: nextWidgetId(content.widgets), title, queries }] };
}

function requireWidget(content: DashboardContent, id: string): number {
  const index = content.widgets.findIndex((widget) => widget.id === id);
  if (index === -1) {
    throw new InvalidRequestError('This dashboard no longer has that graph; it was removed since you opened it. Add the graph to the dashboard again instead.');
  }
  return index;
}

export function withWidgetQueries(content: DashboardContent, id: string, queries: ReadonlyArray<MetricQuery>): DashboardContent {
  requireWidget(content, id);
  return { ...content, widgets: content.widgets.map((widget) => (widget.id === id ? { ...widget, queries } : widget)) };
}

/** An empty title clears it, so the heading goes back to the one made from the queries. */
export function withWidgetTitle(content: DashboardContent, id: string, title: string): DashboardContent {
  requireWidget(content, id);
  const trimmed = title.trim();
  return { ...content, widgets: content.widgets.map((widget) => (widget.id === id ? { ...widget, title: trimmed.length === 0 ? undefined : trimmed } : widget)) };
}

export function withWidgetRemoved(content: DashboardContent, id: string): DashboardContent {
  return { ...content, widgets: content.widgets.filter((widget) => widget.id !== id) };
}

/** Moves a widget one place earlier (-1) or later (+1); a widget at the edge stays put. */
export function withWidgetMoved(content: DashboardContent, id: string, delta: -1 | 1): DashboardContent {
  const index = requireWidget(content, id);
  const target = index + delta;
  if (target < 0 || target >= content.widgets.length) {
    return content;
  }
  const widgets = [...content.widgets];
  [widgets[index], widgets[target]] = [widgets[target], widgets[index]];
  return { ...content, widgets };
}

export function withDefaultWindow(content: DashboardContent, window: GraphWindow): DashboardContent {
  return { ...content, defaultRange: window.range, defaultPeriodMs: window.periodMs };
}

/**
 * Applies an edit to a dashboard as the service holds it now, not as the page shows it,
 * so a widget another tab added since this page loaded survives. The version guard still
 * stands between the read and the write; losing that race costs one more read, and a
 * second loss is reported rather than retried forever. `edit` may throw to refuse.
 */
export async function saveDashboardEdit(
  api: Pick<MiniCloudClient, 'getDashboard' | 'updateDashboard'>,
  name: string,
  edit: (content: DashboardContent) => DashboardContent,
): Promise<Dashboard> {
  const attempt = async () => {
    const { dashboard } = await api.getDashboard({ name });
    return (await api.updateDashboard({ name, version: dashboard.version, ...edit(contentOf(dashboard)) })).dashboard;
  };
  try {
    return await attempt();
  } catch (err) {
    if (err instanceof ConflictError) {
      return attempt();
    }
    throw err;
  }
}
