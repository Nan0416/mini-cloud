import { LoggerFactory, PortInUseError, PortOccupant, isAddressInUse } from '@mini-cloud/shared';
import http from 'node:http';
import net from 'node:net';
import { ListenerConfig } from './config';

const logger = LoggerFactory.getLogger('Listeners');

/** A listener as the config file names it, so a message can point at the setting. */
export interface NamedListener {
  readonly name: 'internal' | 'public';
  readonly config: ListenerConfig;
}

export interface ListenerBinding {
  readonly server: http.Server;
  readonly listener: NamedListener;
}

const PROBE_TIMEOUT_MS = 500;

/** A wildcard bind answers on loopback, and connecting to `0.0.0.0` is not portable. */
function probeHost(host: string): string {
  if (host === '0.0.0.0' || host === '') {
    return '127.0.0.1';
  }
  return host === '::' ? '::1' : host;
}

/**
 * Asks `/ping` who is there. Any body shaped like mini-cloud's counts, refusals included:
 * the internal listener's subnet filter answers a loopback probe with a 403.
 */
export async function identifyOccupant(host: string, port: number, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<PortOccupant> {
  const target = probeHost(host);
  let body: unknown;
  try {
    const response = await fetch(`http://${net.isIPv6(target) ? `[${target}]` : target}:${port}/ping`, { signal: AbortSignal.timeout(timeoutMs) });
    body = await response.json().catch(() => undefined);
  } catch {
    return 'unknown';
  }
  if (typeof body !== 'object' || body === null) {
    return 'other';
  }
  const pong = 'status' in body && body.status === 'ok';
  const refusal = 'error' in body && typeof body.error === 'string' && 'errorCode' in body && typeof body.errorCode === 'string';
  return pong || refusal ? 'mini-cloud' : 'other';
}

function portInUse({ name, config }: NamedListener, occupant: PortOccupant): PortInUseError {
  const address = `${config.host}:${config.port}`;
  switch (occupant) {
    case 'mini-cloud':
      return new PortInUseError(
        `A mini-cloud control plane is already listening on ${address}, the ${name} listener's address. Only one can run on these ports; stop that one first.`,
        occupant,
      );
    case 'other':
      return new PortInUseError(
        `Something other than mini-cloud is already listening on ${address}, the ${name} listener's address. Stop it, or set a different ${name}.port.`,
        occupant,
      );
    case 'unknown':
      return new PortInUseError(`${address}, the ${name} listener's address, is already in use. Stop whatever holds it, or set a different ${name}.port.`, occupant);
  }
}

export async function bindListener({ server, listener }: ListenerBinding): Promise<void> {
  const { name, config } = listener;
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      logger.debug(`The ${name} listener could not bind ${config.host}:${config.port}.`, err);
      if (!isAddressInUse(err)) {
        reject(err);
        return;
      }
      void identifyOccupant(config.host, config.port).then((occupant) => reject(portInUse(listener, occupant)));
    };
    server.once('error', onError);
    server.listen(config.port, config.host, () => {
      server.removeListener('error', onError);
      resolve();
    });
  });
}

/** Closes a server that may never have bound, without turning that into the failure. */
export async function closeQuietly(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

/**
 * Binds every listener or none. Each bind is waited out even after another fails, so a
 * late success cannot leave a port held behind the rejected start.
 */
export async function bindListeners(bindings: ReadonlyArray<ListenerBinding>): Promise<void> {
  const results = await Promise.allSettled(bindings.map(bindListener));
  const failure = results.find((result) => result.status === 'rejected');
  if (failure !== undefined) {
    await Promise.all(bindings.map(({ server }) => closeQuietly(server)));
    throw failure.reason;
  }
}
