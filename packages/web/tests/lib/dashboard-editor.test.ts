import {
  ConflictError,
  type Dashboard,
  type DashboardContent,
  type DashboardWidget,
  type GetDashboardRequest,
  type MetricQuery,
  type UpdateDashboardRequest,
} from '@mini-cloud/shared';
import {
  dashboardNameProblem,
  defaultWindowOf,
  saveDashboardEdit,
  graphOf,
  nextWidgetId,
  titleOf,
  withWidgetAdded,
  withWidgetMoved,
  withWidgetQueries,
  withWidgetRemoved,
  withWidgetTitle,
} from '@/lib/dashboard-editor';

const aQuery = (overrides: Partial<MetricQuery> = {}): MetricQuery => ({
  id: 'm1',
  namespace: 'MiniCloud/Agent',
  metricName: 'CpuUtilization',
  dimensions: { AgentId: 'nas' },
  statistic: 'avg',
  ...overrides,
});

const aWidget = (id: string, overrides: Partial<DashboardWidget> = {}): DashboardWidget => ({ id, queries: [aQuery()], ...overrides });

const content = (...widgets: ReadonlyArray<DashboardWidget>): DashboardContent => ({ widgets });

const ids = (edited: DashboardContent) => edited.widgets.map((widget) => widget.id);

describe('nextWidgetId', () => {
  it('takes the first free w<n>, so a removed widget’s id is reused rather than growing forever', () => {
    expect(nextWidgetId([])).toBe('w1');
    expect(nextWidgetId([aWidget('w1'), aWidget('w3')])).toBe('w2');
  });
});

describe('titleOf', () => {
  it('uses the widget’s own title, then its one series, then a count', () => {
    expect(titleOf(aWidget('w1', { title: 'CPU' }))).toBe('CPU');
    expect(titleOf(aWidget('w1'))).toBe('CpuUtilization · nas · avg');
    expect(titleOf(aWidget('w1', { queries: [aQuery(), aQuery({ id: 'm2', statistic: 'max' })] }))).toBe('2 series');
  });
});

describe('editing widgets', () => {
  it('adds a widget at the end with a fresh id', () => {
    const edited = withWidgetAdded(content(aWidget('w1')), [aQuery()], 'Disk');

    expect(ids(edited)).toEqual(['w1', 'w2']);
    expect(edited.widgets[1].title).toBe('Disk');
  });

  it('replaces one widget’s queries and leaves the others alone', () => {
    const queries = [aQuery({ statistic: 'p99' })];

    const edited = withWidgetQueries(content(aWidget('w1'), aWidget('w2', { title: 'Keep' })), 'w1', queries);

    expect(edited.widgets[0].queries).toEqual(queries);
    expect(edited.widgets[1]).toEqual(aWidget('w2', { title: 'Keep' }));
  });

  it('refuses to save into a widget that was removed meanwhile, rather than dropping the edit silently', () => {
    expect(() => withWidgetQueries(content(aWidget('w2')), 'w1', [aQuery()])).toThrow(/no longer has that graph/);
  });

  it('clears a title set to blank, so the heading falls back to the series', () => {
    expect(withWidgetTitle(content(aWidget('w1', { title: 'CPU' })), 'w1', '   ').widgets[0].title).toBeUndefined();
    expect(withWidgetTitle(content(aWidget('w1')), 'w1', ' Disk ').widgets[0].title).toBe('Disk');
  });

  it('moves a widget one place, and leaves one at the edge where it is', () => {
    const three = content(aWidget('w1'), aWidget('w2'), aWidget('w3'));

    expect(ids(withWidgetMoved(three, 'w2', -1))).toEqual(['w2', 'w1', 'w3']);
    expect(ids(withWidgetMoved(three, 'w2', 1))).toEqual(['w1', 'w3', 'w2']);
    expect(ids(withWidgetMoved(three, 'w1', -1))).toEqual(['w1', 'w2', 'w3']);
  });

  it('removes a widget', () => {
    expect(ids(withWidgetRemoved(content(aWidget('w1'), aWidget('w2')), 'w1'))).toEqual(['w2']);
  });
});

