import { EmfDocument, LoggerFactory } from '@mini-cloud/shared';
import { statfs } from 'node:fs/promises';
import os from 'node:os';

const logger = LoggerFactory.getLogger('HostMetrics');

/** Where a machine's own metrics land. Namespaced like an AWS service would be. */
export const HOST_METRICS_NAMESPACE = 'MiniCloud/Agent';

export interface HostMetricsProps {
  readonly agentId: string;
  /** Sampled for disk usage, since that is the volume tasks actually write to. */
  readonly workDir: string;
}

interface CpuTotals {
  readonly busy: number;
  readonly total: number;
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
 * This machine's own CPU, memory and disk, as embedded metric format documents.
 *
 * CPU is the change in busy time between two samples rather than `loadavg`: load
 * average is a queue length, not a percentage, and it means different things on
 * different kernels. The first sample after a start has no predecessor, so no CPU
 * metric is emitted until the second tick.
 */
export class HostMetrics {
  private readonly props: HostMetricsProps;
  private previous?: CpuTotals;

  constructor(props: HostMetricsProps) {
    this.props = props;
  }

  async sample(now: number = Date.now()): Promise<ReadonlyArray<EmfDocument>> {
    const dimensions = { AgentId: this.props.agentId };
    const documents: EmfDocument[] = [];

    const current = cpuTotals();
    if (this.previous !== undefined) {
      const busy = current.busy - this.previous.busy;
      const total = current.total - this.previous.total;
      if (total > 0) {
        documents.push({
          ...dimensions,
          CpuUtilization: Math.min(100, Math.max(0, (busy / total) * 100)),
          _aws: {
            Timestamp: now,
            CloudWatchMetrics: [{ Namespace: HOST_METRICS_NAMESPACE, Dimensions: [['AgentId']], Metrics: [{ Name: 'CpuUtilization', Unit: 'Percent' }] }],
          },
        });
      }
    }
    this.previous = current;

    const total = os.totalmem();
    const free = os.freemem();
    documents.push({
      ...dimensions,
      MemoryUsed: total - free,
      MemoryAvailable: free,
      MemoryUtilization: total === 0 ? 0 : ((total - free) / total) * 100,
      _aws: {
        Timestamp: now,
        CloudWatchMetrics: [
          {
            Namespace: HOST_METRICS_NAMESPACE,
            Dimensions: [['AgentId']],
            Metrics: [
              { Name: 'MemoryUsed', Unit: 'Bytes' },
              { Name: 'MemoryAvailable', Unit: 'Bytes' },
              { Name: 'MemoryUtilization', Unit: 'Percent' },
            ],
          },
        ],
      },
    });

    const disk = await this.sampleDisk();
    if (disk !== undefined) {
      documents.push({
        ...dimensions,
        DiskUsed: disk.used,
        DiskAvailable: disk.available,
        DiskUtilization: disk.total === 0 ? 0 : (disk.used / disk.total) * 100,
        _aws: {
          Timestamp: now,
          CloudWatchMetrics: [
            {
              Namespace: HOST_METRICS_NAMESPACE,
              Dimensions: [['AgentId']],
              Metrics: [
                { Name: 'DiskUsed', Unit: 'Bytes' },
                { Name: 'DiskAvailable', Unit: 'Bytes' },
                { Name: 'DiskUtilization', Unit: 'Percent' },
              ],
            },
          ],
        },
      });
    }

    return documents;
  }

  private async sampleDisk(): Promise<{ used: number; available: number; total: number } | undefined> {
    try {
      const stats = await statfs(this.props.workDir);
      const total = Number(stats.blocks) * Number(stats.bsize);
      const available = Number(stats.bavail) * Number(stats.bsize);
      return { used: total - available, available, total };
    } catch (err) {
      // A missing work directory or an unsupported filesystem costs one metric, not
      // the whole sample.
      logger.debug(`Could not read disk usage for ${this.props.workDir}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }
}
