import os from 'node:os';
import { defaultAgentId, resolveAgentConfig } from '../src/agent-config';

describe('defaultAgentId', () => {
  it('lowercases, so one machine keeps one id however it was reached', () => {
    // The same box answers `Nans-MacBook-Pro.local` to a local shell and
    // `nans-macbook-pro` over SSH; both must resolve to the same agent.
    expect(defaultAgentId('Nans-MacBook-Pro.local')).toBe('nans-macbook-pro');
    expect(defaultAgentId('nans-macbook-pro')).toBe('nans-macbook-pro');
  });

  it('strips a trailing .local only, leaving other dotted names whole', () => {
    expect(defaultAgentId('mac-mini.local')).toBe('mac-mini');
    expect(defaultAgentId('build.local.example.com')).toBe('build.local.example.com');
    expect(defaultAgentId('localhost.example.com')).toBe('localhost.example.com');
  });

  it('refuses a hostname every machine answers to', () => {
    expect(defaultAgentId('localhost')).toBeUndefined();
    expect(defaultAgentId('LOCALHOST')).toBeUndefined();
    expect(defaultAgentId('localhost.local')).toBeUndefined();
  });

  it('refuses a hostname that normalizes to nothing', () => {
    expect(defaultAgentId('')).toBeUndefined();
    expect(defaultAgentId('   ')).toBeUndefined();
    expect(defaultAgentId('.local')).toBeUndefined();
  });
});

describe('resolveAgentConfig', () => {
  beforeEach(() => {
    // Pinned, so these assertions do not depend on what the test machine is called.
    jest.spyOn(os, 'hostname').mockReturnValue('Nans-MacBook-Pro.local');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('points at the internal listener, which is the only one that serves an agent', () => {
    expect(resolveAgentConfig().serviceUrl).toBe('http://127.0.0.1:3000');
    expect(resolveAgentConfig({ internalUrl: 'http://192.168.1.50:3000' }).serviceUrl).toBe('http://192.168.1.50:3000');
  });

  it('names the machine after itself when nothing is configured', () => {
    expect(resolveAgentConfig().agentId).toBe('nans-macbook-pro');
  });

  it('treats an empty configured id as absent rather than as an id', () => {
    expect(resolveAgentConfig({ id: '' }).agentId).toBe('nans-macbook-pro');
  });

  it('refuses to start when the hostname cannot identify one machine', () => {
    jest.spyOn(os, 'hostname').mockReturnValue('localhost');

    expect(() => resolveAgentConfig()).toThrow(/cannot identify one agent/);
  });

  it('defaults the name to the resolved id, so agents sharing a host stay distinguishable', () => {
    expect(resolveAgentConfig({ id: 'laptop-1' }).name).toBe('laptop-1');
  });

  it('keeps the name independent of the id', () => {
    const config = resolveAgentConfig({ id: 'laptop-1', name: 'mac mini' });

    expect(config).toMatchObject({ agentId: 'laptop-1', name: 'mac mini' });
  });

  it('fits three heartbeats inside the service default offline window', () => {
    const config = resolveAgentConfig();

    expect(config.heartbeatIntervalMs).toBe(5_000);
    expect(config.heartbeatIntervalMs * 3).toBeLessThanOrEqual(15_000);
  });

  it('takes every interval from the settings when they are given', () => {
    const config = resolveAgentConfig({ port: 4100, heartbeatIntervalMs: 1_000, passiveToleranceMs: 500, pingFailureThreshold: 5, workDir: '/tmp/agent' });

    expect(config).toMatchObject({ port: 4100, heartbeatIntervalMs: 1_000, passiveToleranceMs: 500, pingFailureThreshold: 5, workDir: '/tmp/agent' });
  });
});
