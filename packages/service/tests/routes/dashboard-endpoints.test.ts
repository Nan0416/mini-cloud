import { CreateDashboardResponse, ErrorResponse, GetDashboardResponse, UpdateDashboardResponse } from '@mini-cloud/shared';
import { DashboardEndpoints } from '../../src/routes/dashboard-endpoints';
import { DashboardService } from '../../src/services/dashboard-service';
import { FakeDashboardDao } from '../data/fake-daos';
import { TestServer } from './test-helpers';

const aWidget = (id: string) => ({
  id,
  queries: [{ id: 'm1', namespace: 'MiniCloud/Agent', metricName: 'CpuUtilization', dimensions: { AgentId: 'nas' }, statistic: 'avg' }],
});

let dashboardDao: FakeDashboardDao;
let server: TestServer;

beforeEach(async () => {
  dashboardDao = new FakeDashboardDao();
  server = await TestServer.start(new DashboardEndpoints({ dashboardService: new DashboardService({ dashboardDao }) }));
});

afterEach(async () => {
  await server.close();
});

describe('dashboard routes', () => {
  it('creates a dashboard and serves it at its name', async () => {
    const created = await server.post<CreateDashboardResponse>('/dashboards', {
      name: 'home',
      widgets: [aWidget('w1')],
      defaultRange: { kind: 'relative', durationMs: 3_600_000 },
    });
    const read = await server.get<GetDashboardResponse>('/dashboards/home');

    expect(created.status).toBe(201);
    expect(read.status).toBe(200);
    expect(read.body.dashboard).toEqual(created.body.dashboard);
    expect(read.body.dashboard.defaultRange).toEqual({ kind: 'relative', durationMs: 3_600_000 });
  });

  it('takes the name from the path on an update, whatever the body says', async () => {
    await server.post('/dashboards', { name: 'home', widgets: [] });

    const response = await server.put<UpdateDashboardResponse>('/dashboards/home', { name: 'other', version: 1, widgets: [aWidget('w1')] });

    expect(response.status).toBe(200);
    expect(response.body.dashboard.name).toBe('home');
    expect(dashboardDao.dashboards.has('other')).toBe(false);
  });

  it('answers 409 for a stale update', async () => {
    await server.post('/dashboards', { name: 'home', widgets: [] });
    await server.put('/dashboards/home', { version: 1, widgets: [aWidget('w1')] });

    const response = await server.put<ErrorResponse>('/dashboards/home', { version: 1, widgets: [] });

    expect(response.status).toBe(409);
    expect(response.body.errorCode).toBe('CONFLICT');
  });

  it('answers 400 for a widget the console could not draw, naming where it is', async () => {
    const response = await server.post<ErrorResponse>('/dashboards', { name: 'home', widgets: [aWidget('w1'), { id: 'w2', queries: [] }] });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('dashboard.widgets[1].queries is empty');
  });

  it('refuses a name a link could not carry as it is', async () => {
    const response = await server.post<ErrorResponse>('/dashboards', { name: 'home lab', widgets: [] });

    expect(response.status).toBe(400);
  });

  it('deletes a dashboard, and answers 404 for it afterwards', async () => {
    await server.post('/dashboards', { name: 'home', widgets: [] });

    expect((await server.delete('/dashboards/home')).status).toBe(200);
    expect((await server.get('/dashboards/home')).status).toBe(404);
  });
});
