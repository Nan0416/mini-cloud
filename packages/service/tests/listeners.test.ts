import { PortInUseError } from '@mini-cloud/shared';
import http from 'node:http';
import net from 'node:net';
import { bindListener, bindListeners, identifyOccupant } from '../src/listeners';

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

function answering(status: number, body: string): http.Server {
  return http.createServer((_req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body);
  });
}

/** Answers `/ping` the way the control plane does. */
const miniCloud = (): http.Server => answering(200, JSON.stringify({ status: 'ok' }));

/** Accepts the connection, then hangs up without an HTTP answer. */
const hangsUp = (): net.Server => net.createServer((socket) => socket.destroy());

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

describe('identifyOccupant', () => {
  it('recognises a control plane by its pong', async () => {
    expect(await identifyOccupant('127.0.0.1', await occupy(miniCloud()))).toBe('mini-cloud');
  });

  it('recognises one that refuses the probe, as the internal listener does outside its trusted subnets', async () => {
    const port = await occupy(answering(403, JSON.stringify({ error: 'Outside the trusted subnets.', errorCode: 'FORBIDDEN' })));

    expect(await identifyOccupant('127.0.0.1', port)).toBe('mini-cloud');
  });

  it('calls it something else only when something else answers', async () => {
    const port = await occupy(answering(404, '<html>Not Found</html>'));

    expect(await identifyOccupant('127.0.0.1', port)).toBe('other');
  });

  it('claims nothing when there is no HTTP answer to go on', async () => {
    expect(await identifyOccupant('127.0.0.1', await occupy(hangsUp()))).toBe('unknown');
  });

  it('claims nothing for an address it cannot put in a URL', async () => {
    expect(await identifyOccupant('fe80::1%en0', 3000, 100)).toBe('unknown');
  });

  it('reaches a wildcard bind through loopback', async () => {
    expect(await identifyOccupant('0.0.0.0', await occupy(miniCloud()))).toBe('mini-cloud');
  });
});

describe('bindListener', () => {
  const bind = (port: number): Promise<void> => {
    const server = http.createServer();
    servers.push(server);
    return bindListener({ server, listener: { name: 'public', config: { host: '127.0.0.1', port } } });
  };

  it('names a control plane already on the address, so the operator knows it is a second copy', async () => {
    const port = await occupy(miniCloud());

    const attempt = bind(port);

    await expect(attempt).rejects.toMatchObject({ occupant: 'mini-cloud' });
    await expect(attempt).rejects.toThrow(`A mini-cloud control plane is already listening on 127.0.0.1:${port}, the public listener's address.`);
  });

  it('points at the setting when another program holds the port', async () => {
    const port = await occupy(answering(404, 'nope'));

    const attempt = bind(port);

    await expect(attempt).rejects.toMatchObject({ occupant: 'other' });
    await expect(attempt).rejects.toThrow('set a different public.port');
  });

  it('says only that the port is taken when it cannot tell by whom', async () => {
    const port = await occupy(hangsUp());

    const attempt = bind(port);

    await expect(attempt).rejects.toBeInstanceOf(PortInUseError);
    await expect(attempt).rejects.toThrow(`127.0.0.1:${port}, the public listener's address, is already in use.`);
  });
});

describe('bindListeners', () => {
  it('releases the ports it did get when one is taken', async () => {
    const free = await freePort();
    const taken = await occupy(hangsUp());
    const internal = http.createServer();

    const attempt = bindListeners([
      { server: internal, listener: { name: 'internal', config: { host: '127.0.0.1', port: free } } },
      { server: http.createServer(), listener: { name: 'public', config: { host: '127.0.0.1', port: taken } } },
    ]);

    await expect(attempt).rejects.toBeInstanceOf(PortInUseError);
    expect(internal.listening).toBe(false);
  });
});
