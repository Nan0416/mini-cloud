import { unitEnvironment } from '../../src/service/environment';

describe('unitEnvironment', () => {
  it('carries HOME, which is how the daemon finds its config file at all', () => {
    // Without it the service resolves ~/.mini-cloud against nothing, reads defaults,
    // and looks for all the world like it is ignoring a file that is plainly there.
    expect(unitEnvironment({ HOME: '/home/someone' })).toEqual({ HOME: '/home/someone' });
  });

  it('carries PATH, because the control plane spawns nothing without one', () => {
    expect(unitEnvironment({ PATH: '/usr/bin' })).toEqual({ PATH: '/usr/bin' });
  });

  it('carries no settings at all, so the unit cannot go stale against the file', () => {
    // The unit used to bake every MINI_CLOUD_* variable in, which made it a second copy
    // of the configuration that only a reinstall could correct. Settings live in
    // ~/.mini-cloud/config.json now and are read at every start.
    expect(unitEnvironment({ MINI_CLOUD_PUBLIC_TOKEN: 'secret', MINI_CLOUD_DATABASE_URL: 'postgres://db/mc' })).toEqual({});
  });

  it('leaves the rest of the shell behind', () => {
    expect(unitEnvironment({ AWS_SECRET_ACCESS_KEY: 'nope', TERM: 'xterm', SSH_AUTH_SOCK: '/tmp/ssh' })).toEqual({});
  });

  it('drops a variable that is present but empty', () => {
    expect(unitEnvironment({ HOME: '', PATH: undefined })).toEqual({});
  });
});
