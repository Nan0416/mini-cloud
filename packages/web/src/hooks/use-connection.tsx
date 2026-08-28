import type { MiniCloudClient } from '@mini-cloud/client';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { createApi } from '@/lib/api';
import { config } from '@/lib/config';
import { clearStoredConnection, parseBackendParam, readStoredConnection, resolveConnection, storeConnection, type Connection } from '@/lib/connection';

interface ConnectionContextValue {
  /** Undefined until the visitor has chosen a service. The app is gated on this. */
  readonly connection?: Connection;
  readonly connect: (connection: Connection, remember: boolean) => void;
  readonly disconnect: () => void;
}

const ConnectionContext = createContext<ConnectionContextValue | undefined>(undefined);
const ApiContext = createContext<MiniCloudClient | undefined>(undefined);

/**
 * Owns which service the console is talking to, and the client built from it.
 *
 * Resolved once, on mount, rather than in an effect: an effect would render the
 * setup screen for a frame before replacing it, and this value is available
 * synchronously.
 */
export function ConnectionProvider(props: { readonly children: ReactNode }) {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<Connection | undefined>(() =>
    resolveConnection({
      fromQuery: parseBackendParam(window.location.search),
      fromStorage: readStoredConnection(),
      fromBuild: config.defaultApiUrl === undefined ? undefined : { apiUrl: config.defaultApiUrl, token: config.defaultToken },
    }),
  );

  const connect = useCallback(
    (next: Connection, remember: boolean): void => {
      storeConnection(next, remember);
      // Before the state change, not after: every cached row belongs to the service
      // being left, and react-query would otherwise serve one machine's tasks under
      // another machine's name until each query refetched.
      queryClient.clear();
      setConnection(next);
    },
    [queryClient],
  );

  const disconnect = useCallback((): void => {
    clearStoredConnection();
    queryClient.clear();
    setConnection(undefined);
  }, [queryClient]);

  const value = useMemo<ConnectionContextValue>(() => ({ connection, connect, disconnect }), [connection, connect, disconnect]);
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
