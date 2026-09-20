import { EmfDocument, LoggerFactory } from '@mini-cloud/shared';
import { MemorySink, MetricLogger } from '@mini-cloud/reporter';
import { statfs } from 'node:fs/promises';
import os from 'node:os';

const logger = LoggerFactory.getLogger('HostMetrics');

/** Where a machine's own metrics land. Namespaced like an AWS service would be. */
export const HOST_METRICS_NAMESPACE = 'MiniCloud/Agent';

/** Cumulative CPU time since boot, busy and overall. */
export interface CpuTotals {
  readonly busy: number;
  readonly total: number;
}

export interface HostMetricsProps {
  readonly agentId: string;
  /** Sampled for disk usage, since that is the volume tasks actually write to. */
  readonly workDir: string;
  /**
   * Reads cumulative CPU time. Injected like `HealthMonitor`'s probe, so a test can
   * advance it deliberately — two real samples taken microseconds apart show no
   * elapsed CPU time at all, which is indistinguishable from a bug.
   */
  readonly readCpu?: () => CpuTotals;
}

function cpuTotals(): CpuTotals {
  let busy = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    busy += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle;
  }
  return { busy, total };
}

/**
 * This machine's own CPU, memory and disk.
 *
 * Recorded through the same `MetricLogger` any other program uses, rather than by
 * assembling documents by hand: the agent's own metrics are not a special kind of
 * metric, and a second place that knows how to build the embedded metric format is a
 * second place for it to drift. Validation, dimension handling and the document
 * limits all come for free.
 *
 * CPU is the change in busy time between two samples rather than `loadavg`: load
 * average is a queue length, not a percentage, and it means different things on
 * different kernels. The first sample after a start has no predecessor, so no CPU
 * metric is emitted until the second tick.
 */
export class HostMetrics {
  private readonly props: HostMetricsProps;
  private readonly readCpu: () => CpuTotals;
  private readonly sink = new MemorySink();
  private readonly metrics: MetricLogger;
  private previous?: CpuTotals;

  constructor(props: HostMetricsProps) {
    this.props = props;
    this.readCpu = props.readCpu ?? cpuTotals;
    this.metrics = new MetricLogger({
      sink: this.sink,
      namespace: HOST_METRICS_NAMESPACE,
      // The collector flushes on its own tick and stamps each sample explicitly, so
      // the logger needs neither a boundary timer nor a clock of its own.
      flushOnMinuteBoundary: false,
    });
    // Survives every flush, so this is said once rather than per sample.
    this.metrics.putDimensions({ AgentId: props.agentId });
  }

  async sample(now: number = Date.now()): Promise<ReadonlyArray<EmfDocument>> {
    // The sample was taken now, so say so rather than letting the logger infer it
    // from the first observation — they are the same instant here.
    this.metrics.setTimestamp(now);

    this.recordCpu();
    this.recordMemory();
    await this.recordDisk();

    await this.metrics.flush();
    return this.sink.drain();
  }

  private recordCpu(): void {
    const current = this.readCpu();
    if (this.previous !== undefined) {
      const busy = current.busy - this.previous.busy;
      const total = current.total - this.previous.total;
      if (total > 0) {
        this.metrics.putMetric('CpuUtilization', Math.min(100, Math.max(0, (busy / total) * 100)), 'Percent');
      }
    }
    this.previous = current;
  }

  private recordMemory(): void {
    const total = os.totalmem();
    const free = os.freemem();
    this.metrics.putMetric('MemoryUsed', total - free, 'Bytes');
    this.metrics.putMetric('MemoryAvailable', free, 'Bytes');
    this.metrics.putMetric('MemoryUtilization', total === 0 ? 0 : ((total - free) / total) * 100, 'Percent');
  }

  private async recordDisk(): Promise<void> {
    try {
      const stats = await statfs(this.props.workDir);
      const total = Number(stats.blocks) * Number(stats.bsize);
      const available = Number(stats.bavail) * Number(stats.bsize);
      this.metrics.putMetric('DiskUsed', total - available, 'Bytes');
      this.metrics.putMetric('DiskAvailable', available, 'Bytes');
      this.metrics.putMetric('DiskUtilization', total === 0 ? 0 : ((total - available) / total) * 100, 'Percent');
    } catch (err) {
      // A missing work directory or an unsupported filesystem costs these three
      // metrics, not the whole sample.
      logger.debug(`Could not read disk usage for ${this.props.workDir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
