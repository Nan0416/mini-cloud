export interface WebConfig {
  /** Base URL of the mini-cloud service, without a trailing slash. */
  readonly apiUrl: string;
  /** Bearer token, when the service runs with `MINI_CLOUD_TOKEN` set. */
  readonly token?: string;
  /** How often list views refetch, in ms. */
  readonly listPollMs: number;
  /** How often a detail view of something in flight refetches, in ms. */
  readonly detailPollMs: number;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

/**
 * The single place this package reads `import.meta.env`, mirroring the service's
 * rule that exactly one file reads the environment. Everything else takes the
 * resolved config.
 *
 * Note that Vite inlines these at build time, so changing them means rebuilding.
 */
function loadConfig(): WebConfig {
  const apiUrl = readString(import.meta.env.VITE_MINI_CLOUD_API_URL) ?? 'http://127.0.0.1:3000';
  return {
    apiUrl: apiUrl.replace(/\/+$/, ''),
    token: readString(import.meta.env.VITE_MINI_CLOUD_TOKEN),
    // Slow enough not to hammer a home server, fast enough that a launch shows up
    // before you reach for the refresh button.
    listPollMs: 10_000,
    detailPollMs: 4_000,
  };
}

export const config: WebConfig = loadConfig();
