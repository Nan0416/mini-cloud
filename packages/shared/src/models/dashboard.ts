import { MetricQuery, MetricTimeRange } from './metric-graph';

export const DASHBOARD_LIMITS = {
  nameLength: 255,
  widgets: 50,
  titleLength: 255,
  /** Same rule as a query `Id`, so a widget can be named in a link the same way. */
  widgetIdLength: 255,
} as const;

/** One graph on a dashboard. The dashboard, not the widget, decides its time window. */
export interface DashboardWidget {
  /** Unique within the dashboard and kept across edits, so a link can name the widget. */
  readonly id: string;
  /** Absent means the console titles it from its queries. */
  readonly title?: string;
  readonly queries: ReadonlyArray<MetricQuery>;
}

/** What a caller writes. Everything a dashboard is, apart from what the service keeps for it. */
export interface DashboardContent {
  readonly widgets: ReadonlyArray<DashboardWidget>;
  /** Where the dashboard opens when a link names no window. Absent means the console's default. */
  readonly defaultRange?: MetricTimeRange;
  /** A whole number of minutes. Absent means the automatic period for the window. */
  readonly defaultPeriodMs?: number;
}

export interface Dashboard extends DashboardContent {
  /** The dashboard's identity and the key in its link. It cannot be renamed. */
  readonly name: string;
  /**
   * Bumped on every save, and required back on the next one, so two tabs saving over
   * each other get a conflict instead of one silently discarding the other's widget.
   */
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}
