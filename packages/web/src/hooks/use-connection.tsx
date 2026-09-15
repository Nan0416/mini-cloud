import type { MiniCloudClient } from '@mini-cloud/client';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createApi, probeConnection } from '@/lib/api';
import { config } from '@/lib/config';
import { clearStoredConnection, gateFor, parseBackendParam, readStoredConnection, resolveConnection, storeConnection, type Connection, type ProbeOutcome } from '@/lib/connection';

/** Where the console is before it knows it can talk to anything. */
type ConnectionState =
  /** Checking a stored or linked candidate. The splash, and nothing else, renders. */
  | { readonly status: 'probing'; readonly candidate: Connection }
  /** Ask the visitor. `candidate` seeds the form; `outcome` says why, when there is a why. */
  | { readonly status: 'setup'; readonly candidate?: Connection; readonly outcome?: ProbeOutcome }
  /** Verified against the service. The console proper renders. */
  | { readonly status: 'connected'; readonly connection: Connection };

interface ConnectionContextValue {
  readonly state: ConnectionState;
  /** The live connection, or undefined until one has been verified. */
  readonly connection?: Connection;
  readonly connect: (connection: Connection, remember: boolean) => void;
  readonly disconnect: () => void;
}

const ConnectionContext = createContext<ConnectionContextValue | undefined>(undefined);
const ApiContext = createContext<MiniCloudClient | undefined>(undefined);

/**
 * Owns which service the console is talking to, and the client built from it.
 *
 * The candidate resolves synchronously on mount — a link, then this browser's storage,
 * then anything baked into the bundle — but having a candidate is not the same as
 * having a working connection, so the console does not open on one. It is checked
 * first, and anything short of success sends the visitor to the setup screen with the
 * address already filled in.
 *
 * That check costs a splash on every load, which buys the thing it replaces: a console
 * that used to render in full against a token it did not have, leaving every panel to
 * discover the same 401 separately while the offline banner stayed quiet because
 * `/ping` needs no token.
 */
export function ConnectionProvider(props: { readonly children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConnectionState>(() => {
    const candidate = resolveConnection({
      fromQuery: parseBackendParam(window.location.search),
      fromStorage: readStoredConnection(),
      fromBuild: config.defaultApiUrl === undefined ? undefined : { apiUrl: config.defaultApiUrl, token: config.defaultToken },
    });
    const gate = gateFor(candidate);
    return gate.status === 'probe' ? { status: 'probing', candidate: gate.candidate } : { status: 'setup', candidate: gate.candidate };
  });

  useEffect(() => {
    if (state.status !== 'probing') {
      return;
    }
    const candidate = state.candidate;
    // Guarded rather than aborted: a probe that lands after the visitor has already
    // moved on must not overwrite what they did. `probeConnection` resolves either
    // way, so there is nothing to cancel. This is also what makes StrictMode's double
    // mount in development harmless — the first pass is discarded, and both passes are
    // idempotent GETs.
    let live = true;
    void probeConnection(candidate).then((outcome) => {
      if (!live) {
        return;
      }
      // One rule, no exceptions: only a service that answered an authenticated call
      // opens the console. A service that is merely unreachable could be asleep, but
      // it could equally be the wrong address, and the setup screen is where both of
      // those are fixed.
      setState(outcome === 'ok' ? { status: 'connected', connection: candidate } : { status: 'setup', candidate, outcome });
    });
    return () => {
      live = false;
    };
  }, [state]);

  const connect = useCallback(
    (next: Connection, remember: boolean): void => {
      storeConnection(next, remember);
      // Before the state change, not after: every cached row belongs to the service
      // being left, and react-query would otherwise serve one machine's tasks under
      // another machine's name until each query refetched.
      queryClient.clear();
      // Straight to connected, with no second probe: the form only calls this once
      // its own verification has come back `ok`.
      setState({ status: 'connected', connection: next });
    },
    [queryClient],
  );

  const disconnect = useCallback((): void => {
    clearStoredConnection();
    queryClient.clear();
    setState({ status: 'setup' });
  }, [queryClient]);

  const connection = state.status === 'connected' ? state.connection : undefined;
  const value = useMemo<ConnectionContextValue>(() => ({ state, connection, connect, disconnect }), [state, connection, connect, disconnect]);
  // Rebuilt only when the connection changes, so hooks depending on it are not
  // handed a new client — and a new query function — on every render.
  const api = useMemo(() => (connection === undefined ? undefined : createApi(connection)), [connection]);

  return (
    <ConnectionContext.Provider value={value}>
      <ApiContext.Provider value={api}>{props.children}</ApiContext.Provider>
    </ConnectionContext.Provider>
  );
}

export function useConnection(): ConnectionContextValue {
  const value = useContext(ConnectionContext);
  if (value === undefined) {
    throw new Error('useConnection must be used inside a ConnectionProvider.');
  }
  return value;
}

/**
 * The client for the service currently chosen.
 *
 * Throws when there is none, which is a bug rather than a state to handle: every
 * caller lives inside the tree that only renders once a connection exists.
 */
export function useApi(): MiniCloudClient {
  const api = useContext(ApiContext);
  if (api === undefined) {
    throw new Error('useApi was called with no connection. It is only valid inside the connected app.');
  }
  return api;
}
