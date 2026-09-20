import { assertRecord, assertString, InternalServiceError, ServiceUnreachableError } from '@mini-cloud/shared';
import { spawnSync } from 'node:child_process';
import { parseVersion } from './semver';

/** Where the release workflow publishes. `install.sh` defaults to the same address. */
export const DOWNLOADS_URL = 'https://mini-cloud.qinnan.dev/downloads/cli';

const FETCH_TIMEOUT_MS = 10_000;

/** Node's fetch reports every network failure as "fetch failed" and keeps the reason in `cause`. */
function reason(err: unknown): string {
  if (err instanceof Error) {
    return err.cause instanceof Error ? err.cause.message : err.message;
  }
  return String(err);
}

/**
 * The published binaries: `version.json` names the latest release, and each release's
 * directory holds the `install.sh` that installs it.
 */
export class ReleaseChannel {
  constructor(
    private readonly baseUrl: string = DOWNLOADS_URL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async latestVersion(): Promise<string> {
    const url = `${this.baseUrl}/version.json`;
    const body = await this.get(url);
    let version: string;
    try {
      version = assertString(assertRecord(JSON.parse(body), 'version.json')['version'], 'version');
    } catch (err) {
      throw new InternalServiceError(`${url} is not a release manifest: ${reason(err)}`);
    }
    if (parseVersion(version) === undefined) {
      throw new InternalServiceError(`${url} names "${version}", which is not a version.`);
    }
    return version;
  }

  /**
   * Runs that release's own installer, so an update and a first install are the same
   * code. Its output goes straight to the terminal; its failure is already explained there.
   */
  async install(version: string): Promise<void> {
    const url = `${this.baseUrl}/v${version}/install.sh`;
    const script = await this.get(url);
    // A 200 is not proof of a script. A captive portal answers with its login page, and
    // the distribution serving these turns a 403 from the bucket into the console's HTML
    // — either would reach `sh` as a wall of syntax errors rather than as one sentence.
    if (!script.startsWith('#!')) {
      throw new InternalServiceError(`${url} answered with something that is not a script. Nothing was installed.`);
    }
    const result = spawnSync('sh', ['-s'], {
      input: script,
      stdio: ['pipe', 'inherit', 'inherit'],
      env: { ...process.env, MINI_CLOUD_VERSION: version, MINI_CLOUD_INSTALL_URL: this.baseUrl },
    });
    if (result.error !== undefined) {
      throw new InternalServiceError(`Could not run the installer: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new InternalServiceError('The installer failed, so the version installed before it is still the one on the PATH.');
    }
  }

  private async get(url: string): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      throw new ServiceUnreachableError(`Could not reach ${url}: ${reason(err)}. Check the connection and try again.`);
    }
    if (!response.ok) {
      throw new InternalServiceError(`${url} answered ${response.status}.`);
    }
    return response.text();
  }
}
