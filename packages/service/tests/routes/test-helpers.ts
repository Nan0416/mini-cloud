import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { errorHandler } from '../../src/middleware/error-handler';
import type { Endpoints } from '../../src/routes/endpoints';

/**
 * Runs the routes on a real express app over a loopback port.
 *
 * A route is thin by design — parse, delegate, choose a status code — but the two
 * things it is responsible for cannot be observed without express actually running
 * it: which path and query parameters reach the handler, and what happens to a
 * rejected promise. Express 5 forwards a rejection to the error handler, which is why
 * none of the handlers carry a try/catch; against a hand-rolled `req`/`res` that
 * behaviour is express's, not the route's, and a test would be asserting on the fake.
 *
 * No database and no sockets, so it stays a unit test in everything but the transport.
 */
export interface TestResponse<T = unknown> {
  readonly status: number;
  readonly body: T;
}

export class TestServer {
  private constructor(
    private readonly server: Server,
    private readonly origin: string,
  ) {}

  static async start(...endpoints: ReadonlyArray<Endpoints>): Promise<TestServer> {
    const app = express();
    app.use(express.json());
    for (const group of endpoints) {
      group.bind(app);
    }
    // Registered last, as in the real service: express identifies the error handler
    // by its four-argument signature and only reaches it after every route.
    app.use(errorHandler);

    const server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const { port } = server.address() as AddressInfo;
    return new TestServer(server, `http://127.0.0.1:${port}`);
  }

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<TestResponse<T>> {
    const response = await fetch(`${this.origin}${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: (text.length === 0 ? undefined : JSON.parse(text)) as T };
  }

  get<T = unknown>(path: string): Promise<TestResponse<T>> {
    return this.request<T>('GET', path);
  }

  post<T = unknown>(path: string, body?: unknown): Promise<TestResponse<T>> {
    return this.request<T>('POST', path, body ?? {});
  }

  put<T = unknown>(path: string, body?: unknown): Promise<TestResponse<T>> {
    return this.request<T>('PUT', path, body ?? {});
  }

  delete<T = unknown>(path: string): Promise<TestResponse<T>> {
    return this.request<T>('DELETE', path);
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((err) => (err === undefined ? resolve() : reject(err)));
    });
  }
}
