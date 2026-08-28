import { ServiceUnreachableError, UnauthenticatedError } from '@mini-cloud/shared';

/** Which service this console is pointed at, and the token it needs to talk to it. */
export interface Connection {
  /** Base URL, without a trailing slash. */
  readonly apiUrl: string;
  /** Bearer token, when the service runs with `MINI_CLOUD_TOKEN` set. */
  readonly token?: string;
}

/** One key, so clearing the connection cannot leave half of it behind. */
const STORAGE_KEY = 'mini-cloud.connection';
/** Separate key: recent URLs outlive the connection, which is the point of them. */
const RECENT_KEY = 'mini-cloud.recent-urls';
const RECENT_LIMIT = 5;

/** The query parameter that makes a link self-configuring. Carries a URL, never a token. */
export const BACKEND_PARAM = 'backend';

// ---- pure helpers ----

/**
 * Trims and drops trailing slashes, so `http://host:3000/` and `http://host:3000`
 * are one connection rather than two entries in the recent list.
 */
export function normalizeApiUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/**
 * Whether a string is usable as a service base URL.
 *
 * Rejected at the prompt rather than at the first request: a typo that reaches the
 * client comes back as `ServiceUnreachableError` minutes later, wearing the same
 * clothes as a service that is genuinely down.
 */
export function isUsableApiUrl(raw: string): boolean {
  const normalized = normalizeApiUrl(raw);
  if (normalized.length === 0) {
    return false;
  }
  try {
    const url = new URL(normalized);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Reads `?backend=` out of a query string. Percent-encoded, so a path survives. */
export function parseBackendParam(search: string): string | undefined {
  const value = new URLSearchParams(search).get(BACKEND_PARAM);
  if (value === null || !isUsableApiUrl(value)) {
    return undefined;
  }
  return normalizeApiUrl(value);
}

/** The candidates a connection can come from, in the order they are tried. */
export interface ConnectionSources {
  /** `?backend=` — a shared link or a bookmark configuring itself. */
  readonly fromQuery?: string;
  /** What this browser was using last. */
  readonly fromStorage?: Connection;
  /** `VITE_MINI_CLOUD_API_URL`, for anyone building their own bundle. */
  readonly fromBuild?: Connection;
}

/**
 * Picks the connection to open with, or nothing — which is what makes the setup
 * screen appear.
 *
 * The order is deliberate. A link wins so that sharing one works and a bookmark can
 * carry its own configuration; storage wins next so a returning visitor is not asked
 * twice; a baked-in URL comes last but still counts, which is what keeps a
 * self-built bundle behaving exactly as it did before this existed. Only when all
 * three are absent — the hosted build, first visit — is there nothing to do but ask.
 *
 * A URL from the query keeps the stored token: switching between two machines that
 * share a fleet token should not mean retyping it.
 */
export function resolveConnection(sources: ConnectionSources): Connection | undefined {
  if (sources.fromQuery !== undefined) {
    const token = sources.fromQuery === sources.fromStorage?.apiUrl ? sources.fromStorage.token : undefined;
    return { apiUrl: normalizeApiUrl(sources.fromQuery), token };
  }
  if (sources.fromStorage !== undefined) {
    return sources.fromStorage;
  }
  return sources.fromBuild;
}

/** What probing a candidate service told us. */
export type ProbeOutcome =
  /** Reachable, and it answered an authenticated call. */
  | 'ok'
  /** Reachable, but it wants a token and none was given. */
  | 'needs-token'
  /** Reachable, and it refused the token given. */
  | 'bad-token'
  /** Nothing answered — down, blocked, or refused before it ever left the browser. */
  | 'unreachable'
  /** It answered, but not in a way this console understands. */
  | 'error';

/**
 * Turns a failed probe into the thing to tell the user.
 *
 * Kept separate from the request so the interesting cases are testable without a
 * server. The distinction that earns its place is `needs-token` versus `bad-token`:
 * a 401 with no token means "this service wants one, here is the field", and a 401
 * with one means "the one you gave is wrong" — guessing between them is the
 * difference between a setup screen that helps and one that just says no.
 */
export function classifyProbeFailure(error: unknown, hadToken: boolean): ProbeOutcome {
  if (error instanceof ServiceUnreachableError) {
    return 'unreachable';
  }
  if (error instanceof UnauthenticatedError) {
    return hadToken ? 'bad-token' : 'needs-token';
  }
  return 'error';
}

// ---- storage ----

/**
 * `localStorage` when asked to remember, `sessionStorage` when not.
 *
 * Worth saying plainly: a token in either is readable by any script on this origin.
 * For a home lab that is proportionate; on a shared machine `sessionStorage` at
 * least ends it with the tab. Both throw rather than return null in a browser
 * configured to block site data, so every access here is guarded.
 */
function stores(): ReadonlyArray<Storage> {
  try {
    return [window.localStorage, window.sessionStorage];
  } catch {
    return [];
  }
}

function parseConnection(raw: string): Connection | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return undefined;
    }
    const record: Record<string, unknown> = { ...parsed };
    const apiUrl = record['apiUrl'];
    const token = record['token'];
    if (typeof apiUrl !== 'string' || !isUsableApiUrl(apiUrl)) {
      return undefined;
    }
    return { apiUrl: normalizeApiUrl(apiUrl), token: typeof token === 'string' && token.length > 0 ? token : undefined };
  } catch {
    // Someone else's key, or a half-written value. Asking again beats crashing on load.
    return undefined;
  }
}

export function readStoredConnection(): Connection | undefined {
  for (const store of stores()) {
    try {
      const raw = store.getItem(STORAGE_KEY);
      if (raw !== null) {
        const parsed = parseConnection(raw);
        if (parsed !== undefined) {
          return parsed;
        }
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

export function storeConnection(connection: Connection, remember: boolean): void {
  const [local, session] = stores();
  if (local === undefined || session === undefined) {
    return;
  }
  const target = remember ? local : session;
  const other = remember ? session : local;
  try {
    target.setItem(STORAGE_KEY, JSON.stringify(connection));
    // Cleared, or the next load reads the stale copy from the store we stopped using.
    other.removeItem(STORAGE_KEY);
    rememberRecentUrl(connection.apiUrl);
  } catch {
    // A browser blocking site data still gets a working console for this page view.
  }
}

export function clearStoredConnection(): void {
  for (const store of stores()) {
    try {
      store.removeItem(STORAGE_KEY);
    } catch {
      continue;
    }
  }
}

/** Most recent first, so switching between two machines is a click. */
export function readRecentUrls(): ReadonlyArray<string> {
  const [local] = stores();
  if (local === undefined) {
    return [];
  }
  try {
    const raw = local.getItem(RECENT_KEY);
    if (raw === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === 'string' && isUsableApiUrl(entry)).slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

function rememberRecentUrl(apiUrl: string): void {
  const [local] = stores();
  if (local === undefined) {
    return;
  }
  const next = [apiUrl, ...readRecentUrls().filter((entry) => entry !== apiUrl)].slice(0, RECENT_LIMIT);
  try {
    local.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Recents are a convenience; losing them costs a retype and nothing else.
  }
}
