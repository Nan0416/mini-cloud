import { CreateMonitorResponse, ErrorResponse, GetMonitorResponse, ListMonitorHistoryResponse, UpdateMonitorResponse } from '@mini-cloud/shared';
import { MonitorEndpoints } from '../../src/routes/monitor-endpoints';
import { MonitorService } from '../../src/services/monitor-service';
import { FakeMonitorDao, FakeNotifierDao } from '../data/fake-daos';
import { TestServer } from './test-helpers';

const aBody = (overrides: Record<string, unknown> = {}) => ({
  metric: { namespace: 'MiniCloud/Agent', metricName: 'CpuUtilization', dimensions: { AgentId: 'nas' }, statistic: 'p99' },
  periodMs: 60_000,
  evaluationPeriods: 5,
  datapointsToAlarm: 3,
  comparison: 'GreaterThanOrEqualToThreshold',
  threshold: 95.5,
  treatMissingData: 'breaching',
  severity: 3,
  notify: false,
  notifierIds: [],
  ...overrides,
});

let monitorDao: FakeMonitorDao;
let server: TestServer;

beforeEach(async () => {
  monitorDao = new FakeMonitorDao();
  server = await TestServer.start(new MonitorEndpoints({ monitorService: new MonitorService({ monitorDao, notifierDao: new FakeNotifierDao(monitorDao) }) }));
});

afterEach(async () => {
  await server.close();
});

describe('monitor routes', () => {
  it('creates a monitor and serves it at its name', async () => {
    const created = await server.post<CreateMonitorResponse>('/monitors', { name: 'nas-cpu', ...aBody() });
    const read = await server.get<GetMonitorResponse>('/monitors/nas-cpu');

    expect(created.status).toBe(201);
    expect(read.body.monitor).toEqual(created.body.monitor);
    expect(read.body.monitor).toMatchObject(aBody());
  });

  it('takes the name from the path on an update, and answers 409 for a stale one', async () => {
    await server.post('/monitors', { name: 'nas-cpu', ...aBody() });

    const saved = await server.put<UpdateMonitorResponse>('/monitors/nas-cpu', { name: 'other', version: 1, ...aBody({ threshold: 99 }) });
    const stale = await server.put<ErrorResponse>('/monitors/nas-cpu', { version: 1, ...aBody() });

    expect(saved.body.monitor.name).toBe('nas-cpu');
    expect(saved.body.monitor.threshold).toBe(99);
    expect(stale.status).toBe(409);
  });

  it('answers 400 naming the field, for a definition that cannot be evaluated', async () => {
    const response = await server.post<ErrorResponse>('/monitors', { name: 'nas-cpu', ...aBody({ datapointsToAlarm: 6 }) });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('monitor.datapointsToAlarm');
  });

  it('serves a monitor’s history, and bounds how much one request may ask for', async () => {
    await server.post('/monitors', { name: 'nas-cpu', ...aBody() });
    await monitorDao.changeState({ name: 'nas-cpu', version: 1, fromState: 'INSUFFICIENT_DATA', toState: 'ALARM', reason: 'hot', datapoints: [], threshold: 95.5, changedAt: 1 });

    const history = await server.get<ListMonitorHistoryResponse>('/monitors/nas-cpu/history?limit=10');

    expect(history.body.changes.map((change) => change.toState)).toEqual(['ALARM']);
    expect((await server.get('/monitors/nas-cpu/history?limit=501')).status).toBe(400);
  });

  it('pages a monitor’s history by the cursor the previous page handed back', async () => {
    await server.post('/monitors', { name: 'nas-cpu', ...aBody() });
    await monitorDao.changeState({ name: 'nas-cpu', version: 1, fromState: 'INSUFFICIENT_DATA', toState: 'OK', reason: 'fine', datapoints: [], threshold: 95.5, changedAt: 1 });
    await monitorDao.changeState({ name: 'nas-cpu', version: 1, fromState: 'OK', toState: 'ALARM', reason: 'hot', datapoints: [], threshold: 95.5, changedAt: 2 });

    const first = await server.get<ListMonitorHistoryResponse>('/monitors/nas-cpu/history?limit=1');
    const second = await server.get<ListMonitorHistoryResponse>(`/monitors/nas-cpu/history?limit=1&after=${first.body.nextCursor}`);

    expect(first.body.changes.map((change) => change.toState)).toEqual(['ALARM']);
    expect(second.body.changes.map((change) => change.toState)).toEqual(['OK']);
    expect(second.body.nextCursor).toBeUndefined();
    for (const after of ['latest', '0', '-1', '1e30', '99999999999999999999']) {
      expect((await server.get(`/monitors/nas-cpu/history?after=${after}`)).status).toBe(400);
    }
  });

  it('deletes a monitor, and answers 404 for it afterwards', async () => {
    await server.post('/monitors', { name: 'nas-cpu', ...aBody() });

    expect((await server.delete('/monitors/nas-cpu')).status).toBe(200);
    expect((await server.get('/monitors/nas-cpu')).status).toBe(404);
  });
});
