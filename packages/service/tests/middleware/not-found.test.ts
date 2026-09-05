import { NotFoundError } from '@mini-cloud/shared';
import { notFoundHandler } from '../../src/middleware/not-found';
import { fakeRequest, fakeResponse, recordingNext } from './test-helpers';

const handler = notFoundHandler({
  plane: 'internal',
  otherPlane: 'public',
  otherPlanePort: 3001,
  otherPlaneServes: ['/tasks', '/instances'],
});

const run = (init: Parameters<typeof fakeRequest>[0]) => {
  const next = recordingNext();
  handler(fakeRequest(init), fakeResponse().asResponse(), next);
  return next;
};

describe('notFoundHandler', () => {
  it('answers 404 through the error handler, not express’s HTML page', () => {
    // Every client of this API parses JSON. The default page is the one response none
    // of them can read.
    const next = run({ method: 'GET', path: '/tasks' });

    expect(next.error).toBeInstanceOf(NotFoundError);
    expect((next.error as NotFoundError).statusCode).toBe(404);
  });

  it('names the listener that does serve the path, and its port', () => {
    // This is the failure the split introduced: point the CLI at the internal
    // listener and every task command 404s with nothing to say the port is wrong.
    const message = (run({ method: 'GET', path: '/tasks' }).error as Error).message;

    expect(message).toContain('GET /tasks is not served by the internal listener');
    expect(message).toContain('public listener (port 3001)');
    expect(message).toContain('/tasks, /instances');
  });

  it('quotes the method and path that were actually asked for', () => {
    expect((run({ method: 'POST', path: '/nonsense' }).error as Error).message).toContain('POST /nonsense');
  });
});
