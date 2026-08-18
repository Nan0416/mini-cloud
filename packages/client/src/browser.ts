/**
 * Browser-safe entry point.
 *
 * Identical to `index.ts` minus `WsSubscriber`, which imports `ws` — a Node module
 * that does not resolve in a browser bundle. Splitting the entry point rather than
 * the package keeps one typed client: the console gets exactly the same
 * `MiniCloudClient` the CLI and the agent use, so an endpoint only ever has to be
 * written once.
 *
 * A browser that wants to subscribe should use the platform `WebSocket` against
 * `/ws` directly; `WsSubscriber` exists for the reconnect and replay logic that Node
 * callers need, and the browser's own API already covers the rest.
 */
export * from './http-client';
export * from './mini-cloud-client';
