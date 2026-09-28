import { ConflictError, DashboardWidget, NotFoundError } from '@mini-cloud/shared';
import { DashboardService } from '../../src/services/dashboard-service';
import { FakeDashboardDao } from '../data/fake-daos';

const aWidget = (id: string): DashboardWidget => ({
  id,
  queries: [{ id: 'm1', namespace: 'MiniCloud/Agent', metricName: 'CpuUtilization', dimensions: { AgentId: 'nas' }, statistic: 'avg' }],
});

const context = () => {
  const dashboardDao = new FakeDashboardDao();
  return { dashboardDao, service: new DashboardService({ dashboardDao }) };
};

describe('DashboardService', () => {
  it('creates a dashboard at version 1 and reads it back', async () => {
    const { service } = context();

    await service.createDashboard({ name: 'home', widgets: [aWidget('w1')] });
    const { dashboard } = await service.getDashboard({ name: 'home' });

    expect(dashboard.version).toBe(1);
    expect(dashboard.widgets.map((widget) => widget.id)).toEqual(['w1']);
  });

  it('refuses to create over a name that is taken, rather than replacing it', async () => {
    const { service } = context();
    await service.createDashboard({ name: 'home', widgets: [aWidget('w1')] });

    await expect(service.createDashboard({ name: 'home', widgets: [] })).rejects.toThrow(ConflictError);
    expect((await service.getDashboard({ name: 'home' })).dashboard.widgets).toHaveLength(1);
  });

  it('saves an edit made from the current version, and moves the version on', async () => {
    const { service } = context();
    await service.createDashboard({ name: 'home', widgets: [aWidget('w1')] });

    const { dashboard } = await service.updateDashboard({ name: 'home', version: 1, widgets: [aWidget('w1'), aWidget('w2')] });

    expect(dashboard.version).toBe(2);
    expect(dashboard.widgets).toHaveLength(2);
  });

  it('refuses an edit made from an older version, so a second tab cannot drop the first tab’s widget', async () => {
    const { service } = context();
    await service.createDashboard({ name: 'home', widgets: [] });
    await service.updateDashboard({ name: 'home', version: 1, widgets: [aWidget('w1')] });

    const stale = service.updateDashboard({ name: 'home', version: 1, widgets: [aWidget('w2')] });

    await expect(stale).rejects.toThrow(ConflictError);
    await expect(stale).rejects.toThrow(/at version 2 now/);
    expect((await service.getDashboard({ name: 'home' })).dashboard.widgets.map((widget) => widget.id)).toEqual(['w1']);
  });

  it('says a dashboard is gone, not that it conflicts, when saving one that was deleted', async () => {
    const { service } = context();

    await expect(service.updateDashboard({ name: 'home', version: 1, widgets: [] })).rejects.toThrow(NotFoundError);
  });

  it('answers not found for a dashboard that does not exist', async () => {
    const { service } = context();

    await expect(service.getDashboard({ name: 'home' })).rejects.toThrow(NotFoundError);
    await expect(service.deleteDashboard({ name: 'home' })).rejects.toThrow(NotFoundError);
  });

  it('lists dashboards by name', async () => {
    const { service } = context();
    await service.createDashboard({ name: 'storage', widgets: [] });
    await service.createDashboard({ name: 'home', widgets: [] });

    expect((await service.listDashboards()).dashboards.map((dashboard) => dashboard.name)).toEqual(['home', 'storage']);
  });
});
