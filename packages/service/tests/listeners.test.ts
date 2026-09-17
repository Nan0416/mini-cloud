import { PortInUseError } from '@mini-cloud/shared';
import http from 'node:http';
import net from 'node:net';
import { assertListenersFree, bindListener } from '../src/listeners';

const servers: Array<net.Server> = [];

async function occupy(server: net.Server, host = '127.0.0.1'): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected a TCP port.');
  }
  return address.port;
}

/** Answers `/ping` the way the control plane does. */
function miniCloudLookalike(): http.Server {
  return http.createServer((req, res) => {
    res.writeHead(req.url === '/ping' ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url === '/ping' ? { status: 'ok' } : { error: 'Not found' }));
  });
}

/** A port nothing is listening on — held, then released. */
async function freePort(): Promise<number> {
  const server = net.createServer();
  const port = await occupy(server);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  servers.splice(servers.indexOf(server), 1);
  return port;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('assertListenersFree', () => {
  it('lets a start through when nothing answers', async () => {
    const port = await freePort();

    await expect(assertListenersFree([{ name: 'internal', config: { host: '127.0.0.1', port } }])).resolves.toBeUndefined();
  });

  it('names a control plane already on the address, so the operator knows it is a second copy', async () => {
    const port = await occupy(miniCloudLookalike());

    const check = assertListenersFree([{ name: 'internal', config: { host: '127.0.0.1', port } }]);

    await expect(check).rejects.toBeInstanceOf(PortInUseError);
    await expect(check).rejects.toThrow(`A mini-cloud control plane is already listening on 127.0.0.1:${port}`);
  });

  it('points at the setting when the occupant is some other program', async () => {
    // Accepts the connection, then hangs up rather than answering /ping.
    const port = await occupy(net.createServer((socket) => socket.destroy()));

    const check = assertListenersFree([{ name: 'public', config: { host: '127.0.0.1', port } }], 200);

    await expect(check).rejects.toThrow(`Something other than mini-cloud is already listening on 127.0.0.1:${port}`);
    await expect(check).rejects.toThrow('set a different public.port');
  });

  it('checks every listener, not only the first', async () => {
    const free = await freePort();
    const taken = await occupy(miniCloudLookalike());

    const check = assertListenersFree([
      { name: 'internal', config: { host: '127.0.0.1', port: free } },
      { name: 'public', config: { host: '127.0.0.1', port: taken } },
    ]);

    await expect(check).rejects.toThrow("the public listener's address");
  });

  it('reaches a wildcard bind through loopback', async () => {
    const port = await occupy(miniCloudLookalike());

    await expect(assertListenersFree([{ name: 'public', config: { host: '0.0.0.0', port } }])).rejects.toBeInstanceOf(PortInUseError);
  });

  it('skips port 0, which asks for any free port and so cannot collide', async () => {
    await expect(assertListenersFree([{ name: 'internal', config: { host: '127.0.0.1', port: 0 } }])).resolves.toBeUndefined();
  });
});

describe('bindListener', () => {
  it('reports the port it actually got, which is what makes 0 useful', async () => {
    const server = http.createServer();
    servers.push(server);

    expect(await bindListener(server, { name: 'internal', config: { host: '127.0.0.1', port: 0 } })).toBeGreaterThan(0);
  });

  it('still refuses with a sentence when two processes race past the check', async () => {
    const port = await occupy(net.createServer());

    const bind = bindListener(http.createServer(), { name: 'public', config: { host: '127.0.0.1', port } });

    await expect(bind).rejects.toBeInstanceOf(PortInUseError);
    await expect(bind).rejects.toThrow(`127.0.0.1:${port}, the public listener's address, is already in use`);
  });
});
