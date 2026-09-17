import { InternalServiceError, ServiceUnreachableError } from '@mini-cloud/shared';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReleaseChannel } from '../../src/update/release-channel';

const BASE_URL = 'https://downloads.test/cli';

/** Answers from a fixed table of URLs, and 404 for the rest. */
function fakeFetch(files: Record<string, string>, requested: string[] = []): typeof fetch {
  return async (input) => {
    const url = String(input);
    requested.push(url);
    const body = files[url];
    return body === undefined ? new Response('missing', { status: 404 }) : new Response(body);
  };
}

describe('ReleaseChannel.latestVersion', () => {
  it('reads the version the manifest names', async () => {
    const channel = new ReleaseChannel(BASE_URL, fakeFetch({ [`${BASE_URL}/version.json`]: '{"version":"1.4.0","publishedAt":"2026-09-17T00:00:00Z"}\n' }));

    await expect(channel.latestVersion()).resolves.toBe('1.4.0');
  });

  it.each([
    ['not JSON', '<html>console</html>'],
    ['JSON without a version', '{"latest":"1.4.0"}'],
    ['a version that is not one', '{"version":"latest"}'],
  ])('refuses a manifest that is %s, naming where it came from', async (_case, body) => {
    const channel = new ReleaseChannel(BASE_URL, fakeFetch({ [`${BASE_URL}/version.json`]: body }));

    const failure = channel.latestVersion();

    await expect(failure).rejects.toBeInstanceOf(InternalServiceError);
    await expect(failure).rejects.toThrow(`${BASE_URL}/version.json`);
  });

  it('reports the status when the manifest is missing', async () => {
    const channel = new ReleaseChannel(BASE_URL, fakeFetch({}));

    await expect(channel.latestVersion()).rejects.toThrow(`${BASE_URL}/version.json answered 404.`);
  });

  it('tells an unreachable server apart from a broken one, with the underlying reason', async () => {
    const offline: typeof fetch = async () => {
      throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND downloads.test') });
    };
    const failure = new ReleaseChannel(BASE_URL, offline).latestVersion();

    await expect(failure).rejects.toBeInstanceOf(ServiceUnreachableError);
    await expect(failure).rejects.toThrow('ENOTFOUND');
  });
});

describe('ReleaseChannel.install', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mini-cloud-install-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("runs that release's own installer, pinned to it", async () => {
    const recorded = join(dir, 'recorded');
    const requested: string[] = [];
    const installer = `printf '%s %s' "$MINI_CLOUD_VERSION" "$MINI_CLOUD_INSTALL_URL" > '${recorded}'\n`;
    const channel = new ReleaseChannel(BASE_URL, fakeFetch({ [`${BASE_URL}/v1.4.0/install.sh`]: installer }, requested));

    await channel.install('1.4.0');

    expect(requested).toEqual([`${BASE_URL}/v1.4.0/install.sh`]);
    expect(readFileSync(recorded, 'utf-8')).toBe(`1.4.0 ${BASE_URL}`);
  });

  it('fails when the installer does', async () => {
    const channel = new ReleaseChannel(BASE_URL, fakeFetch({ [`${BASE_URL}/v1.4.0/install.sh`]: 'exit 3\n' }));

    await expect(channel.install('1.4.0')).rejects.toThrow('The installer failed');
  });
});
