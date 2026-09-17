import { PortInUseError } from '@mini-cloud/shared';
import http from 'node:http';
import net from 'node:net';
import { loadConfig, type ServiceConfig } from '../src/config';
import { identifyOccupant } from '../src/listeners';
import { MiniCloudServer } from '../src/server';

/**
 * Startup up to the database, which is as far as a test without PostgreSQL can follow
 * it. That is where the ordering that matters lives: the ports are claimed before
 * anything touches the database.
 */

const sockets: Array<net.Socket> = [];
const servers: Array<net.Server> = [];

async function listen(server: net.Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected a TCP port.');
  }
  return address.port;
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  const port = await listen(server);
  servers.splice(servers.indexOf(server), 1);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** Accepts a connection and never answers, so a database client waits on it. */
function blackHole(): net.Server {
  return net.createServer((socket) => {
    sockets.push(socket);
  });
}

function configWith(overrides: { internalPort: number; publicPort: number; databaseUrl: string }): ServiceConfig {
  const defaults = loadConfig({ configPath: '/nonexistent/config.json', secretPath: '/nonexistent/secret.json' });
  return {
    ...defaults,
    databaseUrl: overrides.databaseUrl,
    internal: { ...defaults.internal, port: overrides.internalPort },
    public: { ...defaults.public, port: overrides.publicPort },
  };
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.destroy();
  }
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('MiniCloudServer.start', () => {
  it('refuses a taken port before the database is touched', async () => {
    // Nothing answers at this database URL. Reaching it first would fail with a
    // connection error rather than the port.
    const taken = await listen(http.createServer((_req, res) => res.writeHead(200).end(JSON.stringify({ status: 'ok' }))));
    const publicPort = await freePort();

    const start = MiniCloudServer.start(configWith({ internalPort: taken, publicPort, databaseUrl: 'postgres://127.0.0.1:1/unreachable' }));

    await expect(start).rejects.toBeInstanceOf(PortInUseError);
    await expect(start).rejects.toMatchObject({ occupant: 'mini-cloud' });
  });

  it('holds its ports while it migrates, and answers so a second copy knows what it found', async () => {
    const database = await listen(blackHole());
    const internalPort = await freePort();
    const publicPort = await freePort();

    const start = MiniCloudServer.start(configWith({ internalPort, publicPort, databaseUrl: `postgres://127.0.0.1:${database}/stalled` }));
    await waitFor(() => sockets.length > 0);

    expect((await fetch(`http://127.0.0.1:${publicPort}/ping`)).status).toBe(503);
    expect(await identifyOccupant('127.0.0.1', internalPort)).toBe('mini-cloud');

    // A migration that fails hands both ports back.
    for (const socket of sockets.splice(0)) {
      socket.destroy();
    }
    await expect(start).rejects.toThrow();
    await expect(Promise.all([listenOn(internalPort), listenOn(publicPort)])).resolves.toBeDefined();
  });
});

async function listenOn(port: number): Promise<void> {
  const server = net.createServer();
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for the condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
