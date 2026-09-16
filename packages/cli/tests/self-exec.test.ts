import { realpathSync } from 'node:fs';
import { serviceArgv } from '../src/self-exec';

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
