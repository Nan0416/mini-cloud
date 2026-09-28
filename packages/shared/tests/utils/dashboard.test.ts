import { assertDashboardName, parseDashboardContent } from '../../src/utils/dashboard';

const HOUR = 3_600_000;

function aQuery(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'm1', namespace: 'MiniCloud/Agent', metricName: 'CpuUtilization', dimensions: { AgentId: 'nas' }, statistic: 'avg', ...overrides };
}

function aWidget(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'w1', queries: [aQuery()], ...overrides };
}

describe('parseDashboardContent', () => {
  it('accepts a dashboard and returns the same content', () => {
    const content = {
      widgets: [aWidget({ title: 'CPU' }), aWidget({ id: 'w2', queries: [aQuery(), aQuery({ id: 'm2', statistic: 'p99' })] })],
      defaultRange: { kind: 'relative', durationMs: 3 * HOUR },
      defaultPeriodMs: 300_000,
    };

    expect(parseDashboardContent(content, 'dashboard')).toEqual(content);
  });

  it('accepts a dashboard with no widgets, which is where a new one starts', () => {
    expect(parseDashboardContent({ widgets: [] }, 'dashboard')).toEqual({ widgets: [], defaultRange: undefined, defaultPeriodMs: undefined });
  });

  it('holds each widget to the rules of a graph', () => {
    const twice = aWidget({ queries: [aQuery(), aQuery({ id: 'm2' })] });

    expect(() => parseDashboardContent({ widgets: [twice] }, 'dashboard')).toThrow(/dashboard.widgets\[0\].queries\[1\] reads the same series/);
  });

  it('refuses a widget with nothing to plot', () => {
    expect(() => parseDashboardContent({ widgets: [aWidget({ queries: [] })] }, 'dashboard')).toThrow(/at least one query/);
  });

  it('refuses two widgets with one id, which a link could not tell apart', () => {
    expect(() => parseDashboardContent({ widgets: [aWidget(), aWidget()] }, 'dashboard')).toThrow(/widgets\[1\].id "w1" is already used/);
  });

  it('refuses a blank title rather than drawing an empty heading', () => {
    expect(() => parseDashboardContent({ widgets: [aWidget({ title: '  ' })] }, 'dashboard')).toThrow(/title must be 1 to/);
  });

  it('refuses a field it does not define, so a typo is not silently ignored', () => {
    expect(() => parseDashboardContent({ widgets: [], range: {} }, 'dashboard')).toThrow(/dashboard.range is not a field/);
    expect(() => parseDashboardContent({ widgets: [aWidget({ tittle: 'CPU' })] }, 'dashboard')).toThrow(/widgets\[0\].tittle is not a field/);
  });

  it('refuses a default period that is not a whole number of minutes', () => {
    expect(() => parseDashboardContent({ widgets: [], defaultPeriodMs: 90_000 }, 'dashboard')).toThrow(/defaultPeriodMs must be a whole number of minutes/);
  });

  it('refuses more widgets than a dashboard may hold', () => {
    const widgets = Array.from({ length: 51 }, (_, index) => aWidget({ id: `w${index}` }));

    expect(() => parseDashboardContent({ widgets }, 'dashboard')).toThrow(/more than the 50/);
  });
});

describe('assertDashboardName', () => {
  it('accepts a name a link can carry as it is', () => {
    expect(assertDashboardName('home-lab_2', 'name')).toBe('home-lab_2');
  });

  it('refuses a name that would need escaping in a link', () => {
    expect(() => assertDashboardName('home lab', 'name')).toThrow(/letters, digits, hyphens and underscores/);
    expect(() => assertDashboardName('a/b', 'name')).toThrow(/letters, digits, hyphens and underscores/);
    expect(() => assertDashboardName('', 'name')).toThrow();
  });
});
