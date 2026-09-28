import { InvalidRequestError } from '../errors';
import { DASHBOARD_LIMITS, DashboardContent, DashboardWidget } from '../models/dashboard';
import { assertArray, assertKnownFields, assertNonEmptyString, assertOptionalString, assertRecord } from './assertions';
import { parseMetricPeriod, parseMetricQueries, parseMetricTimeRange } from './metric-graph';

/** Something a URL path carries as it is, so a dashboard's link reads as its name. */
const DASHBOARD_NAME = /^[A-Za-z0-9_-]+$/;

const WIDGET_ID = /^[a-z][a-zA-Z0-9_]*$/;

const CONTENT_KEYS = ['widgets', 'defaultRange', 'defaultPeriodMs'];
const WIDGET_KEYS = ['id', 'title', 'queries'];

export function assertDashboardName(value: unknown, field: string): string {
  const name = assertNonEmptyString(value, field);
  if (name.length > DASHBOARD_LIMITS.nameLength || !DASHBOARD_NAME.test(name)) {
    throw new InvalidRequestError(`${field} must be letters, digits, hyphens and underscores, up to ${DASHBOARD_LIMITS.nameLength} characters, like "home-lab"`);
  }
  return name;
}

function parseWidget(value: unknown, field: string): DashboardWidget {
  const record = assertRecord(value, field);
  assertKnownFields(record, field, WIDGET_KEYS);

  const id = assertNonEmptyString(record['id'], `${field}.id`);
  if (id.length > DASHBOARD_LIMITS.widgetIdLength || !WIDGET_ID.test(id)) {
    throw new InvalidRequestError(
      `${field}.id must start with a lowercase letter and hold only letters, digits and underscores, up to ${DASHBOARD_LIMITS.widgetIdLength} characters, like "w1"`,
    );
  }

  const title = assertOptionalString(record['title'], `${field}.title`);
  if (title !== undefined && (title.trim().length === 0 || title.length > DASHBOARD_LIMITS.titleLength)) {
    throw new InvalidRequestError(`${field}.title must be 1 to ${DASHBOARD_LIMITS.titleLength} characters; leave it out for the default`);
  }

  const queries = parseMetricQueries(record['queries'], `${field}.queries`);
  if (queries.length === 0) {
    throw new InvalidRequestError(`${field}.queries is empty; a widget needs at least one query, so remove the widget instead`);
  }

  return { id, title, queries };
}

/**
 * Checks what a caller wrote into a dashboard, and returns it with nothing but the
 * fields the format defines. The same rules as a graph hold per widget.
 */
export function parseDashboardContent(value: unknown, field: string): DashboardContent {
  const record = assertRecord(value, field);
  assertKnownFields(record, field, CONTENT_KEYS);

  const entries = assertArray(record['widgets'], `${field}.widgets`);
  if (entries.length > DASHBOARD_LIMITS.widgets) {
    throw new InvalidRequestError(`${field}.widgets has ${entries.length} entries, more than the ${DASHBOARD_LIMITS.widgets} one dashboard may hold`);
  }

  const ids = new Set<string>();
  const widgets = entries.map((entry, index) => {
    const widget = parseWidget(entry, `${field}.widgets[${index}]`);
    if (ids.has(widget.id)) {
      throw new InvalidRequestError(`${field}.widgets[${index}].id "${widget.id}" is already used by an earlier widget; each needs its own`);
    }
    ids.add(widget.id);
    return widget;
  });

  return {
    widgets,
    defaultRange: record['defaultRange'] === undefined || record['defaultRange'] === null ? undefined : parseMetricTimeRange(record['defaultRange'], `${field}.defaultRange`),
    defaultPeriodMs: parseMetricPeriod(record['defaultPeriodMs'], `${field}.defaultPeriodMs`),
  };
}
