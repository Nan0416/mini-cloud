import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';

/**
 * Minimal express doubles.
 *
 * Middleware is judged on three things a fake can answer completely: which headers it
 * set, whether it ended the response or called `next`, and what it passed to `next`.
 * Standing up a real server to ask those turns a millisecond assertion into a socket,
 * and makes the failure message a status code rather than a named expectation.
 */

export interface FakeRequestInit {
  readonly method?: string;
  readonly path?: string;
  readonly originalUrl?: string;
  readonly headers?: Record<string, string | string[] | undefined>;
}

export function fakeRequest(init: FakeRequestInit = {}): Request {
  return {
    method: init.method ?? 'GET',
    path: init.path ?? '/tasks',
    originalUrl: init.originalUrl ?? init.path ?? '/tasks',
    headers: init.headers ?? {},
  } as unknown as Request;
}

/** Records what a handler did to the response, and can emit `finish` on demand. */
export class FakeResponse extends EventEmitter {
  statusCode = 200;
  readonly headers: Record<string, string> = {};
  body: unknown;
  ended = false;

  setHeader(name: string, value: string): this {
    this.headers[name] = value;
    return this;
  }

  getHeader(name: string): string | undefined {
    return this.headers[name];
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(body: unknown): this {
    this.body = body;
    this.ended = true;
    return this;
  }

  end(): this {
    this.ended = true;
    return this;
  }

  /** What express does once the response is written; `requestLogger` hangs off it. */
  finish(statusCode?: number): void {
    if (statusCode !== undefined) {
      this.statusCode = statusCode;
    }
    this.emit('finish');
  }

  asResponse(): Response {
    return this as unknown as Response;
  }
}

export function fakeResponse(): FakeResponse {
  return new FakeResponse();
}

/** A `next` that records whether it was called, and with what. */
export interface RecordingNext {
  (err?: unknown): void;
  /** True once called, whether or not an error was passed. */
  called: boolean;
  /** The error handed to it, if any. */
  error?: unknown;
}

export function recordingNext(): RecordingNext {
  const next = ((err?: unknown) => {
    next.called = true;
    if (err !== undefined) {
      next.error = err;
    }
  }) as RecordingNext;
  next.called = false;
  return next as RecordingNext & NextFunction;
}
