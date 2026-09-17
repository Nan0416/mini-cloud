import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serviceArgv, stableBinaryPath } from '../src/self-exec';

describe('serviceArgv', () => {
  it('reproduces the node + script form, which is what a checkout runs as', () => {
    const argv = serviceArgv(['serve'], { execPath: '/usr/bin/node', entryArgs: ['/repo/packages/cli/bin/mini-cloud.js'] });

    expect(argv).toEqual(['/usr/bin/node', '/repo/packages/cli/bin/mini-cloud.js', 'serve']);
  });

  it('runs the binary directly when there is no script to name', () => {
    // A single-file build dispatches its own subcommands, so a unit written for the
    // node form — with an argv[1] that does not exist — would fail to start.
    const argv = serviceArgv(['serve'], { execPath: '/usr/local/bin/mini-cloud', entryArgs: [] });

    expect(argv).toEqual(['/usr/local/bin/mini-cloud', 'serve']);
  });
});

describe('resolveSelfExec', () => {
  it('follows a symlink, so `npm link` does not bake an indirection into the unit', async () => {
    // What `npm link` leaves on the PATH is a symlink into the checkout.
    const { resolveSelfExec } = await import('../src/self-exec');
    const self = resolveSelfExec([process.execPath, __filename]);

    expect(self.entryArgs).toEqual([realpathSync(__filename)]);
    expect(self.execPath).toBe(process.execPath);
  });

  it('refuses to guess when there is no script path at all', async () => {
    const { resolveSelfExec } = await import('../src/self-exec');

    expect(() => resolveSelfExec([process.execPath])).toThrow(/no script path/);
  });
});

describe('stableBinaryPath', () => {
  let home: string;
  let binDir: string;
  let installed: string;

  /** The layout install.sh leaves: a file per version, and a symlink on the PATH. */
  const install = (version: string): string => {
    const file = join(home, '.local', 'share', 'mini-cloud', 'versions', version, 'mini-cloud');
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, '');
    return file;
  };
  const link = (target: string, path = join(binDir, 'mini-cloud')): string => {
    mkdirSync(join(path, '..'), { recursive: true });
    symlinkSync(target, path);
    return path;
  };

  beforeEach(() => {
    // Real paths throughout: macOS's tmpdir is itself behind a symlink.
    home = realpathSync(mkdtempSync(join(tmpdir(), 'mini-cloud-home-')));
    binDir = join(home, '.local', 'bin');
    installed = install('1.2.0');
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('names the symlink the shell found on the PATH, so a unit follows updates', () => {
    const launcher = link(installed, join(home, 'bin', 'mini-cloud'));

    expect(stableBinaryPath(installed, 'mini-cloud', `/nowhere:${join(home, 'bin')}`, home)).toBe(launcher);
  });

  it('names the symlink it was run through by path', () => {
    const launcher = link(installed);

    expect(stableBinaryPath(installed, launcher, '', home)).toBe(launcher);
  });

  it("falls back to the installer's symlink when run by its versioned path", () => {
    const launcher = link(installed);

    expect(stableBinaryPath(installed, installed, '', home)).toBe(launcher);
  });

  it('ignores a symlink to some other version', () => {
    link(install('1.1.0'));

    expect(stableBinaryPath(installed, 'mini-cloud', binDir, home)).toBe(installed);
  });

  it('keeps the binary itself when nothing links to it', () => {
    const extracted = join(home, 'Downloads', 'mini-cloud');
    mkdirSync(join(extracted, '..'));
    writeFileSync(extracted, '');

    expect(stableBinaryPath(extracted, './mini-cloud', '', home)).toBe(extracted);
  });
});
