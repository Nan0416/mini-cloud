import { LoggerFactory, PortInUseError, isAddressInUse } from '@mini-cloud/shared';
import http from 'node:http';
import net from 'node:net';
import { ListenerConfig } from './config';

const logger = LoggerFactory.getLogger('Listeners');

/** A listener as the config file names it, so a message can point at the setting. */
export interface NamedListener {
  readonly name: 'internal' | 'public';
  readonly config: ListenerConfig;
}

const PROBE_TIMEOUT_MS = 500;

/** A wildcard bind answers on loopback, and connecting to `0.0.0.0` is not portable. */
function probeHost(host: string): string {
  if (host === '0.0.0.0' || host === '') {
    return '127.0.0.1';
  }
  return host === '::' ? '::1' : host;
}

function accepts(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ host, port });
    const settle = (accepted: boolean): void => {
      socket.destroy();
      resolve(accepted);
    };
    socket.setTimeout(timeoutMs, () => settle(false));
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
  });
}

async function answersAsMiniCloud(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const hostname = net.isIPv6(host) ? `[${host}]` : host;
  try {
    const response = await fetch(`http://${hostname}:${port}/ping`, { signal: AbortSignal.timeout(timeoutMs) });
    const body: unknown = await response.json();
    return response.ok && typeof body === 'object' && body !== null && 'status' in body && body.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * Refuses to start when something already answers on a listener's address.
 *
 * Runs before the database is touched, so a second control plane never applies
 * migrations under a running one. Anything short of an accepted connection counts as
 * free: the bind has the final word, and a probe must never be what stops a start.
 */
export async function assertListenersFree(listeners: ReadonlyArray<NamedListener>, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<void> {
  for (const { name, config } of listeners) {
    if (config.port === 0) {
      continue;
    }
    const host = probeHost(config.host);
    if (!(await accepts(host, config.port, timeoutMs))) {
      continue;
    }
    const address = `${config.host}:${config.port}`;
    if (await answersAsMiniCloud(host, config.port, timeoutMs)) {
      throw new PortInUseError(
        `A mini-cloud control plane is already listening on ${address}, the ${name} listener's address. Only one can run on these ports; stop that one first.`,
      );
    }
    throw new PortInUseError(`Something other than mini-cloud is already listening on ${address}, the ${name} listener's address. Stop it, or set a different ${name}.port.`);
  }
}

/**
 * Binds one listener and reports the port it actually got, which `0` makes useful.
 *
 * `EADDRINUSE` still arrives here when two processes start at once and both pass
 * {@link assertListenersFree}, so it gets the same treatment.
 */
export async function bindListener(server: http.Server, { name, config }: NamedListener): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      logger.debug(`The ${name} listener could not bind ${config.host}:${config.port}.`, err);
      reject(
        isAddressInUse(err)
          ? new PortInUseError(`${config.host}:${config.port}, the ${name} listener's address, is already in use. Stop whatever holds it, or set a different ${name}.port.`)
          : err,
      );
    };
    server.once('error', onError);
    server.listen(config.port, config.host, () => {
      server.removeListener('error', onError);
      resolve();
    });
  });
  const address = server.address();
  return address !== null && typeof address !== 'string' ? address.port : config.port;
}
