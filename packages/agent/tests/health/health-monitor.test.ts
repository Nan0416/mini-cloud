import { HealthCheck } from '@mini-cloud/shared';
import { HealthMonitor, healthCheckPeriodMs } from '../../src/health/health-monitor';

const T0 = Date.UTC(2026, 5, 1, 12, 0, 0);

describe('healthCheckPeriodMs', () => {
  it('takes the configured period', () => {
    expect(healthCheckPeriodMs({ type: 'passive', periodInMs: 30_000 })).toBe(30_000);
    expect(healthCheckPeriodMs({ type: 'ping', url: 'http://x', periodInMs: 2_000 })).toBe(2_000);
  });

  it('falls back to five seconds', () => {
    expect(healthCheckPeriodMs({ type: 'passive' })).toBe(5_000);
    expect(healthCheckPeriodMs({ type: 'ping', url: 'http://x' })).toBe(5_000);
  });
});

/**
 * The monitor reports *changes*, not states. A task failing continuously has to
 * produce one event and then silence — reporting every tick would turn one broken
 * service into a flood of identical status writes for as long as it stays broken.
 */
describe('HealthMonitor watching', () => {
  const monitor = () => new HealthMonitor({ passiveToleranceMs: 1_000, pingFailureThreshold: 3 });

  it('tracks an instance once told to watch it', () => {
    const health = monitor();

    health.watch('i1', { type: 'passive' }, T0);

    expect(health.isWatching('i1')).toBe(true);
  });

  it('starts an instance healthy, so it is not failed during its own startup', async () => {
    const health = monitor();
    health.watch('i1', { type: 'passive', periodInMs: 5_000 }, T0);

    // A task that takes a moment to send its first heartbeat is starting, not broken.
    expect(await health.check(T0)).toEqual([]);
  });

  it('forgets an instance once told to stop', async () => {
    const health = monitor();
    health.watch('i1', { type: 'passive' }, T0);

    health.unwatch('i1');

    expect(health.isWatching('i1')).toBe(false);
    // An instance that has exited must not keep producing unhealthy transitions.
    expect(await health.check(T0 + 3600_000)).toEqual([]);
  });

  it('tolerates unwatching something it never watched', () => {
    expect(() => monitor().unwatch('never-seen')).not.toThrow();
  });

  it('replaces the check when an instance id is watched twice', async () => {
    const health = monitor();
    health.watch('i1', { type: 'passive', periodInMs: 1_000 }, T0);
    health.watch('i1', { type: 'passive', periodInMs: 60_000 }, T0);

    // The relaunch's longer period applies; keeping the first would fail the new run.
    expect(await health.check(T0 + 10_000)).toEqual([]);
  });
});

describe('HealthMonitor passive checks', () => {
  const monitor = () => new HealthMonitor({ passiveToleranceMs: 1_000, pingFailureThreshold: 3 });

  it('stays healthy while heartbeats keep arriving', async () => {
    const health = monitor();
    health.watch('i1', { type: 'passive', periodInMs: 5_000 }, T0);

    health.recordHeartbeat('i1', T0 + 4_000);

    expect(await health.check(T0 + 5_000)).toEqual([]);
  });

  it('allows the period plus a tolerance, because a heartbeat routinely arrives late', async () => {
    const health = monitor();
    health.watch('i1', { type: 'passive', periodInMs: 5_000 }, T0);

    // 6000 = period + tolerance exactly; a task under load is not a task that died.
    expect(await health.check(T0 + 6_000)).toEqual([]);
    expect(await health.check(T0 + 6_001)).toEqual([{ instanceId: 'i1', health: 'unhealthy' }]);
  });

  it('reports the transition once, not on every tick', async () => {
    const health = monitor();
    health.watch('i1', { type: 'passive', periodInMs: 5_000 }, T0);

    expect(await health.check(T0 + 20_000)).toEqual([{ instanceId: 'i1', health: 'unhealthy' }]);
    expect(await health.check(T0 + 25_000)).toEqual([]);
    expect(await health.check(T0 + 30_000)).toEqual([]);
  });

  it('reports recovery when heartbeats resume', async () => {
    const health = monitor();
    health.watch('i1', { type: 'passive', periodInMs: 5_000 }, T0);
    await health.check(T0 + 20_000);

    health.recordHeartbeat('i1', T0 + 21_000);

    // A passive task that comes back has to be able to clear its own failure.
    expect(await health.check(T0 + 22_000)).toEqual([{ instanceId: 'i1', health: 'healthy' }]);
  });

  it('ignores a heartbeat from an instance it is not watching', () => {
    const health = monitor();

    // A task that outlived a relaunch keeps heartbeating; that is not an error.
    expect(() => health.recordHeartbeat('unknown', T0)).not.toThrow();
  });

  it('uses the default period when the check does not name one', async () => {
    const health = monitor();
    health.watch('i1', { type: 'passive' }, T0);

    // 5000 default + 1000 tolerance.
    expect(await health.check(T0 + 6_000)).toEqual([]);
    expect(await health.check(T0 + 6_001)).toEqual([{ instanceId: 'i1', health: 'unhealthy' }]);
  });
});

