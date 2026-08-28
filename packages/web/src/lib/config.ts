export interface WebConfig {
  /**
   * Base URL baked in at build time, when the bundle was built with one. A *default*,
   * not the source of truth: a link, and then this browser's stored choice, both win
   * over it. Its absence is what makes the setup screen appear.
   */
  readonly defaultApiUrl?: string;
  /** Bearer token baked in at build time, for a bundle built against one service. */
  readonly defaultToken?: string;
  /** How often list views refetch, in ms. */
  readonly listPollMs: number;
  /** How often a detail view of something in flight refetches, in ms. */
  readonly detailPollMs: number;
  /**
   * Longer than the client's 10s default. A home server can be slow to wake a
   * sleeping disk, and a spurious "unreachable" banner is worse than a slow table.
   */
  readonly requestTimeoutMs: number;
  /** Offered in the setup screen's field, because it is right far more often than not. */
  readonly suggestedApiUrl: string;
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
  // No fallback here any more. A bundle built without VITE_MINI_CLOUD_API_URL used to
  // silently assume 127.0.0.1:3000, which is right on the machine running the service
  // and wrong everywhere else — including a hosted copy, where it produced an offline
  // banner and no way to say otherwise. Unset now means "ask", which is the honest
  // answer and the whole point of this screen.
  const apiUrl = readString(import.meta.env.VITE_MINI_CLOUD_API_URL);
  return {
    defaultApiUrl: apiUrl === undefined ? undefined : apiUrl.replace(/\/+$/, ''),
    defaultToken: readString(import.meta.env.VITE_MINI_CLOUD_TOKEN),
    // Slow enough not to hammer a home server, fast enough that a launch shows up
    // before you reach for the refresh button.
    listPollMs: 10_000,
    detailPollMs: 4_000,
    requestTimeoutMs: 15_000,
    suggestedApiUrl: 'http://127.0.0.1:3000',
  };
}

export const config: WebConfig = loadConfig();
