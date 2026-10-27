import { MiniCloudClient, WsSubscriber } from '@mini-cloud/client';
import {
  HeartbeatResponse,
  InternalServiceError,
  ListAgentInstancesResponse,
  ListHealthChecksResponse,
  OfflineReport,
  ReportInstancePidRequest,
  ReportInstancePidResponse,
  ReportInstanceStatusRequest,
  ReportInstanceStatusResponse,
  ReportTaskEventResponse,
} from '@mini-cloud/shared';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MiniCloudAgent } from '../src/agent';
import { AgentConfig, offlineReportPath, resolveAgentConfig } from '../src/agent-config';

const T0 = Date.UTC(2026, 5, 1, 12, 0, 0);

const STARTING_UP = new InternalServiceError('The control plane is starting up. Try again in a moment. (HTTP 503)');

/**
 * Stands in for the service the agent reports to. Stores what it accepts, and answers
 * with `heartbeatError` or `reportError` instead while one is set.
 */
class FakeService {
  readonly pids = new Map<string, number>();
  readonly statuses = new Map<string, string>();
  heartbeatError?: Error;
  reportError?: Error;

  async heartbeat(): Promise<HeartbeatResponse> {
    if (this.heartbeatError !== undefined) {
      throw this.heartbeatError;
    }
    return {};
  }

  async reportInstancePid(request: ReportInstancePidRequest): Promise<ReportInstancePidResponse> {
    if (this.reportError !== undefined) {
      throw this.reportError;
    }
    this.pids.set(request.instanceId, request.pid);
    return {};
  }

  async reportInstanceStatus(request: ReportInstanceStatusRequest): Promise<ReportInstanceStatusResponse> {
    if (this.reportError !== undefined) {
      throw this.reportError;
    }
    this.statuses.set(request.instanceId, request.status);
    return {};
  }

  async reportTaskEvent(): Promise<ReportTaskEventResponse> {
    if (this.reportError !== undefined) {
      throw this.reportError;
    }
    return {};
  }

  async listAgentInstances(): Promise<ListAgentInstancesResponse> {
    return { instances: [] };
  }

  async listHealthChecks(): Promise<ListHealthChecksResponse> {
    return { healthChecks: [] };
  }
}

const connectedSubscriber = {
  connect: async (): Promise<void> => undefined,
  subscribe: async (): Promise<void> => undefined,
  close: async (): Promise<void> => undefined,
};

const pid = (instanceId: string, value: number): OfflineReport => ({ version: 1, type: 'pid', instanceId, pid: value, timestamp: T0 });
const exit = (instanceId: string, code: number): OfflineReport => ({ version: 1, type: 'exit', instanceId, code, timestamp: T0 });
const termination = (instanceId: string): OfflineReport => ({ version: 1, type: 'termination', instanceId, timestamp: T0 });
const event = (instanceId: string, payload: unknown): OfflineReport => ({ version: 1, type: 'event', instanceId, level: 'success', payload, timestamp: T0 });

/**
 * How the agent replays what tasks buffered while they could not reach it. The replayer
 * decides what to keep from the failures it sees; these check that the agent lets it
 * see them, and only replays once the service can take reports at all.
 */
describe('MiniCloudAgent', () => {
  let dir: string;
  let service: FakeService;
  let agent: MiniCloudAgent | undefined;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mini-cloud-agent-'));
    service = new FakeService();
  });

  afterEach(async () => {
    await agent?.stop();
    agent = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  const configWith = (heartbeatIntervalMs: number): AgentConfig =>
    resolveAgentConfig({
      id: 'test-agent',
      workDir: dir,
      port: 0,
      metricsSpoolDir: path.join(dir, 'spool'),
      hostMetrics: false,
      heartbeatIntervalMs,
      healthCheckTickMs: 60_000,
    });

  const start = async (config: AgentConfig = configWith(60_000)): Promise<void> => {
    agent = await MiniCloudAgent.start(config, {
      client: service as unknown as MiniCloudClient,
      newSubscriber: () => connectedSubscriber as unknown as WsSubscriber,
    });
  };

  const buffer = (...reports: ReadonlyArray<OfflineReport>): void => {
    writeFileSync(offlineReportPath(configWith(60_000)), reports.map((report) => `${JSON.stringify(report)}\n`).join(''));
  };

  const buffered = (): ReadonlyArray<OfflineReport> => {
    const filePath = offlineReportPath(configWith(60_000));
    return existsSync(filePath)
      ? readFileSync(filePath, 'utf-8')
          .split('\n')
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line))
      : [];
  };

  it('replays buffered reports once the service answers its heartbeat', async () => {
    buffer(pid('i1', 4211), exit('i1', 1));

    await start();

    expect(service.pids.get('i1')).toBe(4211);
    expect(service.statuses.get('i1')).toBe('exit_failure');
    expect(buffered()).toEqual([]);
  });

  it('leaves buffered reports alone while the service is still starting', async () => {
    service.heartbeatError = STARTING_UP;
    buffer(pid('i1', 4211));

    // The service takes the agent's socket before its HTTP side is ready, so a
    // connected socket says nothing about whether a report would be accepted.
    await start();

    expect(service.pids.size).toBe(0);
    expect(buffered()).toEqual([pid('i1', 4211)]);
  });

  it.each([pid('i1', 4211), exit('i1', 1), termination('i1'), event('i1', 'done')])(
    'keeps a buffered $type report the service refuses, rather than counting it delivered',
    async (report) => {
      service.reportError = STARTING_UP;
      buffer(report);

      // Swallowed on the way to the replayer, the refusal would read as success and the
      // report would be deleted unsent.
      await start();

      expect(buffered()).toEqual([report]);
    },
  );

  it('delivers a kept report on a later heartbeat, without a restart', async () => {
    service.reportError = STARTING_UP;
    buffer(pid('i1', 4211));
    await start(configWith(10));

    service.reportError = undefined;

    // The heartbeat runs on a timer, so there is nothing to await but its effect.
    const deadline = Date.now() + 2_000;
    while (service.pids.get('i1') === undefined && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(service.pids.get('i1')).toBe(4211);
  });
});
