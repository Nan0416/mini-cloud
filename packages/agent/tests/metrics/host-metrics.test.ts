import { expandEmfDocument, validateEmfDocument } from '@mini-cloud/shared';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HOST_METRICS_NAMESPACE, HostMetrics, type CpuTotals } from '../../src/metrics/host-metrics';

const NOW = Date.UTC(2026, 8, 20, 4, 19, 3);

describe('HostMetrics', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'mini-cloud-host-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  const build = (readCpu?: () => CpuTotals) => new HostMetrics({ agentId: 'agent-a', workDir, readCpu });

  /** Cumulative CPU time that advances by a known amount on each read. */
  const advancingCpu = (busyPerRead: number, totalPerRead: number) => {
    let busy = 1_000;
    let total = 10_000;
    return (): CpuTotals => {
      busy += busyPerRead;
      total += totalPerRead;
      return { busy, total };
    };
  };

  it('produces documents the specification accepts', async () => {
    // Built by the same logger any program uses, so this is really a check that
    // nothing here bypasses it.
    const documents = await build().sample(NOW);

    expect(documents.length).toBeGreaterThan(0);
    for (const document of documents) {
      expect(validateEmfDocument(document)).toEqual({ valid: true });
    }
  });

  it('puts every metric in one namespace, under the agent that measured it', async () => {
    const [document] = await build().sample(NOW);

    for (const observation of expandEmfDocument(document)) {
      expect(observation.namespace).toBe(HOST_METRICS_NAMESPACE);
      expect(observation.dimensions).toEqual({ AgentId: 'agent-a' });
    }
  });

  it('stamps the sample with when it was taken', async () => {
    const [document] = await build().sample(NOW);

    expect(document._aws.Timestamp).toBe(NOW);
  });

  it('reports memory and disk on the first sample', async () => {
    const names = expandEmfDocument((await build().sample(NOW))[0]).map((observation) => observation.metricName);

    expect(names).toEqual(expect.arrayContaining(['MemoryUsed', 'MemoryAvailable', 'MemoryUtilization', 'DiskUsed', 'DiskAvailable', 'DiskUtilization']));
  });

  it('withholds CPU until it has two samples to compare', async () => {
    // It is a delta between samples, so the first one has nothing to subtract from.
    const host = build(advancingCpu(25, 100));

    const first = expandEmfDocument((await host.sample(NOW))[0]).map((observation) => observation.metricName);
    const second = expandEmfDocument((await host.sample(NOW + 60_000))[0]).map((observation) => observation.metricName);

    expect(first).not.toContain('CpuUtilization');
    expect(second).toContain('CpuUtilization');
  });

  it('reports the share of CPU time that was busy, as a percentage', async () => {
    // A quarter of the elapsed CPU time spent busy is 25%, not 25 of anything else.
    const host = build(advancingCpu(25, 100));
    await host.sample(NOW);

    const cpu = expandEmfDocument((await host.sample(NOW + 60_000))[0]).find((observation) => observation.metricName === 'CpuUtilization');

    expect(cpu?.unit).toBe('Percent');
    expect(cpu?.values).toEqual([25]);
  });

  it('never reports a utilisation outside 0 to 100, whatever the counters do', async () => {
    // Counters can go backwards across a suspend or a core coming online.
    const host = build(advancingCpu(500, 100));
    await host.sample(NOW);

    const cpu = expandEmfDocument((await host.sample(NOW + 60_000))[0]).find((observation) => observation.metricName === 'CpuUtilization');

    expect(cpu?.values).toEqual([100]);
  });

  it('skips CPU when no time has elapsed between samples', async () => {
    // Two samples microseconds apart show no elapsed CPU time, and a percentage of
    // nothing is not a number worth reporting.
    const host = build(() => ({ busy: 1_000, total: 10_000 }));
    await host.sample(NOW);

    const names = expandEmfDocument((await host.sample(NOW + 60_000))[0]).map((observation) => observation.metricName);

    expect(names).not.toContain('CpuUtilization');
  });

  it('measures bytes in bytes', async () => {
    const memory = expandEmfDocument((await build().sample(NOW))[0]).find((observation) => observation.metricName === 'MemoryUsed');

    expect(memory?.unit).toBe('Bytes');
    expect(memory?.values[0]).toBeGreaterThan(0);
  });

  it('hands each sample over once, rather than repeating the last one', async () => {
    const host = build();
    await host.sample(NOW);

    const second = await host.sample(NOW + 60_000);

    expect(second).toHaveLength(1);
    expect(second[0]._aws.Timestamp).toBe(NOW + 60_000);
  });

  it('still reports memory when the disk cannot be read', async () => {
    // A missing work directory costs three metrics, not the whole sample.
    const host = new HostMetrics({ agentId: 'agent-a', workDir: path.join(workDir, 'does-not-exist') });

    const names = expandEmfDocument((await host.sample(NOW))[0]).map((observation) => observation.metricName);

    expect(names).toContain('MemoryUsed');
    expect(names).not.toContain('DiskUsed');
  });
});
