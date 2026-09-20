import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const INSTALL_SH = join(__dirname, '..', '..', 'scripts', 'install.sh');
const TARGETS = ['darwin-arm64', 'linux-x64', 'linux-arm64'];
// What `curl | sh` runs on Debian and Ubuntu, and what macOS ships beside bash.
const SHELL = existsSync('/bin/dash') ? '/bin/dash' : 'sh';

const run = promisify(execFile);

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

describe('install.sh', () => {
  let work: string;
  let home: string;
  let server: Server;
  let baseUrl: string;
  let files: Map<string, Buffer>;

  /** A stand-in binary that only answers `--version`, packed the way the workflow packs one. */
  const tarball = (reports: string): Buffer => {
    const dir = mkdtempSync(join(work, 'pack-'));
    writeFileSync(join(dir, 'mini-cloud'), `#!/bin/sh\necho ${reports}\n`);
    chmodSync(join(dir, 'mini-cloud'), 0o755);
    execFileSync('tar', ['-czf', join(dir, 'out.tar.gz'), '-C', dir, 'mini-cloud']);
    return readFileSync(join(dir, 'out.tar.gz'));
  };

  /** One release directory, as the workflow uploads it. */
  const publish = (version: string, archive: Buffer = tarball(version)): void => {
    const sums = TARGETS.map((target) => `${createHash('sha256').update(archive).digest('hex')}  mini-cloud-${target}.tar.gz`);
    for (const target of TARGETS) {
      files.set(`/cli/v${version}/mini-cloud-${target}.tar.gz`, archive);
    }
    files.set(`/cli/v${version}/SHA256SUMS`, Buffer.from(`${sums.join('\n')}\n`));
  };
  const markLatest = (version: string): void => {
    files.set('/cli/version.json', Buffer.from(`{"version":"${version}","publishedAt":"2026-09-17T00:00:00Z"}\n`));
  };

  const install = async (env: Record<string, string> = {}): Promise<RunResult> => {
    try {
      const { stdout, stderr } = await run(SHELL, [INSTALL_SH], {
        env: { PATH: process.env['PATH'] ?? '', HOME: home, MINI_CLOUD_INSTALL_URL: `${baseUrl}/cli`, ...env },
      });
      return { code: 0, stdout, stderr };
    } catch (err) {
      const failure = err as { code: number; stdout: string; stderr: string };
      return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
    }
  };
  const launcher = (): string => join(home, '.local', 'bin', 'mini-cloud');
  const versionsDir = (): string => join(home, '.local', 'share', 'mini-cloud', 'versions');

  beforeAll(async () => {
    server = createServer((req, res) => {
      const body = files.get(req.url ?? '');
      res.writeHead(body === undefined ? 404 : 200).end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'mini-cloud-install-sh-'));
    home = join(work, 'home');
    mkdirSync(home);
    files = new Map();
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it('installs the latest release behind a symlink, and says how to put it on the PATH', async () => {
    publish('1.2.0');
    publish('1.3.0');
    markLatest('1.3.0');

    const result = await install();

    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(lstatSync(launcher()).isSymbolicLink()).toBe(true);
    expect(readlinkSync(launcher())).toBe(join(versionsDir(), '1.3.0', 'mini-cloud'));
    expect(execFileSync(launcher(), ['--version'], { encoding: 'utf-8' })).toBe('1.3.0\n');
    expect(result.stdout).toContain(`export PATH="${join(home, '.local', 'bin')}:$PATH"`);
  });

  it('installs the version it is pinned to, with or without a leading v', async () => {
    publish('1.2.0');
    markLatest('9.9.9');

    await install({ MINI_CLOUD_VERSION: 'v1.2.0' });

    expect(readlinkSync(launcher())).toBe(join(versionsDir(), '1.2.0', 'mini-cloud'));
  });

  it('keeps the three newest versions and moves the symlink to the last', async () => {
    for (const version of ['1.0.0', '1.1.0', '1.2.0', '1.3.0']) {
      publish(version);
      expect(await install({ MINI_CLOUD_VERSION: version })).toMatchObject({ code: 0 });
    }

    expect(readdirSync(versionsDir()).sort()).toEqual(['1.1.0', '1.2.0', '1.3.0']);
    expect(readlinkSync(launcher())).toBe(join(versionsDir(), '1.3.0', 'mini-cloud'));
  });

  it('keeps a version pinned by hand, and the two installed most recently beside it', async () => {
    // Pinning an old build is deliberate, so it stays and the least recently installed of
    // the rest goes. Pruning by version order would drop the same directory: the version
    // being installed is never a candidate, so both orders choose among the others.
    for (const version of ['1.0.0', '1.1.0', '1.2.0', '1.3.0']) {
      publish(version);
      await install({ MINI_CLOUD_VERSION: version });
    }
    expect(readdirSync(versionsDir()).sort()).toEqual(['1.1.0', '1.2.0', '1.3.0']);

    expect(await install({ MINI_CLOUD_VERSION: '1.0.0' })).toMatchObject({ code: 0 });

    expect(readdirSync(versionsDir()).sort()).toEqual(['1.0.0', '1.2.0', '1.3.0']);
    expect(execFileSync(launcher(), ['--version'], { encoding: 'utf-8' })).toBe('1.0.0\n');
  });

  it('remembers a custom symlink directory, so an update relinks it rather than a second one', async () => {
    const binDir = join(work, 'custom-bin');
    publish('1.2.0');
    publish('1.3.0');
    markLatest('1.3.0');

    await install({ MINI_CLOUD_VERSION: '1.2.0', MINI_CLOUD_BIN_DIR: binDir });
    // The second run is `mini-cloud update`: the same script, without that environment.
    expect(await install()).toMatchObject({ code: 0 });

    expect(readlinkSync(join(binDir, 'mini-cloud'))).toBe(join(versionsDir(), '1.3.0', 'mini-cloud'));
    expect(existsSync(launcher())).toBe(false);
  });

  it('keeps the command working when the version it is on is installed again', async () => {
    publish('1.2.0');

    await install({ MINI_CLOUD_VERSION: '1.2.0' });
    expect(await install({ MINI_CLOUD_VERSION: '1.2.0' })).toMatchObject({ code: 0 });

    expect(execFileSync(launcher(), ['--version'], { encoding: 'utf-8' })).toBe('1.2.0\n');
    expect(readdirSync(versionsDir())).toEqual(['1.2.0']);
  });

  it('refuses an archive that does not match its checksum, leaving the installed version alone', async () => {
    publish('1.2.0');
    await install({ MINI_CLOUD_VERSION: '1.2.0' });
    publish('1.3.0');
    const tampered = tarball('1.3.0 with extras');
    for (const target of TARGETS) {
      files.set(`/cli/v1.3.0/mini-cloud-${target}.tar.gz`, tampered);
    }

    const result = await install({ MINI_CLOUD_VERSION: '1.3.0' });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('does not match SHA256SUMS');
    expect(readlinkSync(launcher())).toBe(join(versionsDir(), '1.2.0', 'mini-cloud'));
  });

  it('refuses a binary that reports a different version than it was published as', async () => {
    publish('2.0.0', tarball('1.9.0'));

    const result = await install({ MINI_CLOUD_VERSION: '2.0.0' });

    expect(result.stderr).toContain('reports itself as 1.9.0');
    expect(existsSync(launcher())).toBe(false);
  });

  it('fails plainly when there is no manifest to read', async () => {
    const result = await install();

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(`could not read the latest version from ${baseUrl}/cli/version.json`);
  });
});
