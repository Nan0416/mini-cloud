import { corsMiddleware } from '../../src/middleware/cors';
import { fakeRequest, fakeResponse, recordingNext } from './test-helpers';

const CONSOLE = 'http://localhost:5173';
const OTHER = 'https://evil.example.com';

describe('corsMiddleware', () => {
  it('echoes an allowed origin back rather than answering with a star', () => {
    const res = fakeResponse();

    corsMiddleware({ origins: [CONSOLE] })(fakeRequest({ headers: { origin: CONSOLE } }), res.asResponse(), recordingNext());

    // `*` is incompatible with credentialed requests, so answering with it would
    // silently stop working the day the console needs a cookie.
    expect(res.headers['Access-Control-Allow-Origin']).toBe(CONSOLE);
    expect(res.headers['Access-Control-Allow-Credentials']).toBe('true');
  });

  it('varies on Origin, so a shared cache cannot cross-serve the response', () => {
    const res = fakeResponse();

    corsMiddleware({ origins: [CONSOLE] })(fakeRequest({ headers: { origin: CONSOLE } }), res.asResponse(), recordingNext());

    expect(res.headers['Vary']).toBe('Origin');
  });

  it('matches origins exactly, not by prefix or suffix', () => {
    const middleware = corsMiddleware({ origins: [CONSOLE] });

    for (const origin of ['http://localhost:5174', 'http://localhost:5173.evil.com', 'https://localhost:5173', 'http://localhost:5173/']) {
      const res = fakeResponse();
      middleware(fakeRequest({ headers: { origin } }), res.asResponse(), recordingNext());
      expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
    }
  });

  it('allows any origin when configured with a star', () => {
    const res = fakeResponse();

    corsMiddleware({ origins: ['*'] })(fakeRequest({ headers: { origin: OTHER } }), res.asResponse(), recordingNext());

    // Still echoed rather than literally `*`, so the credentialed case keeps working.
    expect(res.headers['Access-Control-Allow-Origin']).toBe(OTHER);
  });

  it('honours a star that appears alongside named origins', () => {
    const res = fakeResponse();

    corsMiddleware({ origins: [CONSOLE, '*'] })(fakeRequest({ headers: { origin: OTHER } }), res.asResponse(), recordingNext());

    expect(res.headers['Access-Control-Allow-Origin']).toBe(OTHER);
  });

  it('blocks every browser origin when the allow-list is empty', () => {
    const res = fakeResponse();
    const next = recordingNext();

    corsMiddleware({ origins: [] })(fakeRequest({ headers: { origin: CONSOLE } }), res.asResponse(), next);

    // The documented way to shut the console out entirely and leave only non-browser
    // callers. The request still proceeds — the browser is what refuses to read it.
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(next.called).toBe(true);
  });

  it('leaves a request with no Origin header alone', () => {
    const res = fakeResponse();
    const next = recordingNext();

    // curl, the CLI and the agents all send no Origin; CORS has nothing to say about
    // them, and setting the header would be meaningless rather than harmful.
    corsMiddleware({ origins: [CONSOLE] })(fakeRequest(), res.asResponse(), next);

    expect(res.headers).toEqual({});
    expect(next.called).toBe(true);
  });

  it('passes an allowed non-preflight request on to the routes', () => {
    const res = fakeResponse();
    const next = recordingNext();

    corsMiddleware({ origins: [CONSOLE] })(fakeRequest({ headers: { origin: CONSOLE } }), res.asResponse(), next);

    expect(next.called).toBe(true);
    expect(res.ended).toBe(false);
  });

  describe('preflight', () => {
    const preflight = (origins: ReadonlyArray<string>, origin?: string) => {
      const res = fakeResponse();
      const next = recordingNext();
      corsMiddleware({ origins })(fakeRequest({ method: 'OPTIONS', headers: origin === undefined ? {} : { origin } }), res.asResponse(), next);
      return { res, next };
    };

    it('answers 204 itself instead of passing the request on', () => {
      const { res, next } = preflight([CONSOLE], CONSOLE);

      // No route serves OPTIONS, so continuing would reach the 404 handler and fail
      // the preflight — which the browser reports as a CORS error, not a 404.
      expect(res.statusCode).toBe(204);
      expect(res.ended).toBe(true);
      expect(next.called).toBe(false);
    });

    it('advertises the methods and headers the API actually serves', () => {
      const { res } = preflight([CONSOLE], CONSOLE);

      expect(res.headers['Access-Control-Allow-Methods']).toBe('GET, POST, PUT, DELETE, OPTIONS');
      // Authorization has to be listed or the shared-token setup fails at the
      // preflight, before the real request carrying the token is ever sent.
      expect(res.headers['Access-Control-Allow-Headers']).toBe('Authorization, Content-Type');
    });

    it('caches the policy for a day, since it only changes on restart', () => {
      const { res } = preflight([CONSOLE], CONSOLE);

      expect(res.headers['Access-Control-Max-Age']).toBe('86400');
    });

    it('still answers 204 for a disallowed origin, just without the allow header', () => {
      const { res } = preflight([CONSOLE], OTHER);

      // The browser enforces the policy; the server's job is only to state it.
      expect(res.statusCode).toBe(204);
      expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
      expect(res.headers['Access-Control-Allow-Methods']).toBe('GET, POST, PUT, DELETE, OPTIONS');
    });
  });
});