describe('graphOf', () => {
  it('draws a widget over the dashboard’s window, not one of its own', () => {
    const graph = graphOf(aWidget('w1'), { range: { kind: 'relative', durationMs: 86_400_000 }, periodMs: 3_600_000 });

    expect(graph.range).toEqual({ kind: 'relative', durationMs: 86_400_000 });
    expect(graph.periodMs).toBe(3_600_000);
    expect(graph.queries).toEqual([aQuery()]);
  });
});

describe('dashboardNameProblem', () => {
  it('says nothing about a blank name, which is simply not finished yet', () => {
    expect(dashboardNameProblem('', [])).toBeUndefined();
  });

  it('refuses a name a link could not carry, or one already taken', () => {
    expect(dashboardNameProblem('home lab', [])).toMatch(/letters, digits/);
    expect(dashboardNameProblem('home', ['home'])).toMatch(/already a dashboard/);
    expect(dashboardNameProblem('home', ['storage'])).toBeUndefined();
  });
});

/** Stores one dashboard and holds the service's version guard, with a hook to save in between a read and a write. */
class FakeDashboards {
  dashboard: Dashboard = { name: 'home', widgets: [], version: 1, createdAt: 0, updatedAt: 0 };
  /** Runs after each read, as another tab saving at that moment would. */
  afterRead: () => void = () => {};
  reads = 0;

  getDashboard = async (_request: GetDashboardRequest) => {
    this.reads += 1;
    const read = { dashboard: this.dashboard };
    this.afterRead();
    return read;
  };

  updateDashboard = async (request: UpdateDashboardRequest) => {
    if (request.version !== this.dashboard.version) {
      throw new ConflictError('saved elsewhere');
    }
    this.dashboard = { ...this.dashboard, widgets: request.widgets, version: this.dashboard.version + 1 };
    return { dashboard: this.dashboard };
  };

  /** Another tab adding a widget. */
  saveElsewhere(id: string): void {
    this.dashboard = { ...this.dashboard, widgets: [...this.dashboard.widgets, aWidget(id)], version: this.dashboard.version + 1 };
  }
}

describe('saveDashboardEdit', () => {
  it('applies the edit to the dashboard as stored, keeping a widget added elsewhere since the page loaded', async () => {
    const api = new FakeDashboards();
    api.saveElsewhere('w1');

    const saved = await saveDashboardEdit(api, 'home', (current) => withWidgetAdded(current, [aQuery()], undefined));

    expect(ids(saved)).toEqual(['w1', 'w2']);
  });

  it('reads again and reapplies the edit when another save lands between its read and its write', async () => {
    const api = new FakeDashboards();
    let raced = false;
    api.afterRead = () => {
      if (!raced) {
        raced = true;
        api.saveElsewhere('w1');
      }
    };

    const saved = await saveDashboardEdit(api, 'home', (current) => withWidgetAdded(current, [aQuery()], undefined));

    expect(api.reads).toBe(2);
    expect(ids(saved)).toEqual(['w1', 'w2']);
  });

  it('gives up after a second lost race rather than retrying forever', async () => {
    const api = new FakeDashboards();
    let count = 0;
    api.afterRead = () => api.saveElsewhere(`w${(count += 1) + 10}`);

    await expect(saveDashboardEdit(api, 'home', (current) => current)).rejects.toThrow(ConflictError);
    expect(api.reads).toBe(2);
  });
});

const aDashboard = (overrides: Partial<Dashboard> = {}): Dashboard => ({ name: 'home', widgets: [], version: 1, createdAt: 0, updatedAt: 0, ...overrides });
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('defaultWindowOf', () => {
  it('uses the dashboard’s own default, or the metrics page’s three hours', () => {
    expect(defaultWindowOf(aDashboard({ defaultRange: { kind: 'relative', durationMs: DAY }, defaultPeriodMs: HOUR }))).toEqual({
      range: { kind: 'relative', durationMs: DAY },
      periodMs: HOUR,
    });
    expect(defaultWindowOf(aDashboard()).range).toEqual({ kind: 'relative', durationMs: 3 * HOUR });
  });
});
