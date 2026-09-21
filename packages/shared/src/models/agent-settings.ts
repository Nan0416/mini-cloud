/**
 * The `agent` section of `~/.mini-cloud/config.json`, every field optional.
 *
 * Lives in `shared` because both sides need it and neither may import the other: the
 * service parses this shape out of the file, and the agent applies the defaults.
 */
export interface AgentSettings {
  /** Defaults to this machine's hostname. */
  readonly id?: string;
  /** Defaults to the id. */
  readonly name?: string;
  /** The service's *internal* listener, which is where agents report. */
  readonly internalUrl?: string;
  /** Loopback port for the reporter API. */
  readonly port?: number;
  /** Root for offline reports and default stdout/stderr files. */
  readonly workDir?: string;
  readonly heartbeatIntervalMs?: number;
  readonly healthCheckTickMs?: number;
  readonly passiveToleranceMs?: number;
  readonly pingFailureThreshold?: number;
  /** How often the agent drains the metrics spool. One aggregation window. */
  readonly metricsTickMs?: number;
  /** Where launched programs write their EMF documents for the agent to pick up. */
  readonly metricsSpoolDir?: string;
  /** Report this machine's own CPU, memory and disk. */
  readonly hostMetrics?: boolean;
  /** Distinct values one minute of one series may keep, before it is rounded. */
  readonly maxHistogramBuckets?: number;
}
