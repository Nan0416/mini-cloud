import os from 'node:os';
import { defaultAgentId, loadAgentConfig } from '../src/agent-config';

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

describe('loadAgentConfig', () => {
  const AGENT_ENV = ['MINI_CLOUD_AGENT_ID', 'MINI_CLOUD_AGENT_NAME'] as const;
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of AGENT_ENV) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
    // Pinned, so these assertions do not depend on what the test machine is called.
    jest.spyOn(os, 'hostname').mockReturnValue('Nans-MacBook-Pro.local');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const key of AGENT_ENV) {
      const value = saved.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('prefers the flag over the environment, and reports the id as supplied', () => {
    process.env['MINI_CLOUD_AGENT_ID'] = 'from-env';
    const config = loadAgentConfig({ agentId: 'from-flag' });
    expect(config.agentId).toBe('from-flag');
    expect(config.agentIdSource).toBe('supplied');
  });

  it('falls back to the environment, and still reports the id as supplied', () => {
    process.env['MINI_CLOUD_AGENT_ID'] = 'from-env';
    const config = loadAgentConfig();
    expect(config.agentId).toBe('from-env');
    expect(config.agentIdSource).toBe('supplied');
  });

  it('names the machine after itself when nothing is configured', () => {
    const config = loadAgentConfig();
    expect(config.agentId).toBe('nans-macbook-pro');
    expect(config.agentIdSource).toBe('hostname');
  });

  it('treats an empty configured id as absent rather than as an id', () => {
    process.env['MINI_CLOUD_AGENT_ID'] = '';
    expect(loadAgentConfig().agentId).toBe('nans-macbook-pro');
  });

  it('refuses to start when the hostname cannot identify one machine', () => {
    jest.spyOn(os, 'hostname').mockReturnValue('localhost');
    expect(() => loadAgentConfig()).toThrow(/--id/);
  });

  it('defaults the name to the resolved id, so agents sharing a host stay distinguishable', () => {
    // Not to the hostname: `--id laptop-1-b` on the same box as `laptop-1` would
    // otherwise register a name identical to the first agent's.
    expect(loadAgentConfig({ agentId: 'laptop-1-b' }).name).toBe('laptop-1-b');
    expect(loadAgentConfig().name).toBe('nans-macbook-pro');
  });

  it('keeps the name override independent of the id', () => {
    process.env['MINI_CLOUD_AGENT_NAME'] = 'from-env';
    expect(loadAgentConfig({ agentId: 'laptop-1-b', name: 'mac mini (second)' }).name).toBe('mac mini (second)');
    expect(loadAgentConfig({ agentId: 'laptop-1-b' }).name).toBe('from-env');
  });
});
