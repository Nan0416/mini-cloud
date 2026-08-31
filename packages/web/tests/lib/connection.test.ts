import { ServiceUnreachableError, UnauthenticatedError, NotFoundError } from '@mini-cloud/shared';
import { classifyProbeFailure, isUsableApiUrl, normalizeApiUrl, parseBackendParam, resolveConnection } from '@/lib/connection';

describe('normalizeApiUrl', () => {
  it('drops trailing slashes, so one service is not two entries', () => {
    expect(normalizeApiUrl('http://host:3000/')).toBe('http://host:3000');
    expect(normalizeApiUrl('  http://host:3000///  ')).toBe('http://host:3000');
  });
});

describe('isUsableApiUrl', () => {
  it('accepts the two schemes the client can actually speak', () => {
    expect(isUsableApiUrl('http://127.0.0.1:3000')).toBe(true);
    expect(isUsableApiUrl('https://mini-cloud.example.com')).toBe(true);
  });

  it('rejects what would otherwise fail minutes later as an offline banner', () => {
    expect(isUsableApiUrl('')).toBe(false);
    expect(isUsableApiUrl('   ')).toBe(false);
    expect(isUsableApiUrl('127.0.0.1:3000')).toBe(false);
    expect(isUsableApiUrl('ftp://host')).toBe(false);
    expect(isUsableApiUrl('not a url')).toBe(false);
  });
});

describe('parseBackendParam', () => {
  it('reads a percent-encoded address, so a path survives the round trip', () => {
    expect(parseBackendParam('?backend=http%3A%2F%2F127.0.0.1%3A3000')).toBe('http://127.0.0.1:3000');
  });

  it('ignores a parameter that is absent or unusable', () => {
    expect(parseBackendParam('')).toBeUndefined();
    expect(parseBackendParam('?other=1')).toBeUndefined();
    expect(parseBackendParam('?backend=nonsense')).toBeUndefined();
  });
});

describe('resolveConnection', () => {
  const stored = { apiUrl: 'http://stored:3000', token: 'stored-token' };
  const build = { apiUrl: 'http://build:3000' };

  it('lets a link win, so a shared URL configures the console it opens', () => {
    expect(resolveConnection({ fromQuery: 'http://link:3000', fromStorage: stored, fromBuild: build })).toEqual({ apiUrl: 'http://link:3000', token: undefined });
  });

  it('keeps the stored token when the link points at the service already stored', () => {
    // Switching between two machines that share a fleet token should not mean
    // retyping it, and the link cannot carry one.
    expect(resolveConnection({ fromQuery: 'http://stored:3000', fromStorage: stored })).toEqual({ apiUrl: 'http://stored:3000', token: 'stored-token' });
  });

  it('prefers this browser, so a returning visitor is not asked twice', () => {
    expect(resolveConnection({ fromStorage: stored, fromBuild: build })).toEqual(stored);
  });

  it('falls back to a baked-in URL, which is what keeps a self-built bundle unchanged', () => {
    expect(resolveConnection({ fromBuild: build })).toEqual(build);
  });

  it('resolves to nothing when there is no answer, which is what shows the setup screen', () => {
    expect(resolveConnection({})).toBeUndefined();
  });
});

describe('classifyProbeFailure', () => {
  it('separates "wants a token" from "that token is wrong"', () => {
    // The distinction is the difference between showing the field and saying no.
    expect(classifyProbeFailure(new UnauthenticatedError('nope'), false)).toBe('needs-token');
    expect(classifyProbeFailure(new UnauthenticatedError('nope'), true)).toBe('bad-token');
  });

  it('reports a transport failure as unreachable, whatever the browser blocked it for', () => {
    expect(classifyProbeFailure(new ServiceUnreachableError('nothing answered'), false)).toBe('unreachable');
  });

  it('treats anything else as an answer it did not understand', () => {
    expect(classifyProbeFailure(new NotFoundError('no such route'), false)).toBe('error');
    expect(classifyProbeFailure(new Error('boom'), false)).toBe('error');
  });
});