describe('HealthMonitor ping checks', () => {
  const pingCheck: HealthCheck = { type: 'ping', url: 'http://127.0.0.1:8080/healthz', periodInMs: 5_000 };

  const monitor = (ping: jest.Mock) => new HealthMonitor({ passiveToleranceMs: 1_000, pingFailureThreshold: 3, ping });

  it('probes the configured url', async () => {
    const ping = jest.fn().mockResolvedValue(true);
    const health = monitor(ping);
    health.watch('i1', pingCheck, T0);

    await health.check(T0 + 5_000);

    expect(ping).toHaveBeenCalledWith('http://127.0.0.1:8080/healthz', expect.any(Number));
  });

  it('does not probe until the instance is actually due', async () => {
    const ping = jest.fn().mockResolvedValue(true);
    const health = monitor(ping);
    health.watch('i1', pingCheck, T0);

    // The monitor ticks faster than the check's period; probing every tick would
    // multiply the load on the task being checked.
    await health.check(T0 + 1_000);
    await health.check(T0 + 4_999);

    expect(ping).not.toHaveBeenCalled();
  });

  it('caps the probe timeout at three seconds', async () => {
    const ping = jest.fn().mockResolvedValue(true);
    const health = monitor(ping);
    health.watch('i1', { type: 'ping', url: 'http://x', periodInMs: 60_000 }, T0);

    await health.check(T0 + 60_000);

    // Otherwise a slow probe on a one-minute check would hold the tick for a minute.
    expect(ping).toHaveBeenCalledWith('http://x', 3_000);
  });

  it('uses the period as the timeout when it is shorter than the cap', async () => {
    const ping = jest.fn().mockResolvedValue(true);
    const health = monitor(ping);
    health.watch('i1', { type: 'ping', url: 'http://x', periodInMs: 1_000 }, T0);

    await health.check(T0 + 1_000);

    expect(ping).toHaveBeenCalledWith('http://x', 1_000);
  });

  it('tolerates a single failed probe, because one blip is not an outage', async () => {
    const ping = jest.fn().mockResolvedValue(false);
    const health = monitor(ping);
    health.watch('i1', pingCheck, T0);

    expect(await health.check(T0 + 5_000)).toEqual([]);
    expect(await health.check(T0 + 10_000)).toEqual([]);
  });

  it('calls it unhealthy on the configured number of consecutive failures', async () => {
    const ping = jest.fn().mockResolvedValue(false);
    const health = monitor(ping);
    health.watch('i1', pingCheck, T0);

    await health.check(T0 + 5_000);
    await health.check(T0 + 10_000);

    expect(await health.check(T0 + 15_000)).toEqual([{ instanceId: 'i1', health: 'unhealthy' }]);
  });

  it('resets the failure count on any success', async () => {
    const ping = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValue(false);
    const health = monitor(ping);
    health.watch('i1', pingCheck, T0);

    // fail, fail, succeed — the two failures must not carry over and trip the
    // threshold on the next single failure.
    await health.check(T0 + 5_000);
    await health.check(T0 + 10_000);
    await health.check(T0 + 15_000);

    expect(await health.check(T0 + 20_000)).toEqual([]);
  });

  it('reports the transition once while the probe keeps failing', async () => {
    const ping = jest.fn().mockResolvedValue(false);
    const health = monitor(ping);
    health.watch('i1', pingCheck, T0);

    await health.check(T0 + 5_000);
    await health.check(T0 + 10_000);
    expect(await health.check(T0 + 15_000)).toEqual([{ instanceId: 'i1', health: 'unhealthy' }]);
    expect(await health.check(T0 + 20_000)).toEqual([]);
    expect(await health.check(T0 + 25_000)).toEqual([]);
  });

  it('reports recovery on the first successful probe', async () => {
    const ping = jest.fn().mockResolvedValue(false);
    const health = monitor(ping);
    health.watch('i1', pingCheck, T0);
    await health.check(T0 + 5_000);
    await health.check(T0 + 10_000);
    await health.check(T0 + 15_000);

    ping.mockResolvedValue(true);

    // Recovery needs no threshold: one good answer proves it is serving again.
    expect(await health.check(T0 + 20_000)).toEqual([{ instanceId: 'i1', health: 'healthy' }]);
  });
});

describe('HealthMonitor across several instances', () => {
  it('checks them all and reports only the ones that changed', async () => {
    const ping = jest.fn().mockResolvedValue(false);
    const health = new HealthMonitor({ passiveToleranceMs: 1_000, pingFailureThreshold: 1, ping });
    health.watch('passive-ok', { type: 'passive', periodInMs: 60_000 }, T0);
    health.watch('passive-bad', { type: 'passive', periodInMs: 1_000 }, T0);
    health.watch('ping-bad', { type: 'ping', url: 'http://x', periodInMs: 1_000 }, T0);

    const transitions = await health.check(T0 + 5_000);

    expect(transitions.map((transition) => transition.instanceId).sort()).toEqual(['passive-bad', 'ping-bad']);
  });

  it('reports nothing when it is watching nothing', async () => {
    const health = new HealthMonitor({ passiveToleranceMs: 1_000, pingFailureThreshold: 3 });

    expect(await health.check(T0)).toEqual([]);
  });

  it("does not let one instance's slow probe serialise the others", async () => {
    const order: string[] = [];
    const ping = jest.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('slow')) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      order.push(url);
      return true;
    });
    const health = new HealthMonitor({ passiveToleranceMs: 1_000, pingFailureThreshold: 3, ping });
    health.watch('a', { type: 'ping', url: 'http://slow', periodInMs: 1_000 }, T0);
    health.watch('b', { type: 'ping', url: 'http://fast', periodInMs: 1_000 }, T0);

    await health.check(T0 + 1_000);

    // Probed concurrently: a fleet of twenty services must not take twenty timeouts
    // to complete one tick.
    expect(order).toEqual(['http://fast', 'http://slow']);
  });
});
