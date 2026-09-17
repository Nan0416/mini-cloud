import { unitEnvironment } from '../../src/service/environment';
import { AGENT_UNIT, CONTROL_PLANE_UNIT } from '../../src/service/units';

const controlPlane = (source: NodeJS.ProcessEnv): Record<string, string> => unitEnvironment(CONTROL_PLANE_UNIT.environmentKeys, source);

describe('unitEnvironment', () => {
  it('carries HOME, which is how the daemon finds its config file at all', () => {
    // Without it the service resolves ~/.mini-cloud against nothing, reads defaults,
    // and looks for all the world like it is ignoring a file that is plainly there.
    expect(controlPlane({ HOME: '/home/someone' })).toEqual({ HOME: '/home/someone' });
  });

  it('carries PATH, because nothing is spawned without one', () => {
    expect(controlPlane({ PATH: '/usr/bin' })).toEqual({ PATH: '/usr/bin' });
  });

  it('carries no settings at all, so the unit cannot go stale against the file', () => {
    // The unit used to bake every MINI_CLOUD_* variable in, which made it a second copy of the
    // configuration that only a reinstall could correct.
    const source = { MINI_CLOUD_PUBLIC_TOKEN: 'secret', MINI_CLOUD_DATABASE_URL: 'postgres://db/mc' };

    expect(controlPlane(source)).toEqual({});
    expect(unitEnvironment(AGENT_UNIT.environmentKeys, source)).toEqual({});
  });

  it('leaves the rest of the shell behind', () => {
    expect(controlPlane({ AWS_SECRET_ACCESS_KEY: 'nope', TERM: 'xterm', SSH_AUTH_SOCK: '/tmp/ssh' })).toEqual({});
  });

  it('drops a variable that is present but empty', () => {
    expect(controlPlane({ HOME: '', PATH: undefined })).toEqual({});
  });

  it('gives the agent what its tasks inherit, so a task sees the same locale under the daemon as in a terminal', () => {
    const shell = { HOME: '/home/someone', PATH: '/usr/bin', LANG: 'en_US.UTF-8', TZ: 'Asia/Tokyo', TERM: 'xterm' };

    expect(unitEnvironment(AGENT_UNIT.environmentKeys, shell)).toEqual({ HOME: '/home/someone', PATH: '/usr/bin', LANG: 'en_US.UTF-8', TZ: 'Asia/Tokyo' });
  });
});
