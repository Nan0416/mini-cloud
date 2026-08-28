/**
 * Bind addresses from which a browser on this machine reaches the service at
 * `127.0.0.1`.
 *
 * The loopback names because that is all the service is listening on; the wildcards
 * because listening on everything includes loopback. Anything else is one specific
 * interface, and loopback does not reach it.
 */
const LOOPBACK_REACHABLE_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0', '::']);

export interface ConsoleLinkParams {
  /** Where the console is served. Empty suppresses the link entirely. */
  readonly consoleUrl: string;
  /** The address the service is bound to — `config.host`. */
  readonly host: string;
  readonly port: number;
}

/**
 * A link that opens the console already pointed at this service, or nothing when no
 * such link could work.
 *
 * Nothing is the answer surprisingly often, and printing it anyway would be worse
 * than silence: a link in a startup banner that fails costs someone ten minutes
 * assuming the service is at fault.
 *
 * Bound to one specific interface — `MINI_CLOUD_HOST=192.168.1.50` — there is no
 * address that works. `127.0.0.1` does not reach a service listening only on that
 * interface, and the interface's own address is plain HTTP, which a console served
 * over HTTPS is not allowed to call: mixed content blocks a LAN address outright and
 * no response header changes it.
 *
 * The URL is `http` because that is what the service speaks, and percent-encoded so
 * the query survives a value that later carries a path. It costs readability in the
 * terminal and buys correctness.
 *
 * No token is ever added here, however convenient it would be once the console needs
 * one. A URL gets pasted into a browser, which puts it in history, and the `Referer`
 * on the first request hands it to the console origin's access logs.
 */
export function consoleLink(params: ConsoleLinkParams): string | undefined {
  const consoleUrl = params.consoleUrl.trim().replace(/\/+$/, '');
  if (consoleUrl.length === 0 || !LOOPBACK_REACHABLE_HOSTS.has(params.host)) {
    return undefined;
  }
  return `${consoleUrl}/?backend=${encodeURIComponent(`http://127.0.0.1:${params.port}`)}`;
}
