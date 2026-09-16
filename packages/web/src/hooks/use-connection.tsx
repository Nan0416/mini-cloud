import type { MiniCloudClient } from '@mini-cloud/client';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createApi, probeConnection } from '@/lib/api';
import { config } from '@/lib/config';
import { clearStoredConnection, gateFor, parseBackendParam, readStoredConnection, resolveConnection, storeConnection, type Connection, type ProbeOutcome } from '@/lib/connection';

type ConnectionState =
  | { readonly status: 'probing'; readonly candidate: Connection }
  /** `candidate` seeds the form; `outcome` says why, when there is a why. */
  | { readonly status: 'setup'; readonly candidate?: Connection; readonly outcome?: ProbeOutcome }
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
 * A candidate resolves synchronously on mount, but having one is not the same as having
 * a working connection: it is checked first, and anything short of success goes to the
 * setup screen with the address filled in.
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
    // A probe landing after the visitor moved on must not overwrite what they did.
    // Also what makes StrictMode's double mount harmless.
    let live = true;
    void probeConnection(candidate).then((outcome) => {
      if (!live) {
        return;
      }
      // Only an authenticated answer opens the console. Unreachable could be a sleeping
      // server or the wrong address, and the setup screen fixes both.
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
      // No second probe: the form only calls this once its own check came back `ok`.
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
