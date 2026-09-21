import { InvalidRequestError, parseMetricGraph, type MetricGraph } from '@mini-cloud/shared';

/** The query parameter the metrics page keeps its graph in. */
export const GRAPH_PARAM = 'graph';

/**
 * A graph in a link, as base64url-encoded JSON.
 *
 * Opaque on purpose. Nobody edits a graph in the address bar, and base64url holds no
 * character that a URL, a chat client or a markdown renderer will rewrite, whereas raw
 * JSON is percent-escaped into something neither shorter nor readable.
 */
export function encodeMetricGraph(graph: MetricGraph): string {
  // Through UTF-8 bytes, because `btoa` only takes Latin-1 and a dimension value can be anything.
  let binary = '';
  for (const byte of new TextEncoder().encode(JSON.stringify(graph))) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Reads a graph back out of a link, refusing anything `parseMetricGraph` would. */
export function decodeMetricGraph(encoded: string): MetricGraph {
  let json: string;
  try {
    const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
    json = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    throw new InvalidRequestError('graph is not base64url-encoded text; copy the whole link again');
  }

  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new InvalidRequestError('graph is not JSON; copy the whole link again');
  }
  return parseMetricGraph(value);
}
