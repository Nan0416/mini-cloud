import { GetHealthResponse, PingResponse } from '@mini-cloud/shared';
import { HealthEndpoints } from '../../src/routes/health-endpoints';
import { fakePool } from '../data/test-helpers';
import { TestServer } from './test-helpers';

/**
 * Two endpoints with deliberately different jobs: `/ping` says the process is up, and
 * `/health` says it is up *and* able to serve. Collapsing them would mean a service
 * that cannot reach its database still passing whatever probe restarts it.
 */
describe('GET /ping', () => {
  it('answers ok without touching anything else', async () => {
    const pool = fakePool();
    const server = await TestServer.start(new HealthEndpoints({ pool: pool.asPool() }));

    const response = await server.get<PingResponse>('/ping');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    // Liveness must not depend on the database, or a database outage would have an
    // orchestrator restart a perfectly healthy process.
    expect(pool.queries).toEqual([]);
    await server.close();
  });

  it('answers even while the database is unreachable', async () => {
    const pool = fakePool().failOn('SELECT 1', new Error('connection refused'));
    const server = await TestServer.start(new HealthEndpoints({ pool: pool.asPool() }));

    expect((await server.get('/ping')).status).toBe(200);
    await server.close();
  });
});

describe('GET /health', () => {
  it('reports ok when the database answers', async () => {
    const pool = fakePool();
    const server = await TestServer.start(new HealthEndpoints({ pool: pool.asPool() }));

    const response = await server.get<GetHealthResponse>('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', database: 'ok' });
    expect(pool.sql(0)).toBe('SELECT 1');
    await server.close();
  });

  it('reports degraded with a 503 when the database does not', async () => {
    const pool = fakePool().failOn('SELECT 1', new Error('connection refused'));
    const server = await TestServer.start(new HealthEndpoints({ pool: pool.asPool() }));

    const response = await server.get<GetHealthResponse>('/health');

    // 503 rather than 500: a load balancer takes the instance out of rotation and
    // puts it back when the database returns, without anyone restarting anything.
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'degraded', database: 'unreachable' });
    await server.close();
  });

  it('answers rather than letting the failure reach the error handler', async () => {
    const pool = fakePool().failOn('SELECT 1', new Error('connection refused'));
    const server = await TestServer.start(new HealthEndpoints({ pool: pool.asPool() }));

    const response = await server.get<GetHealthResponse>('/health');

    // A readiness probe has to describe the problem; a generic 500 body would tell
    // whoever is reading it nothing about which dependency is down.
    expect(response.body).toHaveProperty('database', 'unreachable');
    expect(response.body).not.toHaveProperty('errorCode');
    await server.close();
  });
});
