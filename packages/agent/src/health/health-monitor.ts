import { HealthCheck, LoggerFactory, PassiveHealthCheck, PingHealthCheck } from '@mini-cloud/shared';

const logger = LoggerFactory.getLogger('HealthMonitor');

const DEFAULT_PERIOD_MS = 5_000;

export type Health = 'healthy' | 'unhealthy';

export interface HealthTransition {
  readonly instanceId: string;
  readonly health: Health;
}

export interface HealthMonitorProps {
  readonly passiveToleranceMs: number;
  readonly pingFailureThreshold: number;
  /** Injectable so tests do not have to make real HTTP calls. */
  readonly ping?: (url: string, timeoutMs: number) => Promise<boolean>;
}

interface WatchedInstance {
  readonly instanceId: string;
  readonly check: HealthCheck;
  readonly periodMs: number;
  /** Passive checks only: when the task last said it was alive. */
  lastHeartbeatAt: number;
  /** Ping checks only: when we last probed, and how many probes have failed in a row. */
  lastPingAt: number;
  consecutiveFailures: number;
  health: Health;
}

export function healthCheckPeriodMs(check: HealthCheck): number {
  return check.periodInMs ?? DEFAULT_PERIOD_MS;
}

async function defaultPing(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Tracks the health of every instance this agent is supervising.
 *
 * Two styles are supported for one reason: a task that already serves HTTP is
 * cheapest to check by polling it, while a task with no server has to push a
 * heartbeat instead. Both reduce to the same healthy/unhealthy signal here, and only
 * *changes* are reported — a task that is failing continuously produces one event,
 * not one per tick.
 */
export class HealthMonitor {
  private readonly instances = new Map<string, WatchedInstance>();
  private readonly props: HealthMonitorProps;
  private readonly ping: (url: string, timeoutMs: number) => Promise<boolean>;

  constructor(props: HealthMonitorProps) {
    this.props = props;
    this.ping = props.ping ?? defaultPing;
  }

  watch(instanceId: string, check: HealthCheck, now: number = Date.now()): void {
    const periodMs = healthCheckPeriodMs(check);
    logger.info(`Watching instance ${instanceId} with a ${check.type} health check every ${periodMs}ms.`);
    this.instances.set(instanceId, {
      instanceId,
      check,
      periodMs,
      lastHeartbeatAt: now,
      lastPingAt: now,
      consecutiveFailures: 0,
      // Start healthy so a task is not reported failing during its own startup.
      health: 'healthy',
    });
  }

  unwatch(instanceId: string): void {
    if (this.instances.delete(instanceId)) {
      logger.info(`Stopped watching instance ${instanceId}.`);
    }
  }

  isWatching(instanceId: string): boolean {
    return this.instances.has(instanceId);
  }

  /** Records a heartbeat from a task using a passive check. */
  recordHeartbeat(instanceId: string, now: number = Date.now()): void {
    const instance = this.instances.get(instanceId);
    if (instance === undefined) {
      logger.debug(`Ignoring a heartbeat from instance ${instanceId}, which is not being watched.`);
      return;
    }
    instance.lastHeartbeatAt = now;
  }

  /** Runs every due check and returns only the instances whose health changed. */
  async check(now: number = Date.now()): Promise<ReadonlyArray<HealthTransition>> {
    const transitions: HealthTransition[] = [];

    await Promise.all(
      Array.from(this.instances.values()).map(async (instance) => {
        const health = instance.check.type === 'passive' ? this.evaluatePassive(instance, instance.check, now) : await this.evaluatePing(instance, instance.check, now);

        if (health !== instance.health) {
          instance.health = health;
          transitions.push({ instanceId: instance.instanceId, health });
        }
      }),
    );

    return transitions;
  }

  private evaluatePassive(instance: WatchedInstance, _check: PassiveHealthCheck, now: number): Health {
    const silentFor = now - instance.lastHeartbeatAt;
    // The tolerance absorbs ordinary jitter: a heartbeat sent every `periodMs` will
    // routinely arrive a little late under load.
    return silentFor <= instance.periodMs + this.props.passiveToleranceMs ? 'healthy' : 'unhealthy';
  }

  private async evaluatePing(instance: WatchedInstance, check: PingHealthCheck, now: number): Promise<Health> {
    // The monitor ticks on its own cadence, which is usually faster than the check's
    // period; skip until this instance is actually due.
    if (now - instance.lastPingAt < instance.periodMs) {
      return instance.health;
    }
    instance.lastPingAt = now;

    const url = `${check.domain.replace(/\/+$/, '')}${check.path ?? '/ping'}`;
    const ok = await this.ping(url, Math.min(instance.periodMs, 3_000));

    if (ok) {
      instance.consecutiveFailures = 0;
      return 'healthy';
    }

    instance.consecutiveFailures += 1;
    // A single failed probe is usually a blip; requiring several in a row is what
    // keeps a restarting dependency from paging you.
    if (instance.consecutiveFailures >= this.props.pingFailureThreshold) {
      return 'unhealthy';
    }
    logger.debug(`Instance ${instance.instanceId} failed ${instance.consecutiveFailures} of ${this.props.pingFailureThreshold} probes before being called unhealthy.`);
    return instance.health;
  }
}
