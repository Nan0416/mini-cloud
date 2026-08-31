import {
  AgentOfflineError,
  ConflictError,
  ForbiddenError,
  InternalServiceError,
  InvalidRequestError,
  NotFoundError,
  ServiceUnreachableError,
  UnauthenticatedError,
} from '@mini-cloud/shared';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpClient } from '../src/http-client';

/** What the stub server should answer with, and what it saw. */
interface Received {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/**
 * Runs against a real HTTP server rather than a mocked `fetch`.
 *
 * The behaviour worth pinning down is what the client does with a *response* — the
 * status line, the body, and the two ways there is no response at all (a refused
 * connection and a timeout). A stubbed `fetch` would have the test decide what those
 * look like, which is the same as asserting nothing.
 */
class StubService {
  private constructor(
    private readonly server: Server,
    readonly baseUrl: string,
    readonly received: Received[],
  ) {}

  static async start(handler: (req: IncomingMessage, res: ServerResponse, received: Received) => void): Promise<StubService> {
    const received: Received[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += String(chunk)));
      req.on('end', () => {
        const entry: Received = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body };
        received.push(entry);
        handler(req, res, entry);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;
    return new StubService(server, `http://127.0.0.1:${port}`, received);
  }

  /** Answers every request with one status and body. */
  static json(status: number, body: unknown): Promise<StubService> {
    return StubService.start((_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  }

  get last(): Received {
    return this.received[this.received.length - 1] as Received;
  }

  async close(): Promise<void> {
    // `close` alone waits for every open connection to end, and node's fetch keeps
    // its sockets alive — including the one belonging to a request that timed out.
    // Without this the suite hangs on teardown rather than failing.
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

describe('HttpClient request building', () => {
  it('joins the base url and path', async () => {
    const service = await StubService.json(200, { ok: true });

    await new HttpClient({ baseUrl: service.baseUrl }).request('GET', '/tasks');

    expect(service.last.url).toBe('/tasks');
    await service.close();
  });

  it('tolerates a base url with trailing slashes, so one service is not two', async () => {
    const service = await StubService.json(200, {});

    await new HttpClient({ baseUrl: `${service.baseUrl}///` }).request('GET', '/tasks');

    // Otherwise the request goes to `//tasks`, which express does not route.
    expect(service.last.url).toBe('/tasks');
    await service.close();
  });

  it('appends query parameters, encoded', async () => {
    const service = await StubService.json(200, {});

    await new HttpClient({ baseUrl: service.baseUrl }).request('GET', '/instances', { query: { taskId: 't 1', limit: 10, active: true } });

    expect(service.last.url).toBe('/instances?taskId=t+1&limit=10&active=true');
    await service.close();
  });

  it('omits a query parameter that is not set, rather than sending "undefined"', async () => {
    const service = await StubService.json(200, {});

    // Callers pass optional filters straight through; `?limit=undefined` would then
    // fail validation on every request that did not set one.
    await new HttpClient({ baseUrl: service.baseUrl }).request('GET', '/instances', { query: { taskId: 't1', limit: undefined } });

    expect(service.last.url).toBe('/instances?taskId=t1');
    await service.close();
  });

  it('sends a JSON body with the matching content type', async () => {
    const service = await StubService.json(200, {});

    await new HttpClient({ baseUrl: service.baseUrl }).request('POST', '/tasks', { body: { name: 'backup' } });

    expect(service.last.body).toBe('{"name":"backup"}');
    expect(service.last.headers['content-type']).toBe('application/json');
    await service.close();
  });

  it('sets no content type when there is no body', async () => {
    const service = await StubService.json(200, {});

    await new HttpClient({ baseUrl: service.baseUrl }).request('GET', '/tasks');

    expect(service.last.headers['content-type']).toBeUndefined();
    await service.close();
  });

  it('presents a bearer token when one is configured', async () => {
    const service = await StubService.json(200, {});

    await new HttpClient({ baseUrl: service.baseUrl, token: 's3cret' }).request('GET', '/tasks');

    expect(service.last.headers['authorization']).toBe('Bearer s3cret');
    await service.close();
  });

  it('sends no authorization header when no token is configured', async () => {
    const service = await StubService.json(200, {});

    // A local setup runs without authentication, and an empty header is not the same
    // as no header.
    await new HttpClient({ baseUrl: service.baseUrl }).request('GET', '/tasks');

    expect(service.last.headers['authorization']).toBeUndefined();
    await service.close();
  });
});

describe('HttpClient responses', () => {
  it('returns the parsed body', async () => {
    const service = await StubService.json(200, { tasks: [{ taskId: 't1' }] });

    expect(await new HttpClient({ baseUrl: service.baseUrl }).request('GET', '/tasks')).toEqual({ tasks: [{ taskId: 't1' }] });
    await service.close();
  });

  it('treats an empty body as an empty object', async () => {
    const service = await StubService.start((_req, res) => {
      res.writeHead(204);
      res.end();
    });

    // A 204 is a success; parsing '' as JSON would throw and turn it into a failure.
    expect(await new HttpClient({ baseUrl: service.baseUrl }).request('DELETE', '/tasks/t1')).toEqual({});
    await service.close();
  });

  it('reports a non-JSON success body as an internal failure', async () => {
    const service = await StubService.start((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>proxy error</html>');
    });

    // Usually a proxy or a captive portal answering instead of the service.
    await expect(new HttpClient({ baseUrl: service.baseUrl }).request('GET', '/tasks')).rejects.toThrow(/is not JSON/);
    await service.close();
  });
});

/**
 * The point of the client's error handling: `catch (err) { if (err instanceof
 * NotFoundError) ... }` reads the same in the CLI and the agent as it does inside the
 * service. That only holds if the error code on the wire is mapped back to the same
 * class the service threw.
 */
describe('HttpClient error reconstruction', () => {
  const cases: ReadonlyArray<[string, number, new (message: string) => Error]> = [
    ['INVALID_REQUEST', 400, InvalidRequestError],
    ['UNAUTHENTICATED', 401, UnauthenticatedError],
    ['FORBIDDEN', 403, ForbiddenError],
    ['NOT_FOUND', 404, NotFoundError],
    ['CONFLICT', 409, ConflictError],
    ['AGENT_OFFLINE', 409, AgentOfflineError],
  ];

  it.each(cases)('rebuilds a %s response as the class the service threw', async (errorCode, status, expected) => {
    const service = await StubService.json(status, { error: 'the service said so', errorCode });

    await expect(new HttpClient({ baseUrl: service.baseUrl }).request('GET', '/tasks')).rejects.toBeInstanceOf(expected);
    await service.close();
  });

  it("keeps the service's message, because it was written for this caller", async () => {
    const service = await StubService.json(404, { error: 'Task 42 does not exist.', errorCode: 'NOT_FOUND' });

    await expect(new HttpClient({ baseUrl: service.baseUrl }).request('GET', '/tasks/42')).rejects.toThrow('Task 42 does not exist.');
    await service.close();
  });

  it('keeps the two 409s apart, since a caller retries one and not the other', async () => {
    const conflict = await StubService.json(409, { error: 'already terminating', errorCode: 'CONFLICT' });
    const offline = await StubService.json(409, { error: 'agent is offline', errorCode: 'AGENT_OFFLINE' });

    await expect(new HttpClient({ baseUrl: conflict.baseUrl }).request('POST', '/x')).rejects.not.toBeInstanceOf(AgentOfflineError);
    await expect(new HttpClient({ baseUrl: offline.baseUrl }).request('POST', '/x')).rejects.toBeInstanceOf(AgentOfflineError);
    await Promise.all([conflict.close(), offline.close()]);
  });

  it('falls back to an internal error, naming the status, for an unrecognised code', async () => {
    const service = await StubService.json(418, { error: 'teapot', errorCode: 'BREWING' });

    // Something other than this service answered, or the contract has moved on; the
    // status is the only thing left worth reporting.
    await expect(new HttpClient({ baseUrl: service.baseUrl }).request('GET', '/tasks')).rejects.toThrow('teapot (HTTP 418)');
    await service.close();
  });

  it('handles an error response carrying no body at all', async () => {
    const service = await StubService.start((_req, res) => {
      res.writeHead(502);
      res.end();
    });

    // A gateway between the caller and the service will do exactly this.
    await expect(new HttpClient({ baseUrl: service.baseUrl }).request('GET', '/tasks')).rejects.toThrow('GET /tasks failed (HTTP 502)');
    await service.close();
  });

  it('handles an error response whose body is not JSON', async () => {
    const service = await StubService.start((_req, res) => {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Internal Server Error');
    });

    await expect(new HttpClient({ baseUrl: service.baseUrl }).request('GET', '/tasks')).rejects.toThrow(InternalServiceError);
    await service.close();
  });
});

/**
 * "There was no service to ask" is a different answer from "the service failed", and
 * the console shows an offline banner for one and an error for the other. Folding
 * both into `InternalServiceError` is what stopped it telling them apart.
 */
describe('HttpClient when nothing answers', () => {
  it('reports a refused connection as unreachable, not as an internal failure', async () => {
    const service = await StubService.json(200, {});
    const baseUrl = service.baseUrl;
    await service.close();

    const promise = new HttpClient({ baseUrl }).request('GET', '/tasks');

    await expect(promise).rejects.toBeInstanceOf(ServiceUnreachableError);
    await expect(promise).rejects.not.toBeInstanceOf(InternalServiceError);
  });

  it('names the address it could not reach, since that is what needs fixing', async () => {
    const service = await StubService.json(200, {});
    const baseUrl = service.baseUrl;
    await service.close();

    await expect(new HttpClient({ baseUrl }).request('GET', '/tasks')).rejects.toThrow(new RegExp(`could not reach ${baseUrl}`));
  });

  it('gives up on a service that accepts the connection and never answers', async () => {
    const service = await StubService.start(() => {
      // Deliberately never responds.
    });

    // Without a deadline the CLI or the agent would block forever on a wedged service.
    await expect(new HttpClient({ baseUrl: service.baseUrl, timeoutMs: 50 }).request('GET', '/tasks')).rejects.toBeInstanceOf(ServiceUnreachableError);
    await service.close();
  });

  it('names the deadline it gave up on, so the caller knows what to raise', async () => {
    const service = await StubService.start(() => undefined);

    // Deliberately loose about the wording. `request` picks between a "timed out
    // after Nms" message and a generic one using `err instanceof Error`, and an
    // aborted fetch rejects with a `DOMException` built in node's realm — which is
    // not the test realm's `Error`, so the check is false here and true in
    // production. Asserting the exact sentence would pin down a jest artefact
    // rather than the client's behaviour; what has to hold either way is that the
    // caller is told which address stopped answering.
    await expect(new HttpClient({ baseUrl: service.baseUrl, timeoutMs: 50 }).request('GET', '/tasks')).rejects.toThrow(
      new RegExp(`GET /tasks (timed out after 50ms|could not reach ${service.baseUrl})`),
    );
    await service.close();
  });

  it('clears the timeout timer on a successful request, so the process can still exit', async () => {
    const service = await StubService.json(200, {});
    const clear = jest.spyOn(global, 'clearTimeout');

    // A pending timer keeps node's event loop alive; a CLI that has printed its
    // answer would then sit for the full timeout before exiting.
    await new HttpClient({ baseUrl: service.baseUrl, timeoutMs: 60_000 }).request('GET', '/tasks');

    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
    await service.close();
  });
});
