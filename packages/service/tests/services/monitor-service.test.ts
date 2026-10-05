import { ConflictError, InvalidRequestError, MonitorDefinition, NotFoundError } from '@mini-cloud/shared';
import { MonitorService } from '../../src/services/monitor-service';
import { FakeMonitorDao, FakeNotifierDao, aNotifier } from '../data/fake-daos';

const aDefinition = (overrides: Partial<MonitorDefinition> = {}): MonitorDefinition => ({
  metric: { namespace: 'MiniCloud/Agent', metricName: 'CpuUtilization', dimensions: { AgentId: 'nas' }, statistic: 'avg' },
  periodMs: 300_000,
  evaluationPeriods: 3,
  datapointsToAlarm: 2,
  comparison: 'GreaterThanThreshold',
  threshold: 80,
  treatMissingData: 'missing',
  severity: 3,
  notify: true,
  notifierIds: [],
  ...overrides,
});

const context = () => {
  const monitorDao = new FakeMonitorDao();
  const notifierDao = new FakeNotifierDao(monitorDao);
  return { monitorDao, notifierDao, service: new MonitorService({ monitorDao, notifierDao }) };
};

describe('MonitorService', () => {
  it('creates a monitor that has not been judged yet', async () => {
    const { service } = context();

    const { monitor } = await service.createMonitor({ name: 'nas-cpu', ...aDefinition() });

    expect(monitor.state).toBe('INSUFFICIENT_DATA');
    expect(monitor.stateReason).toMatch(/Not evaluated yet/);
    expect(monitor.version).toBe(1);
  });

  it('refuses to create over a name that is taken', async () => {
    const { service } = context();
    await service.createMonitor({ name: 'nas-cpu', ...aDefinition() });

    await expect(service.createMonitor({ name: 'nas-cpu', ...aDefinition({ threshold: 1 }) })).rejects.toThrow(ConflictError);
  });

  it('saves the notifiers a monitor sends to', async () => {
    const { notifierDao, service } = context();
    notifierDao.seed(aNotifier({ notifierId: 'ntf-a' }));

    const { monitor } = await service.createMonitor({ name: 'nas-cpu', ...aDefinition({ notifierIds: ['ntf-a'] }) });

    expect(monitor.notifierIds).toEqual(['ntf-a']);
  });

  it('refuses a create or an edit naming a notifier that does not exist, and says which', async () => {
    const { notifierDao, service } = context();
    notifierDao.seed(aNotifier({ notifierId: 'ntf-a' }));
    const { monitor } = await service.createMonitor({ name: 'nas-cpu', ...aDefinition() });

    await expect(service.createMonitor({ name: 'other', ...aDefinition({ notifierIds: ['ntf-a', 'ntf-gone'] }) })).rejects.toThrow(/ntf-gone/);
    await expect(service.updateMonitor({ name: 'nas-cpu', version: monitor.version, ...aDefinition({ notifierIds: ['ntf-gone'] }) })).rejects.toThrow(InvalidRequestError);
  });

  it('names a notifier deleted between the check and the save, rather than failing', async () => {
    const { monitorDao, notifierDao, service } = context();
    notifierDao.seed(aNotifier({ notifierId: 'ntf-a' }));
    monitorDao.createMonitor = async () => {
      notifierDao.notifiers.delete('ntf-a');
      return { notifierMissing: true };
    };

    await expect(service.createMonitor({ name: 'nas-cpu', ...aDefinition({ notifierIds: ['ntf-a'] }) })).rejects.toThrow(/no longer exists: ntf-a/);
  });

  it('saves an edit made from the current version, and refuses one made from an older one', async () => {
    const { service } = context();
    await service.createMonitor({ name: 'nas-cpu', ...aDefinition() });

    const { monitor } = await service.updateMonitor({ name: 'nas-cpu', version: 1, ...aDefinition({ threshold: 90 }) });

    expect(monitor.threshold).toBe(90);
    expect(monitor.version).toBe(2);
    await expect(service.updateMonitor({ name: 'nas-cpu', version: 1, ...aDefinition({ threshold: 70 }) })).rejects.toThrow(/at version 2 now/);
  });

  it('keeps the state across an edit, leaving it to the next evaluation', async () => {
    const { service, monitorDao } = context();
    await service.createMonitor({ name: 'nas-cpu', ...aDefinition() });
    await monitorDao.changeState({ name: 'nas-cpu', version: 1, fromState: 'INSUFFICIENT_DATA', toState: 'ALARM', reason: 'hot', datapoints: [], threshold: 80, changedAt: 1 });

    const { monitor } = await service.updateMonitor({ name: 'nas-cpu', version: 1, ...aDefinition({ threshold: 90 }) });

    expect(monitor.state).toBe('ALARM');
  });

  it('answers not found for a monitor that does not exist, including its history', async () => {
    const { service } = context();

    await expect(service.getMonitor({ name: 'nas-cpu' })).rejects.toThrow(NotFoundError);
    await expect(service.updateMonitor({ name: 'nas-cpu', version: 1, ...aDefinition() })).rejects.toThrow(NotFoundError);
    await expect(service.deleteMonitor({ name: 'nas-cpu' })).rejects.toThrow(NotFoundError);
    await expect(service.listMonitorHistory({ name: 'nas-cpu' })).rejects.toThrow(NotFoundError);
  });

  it('lists a monitor’s changes of state, newest first', async () => {
    const { service, monitorDao } = context();
    await service.createMonitor({ name: 'nas-cpu', ...aDefinition() });
    await monitorDao.changeState({ name: 'nas-cpu', version: 1, fromState: 'INSUFFICIENT_DATA', toState: 'OK', reason: 'fine', datapoints: [], threshold: 80, changedAt: 1 });
    await monitorDao.changeState({ name: 'nas-cpu', version: 1, fromState: 'OK', toState: 'ALARM', reason: 'hot', datapoints: [], threshold: 80, changedAt: 2 });

    const { changes } = await service.listMonitorHistory({ name: 'nas-cpu' });

    expect(changes.map((change) => change.toState)).toEqual(['ALARM', 'OK']);
  });
});
