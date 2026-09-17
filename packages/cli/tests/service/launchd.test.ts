import { buildPlist as buildPlistFor } from '../../src/service/launchd';
import { DaemonUnit, InstallOptions } from '../../src/service/types';
import { AGENT_UNIT, CONTROL_PLANE_UNIT } from '../../src/service/units';

const options = (overrides: Partial<InstallOptions> = {}): InstallOptions => ({
  programArguments: ['/usr/local/bin/mini-cloud', 'serve'],
  env: { HOME: '/Users/someone', PATH: '/usr/bin' },
  enable: true,
  ...overrides,
});

const buildPlist = (installOptions: InstallOptions, unit: DaemonUnit = CONTROL_PLANE_UNIT): string => buildPlistFor(unit, installOptions);

describe('buildPlist', () => {
  it('runs the resolved argv, one element per string, so a path with a space survives', () => {
    // launchd takes a structured array, which is the whole reason it needs no quoting
    // rules — unlike systemd's ExecStart, where the same path has to be escaped.
    const plist = buildPlist(options({ programArguments: ['/Users/some one/bin/mini-cloud', 'serve'] }));

    expect(plist).toContain('<string>/Users/some one/bin/mini-cloud</string>');
    expect(plist).toContain('<string>serve</string>');
  });

  it('bakes the environment, because a login service reads no profile', () => {
    const plist = buildPlist(options());

    expect(plist).toContain('<key>HOME</key>');
    expect(plist).toContain('<string>/Users/someone</string>');
  });

  it('restarts a crash but not a clean exit, so `daemon stop` sticks', () => {
    // KeepAlive=true would have launchd relaunch within the second of a stop. The
    // SuccessfulExit=false form is the launchd spelling of Restart=on-failure.
    const plist = buildPlist(options());

    expect(plist).toContain('<key>SuccessfulExit</key>');
    expect(plist).not.toMatch(/<key>KeepAlive<\/key>\s*<true\s*\/>/);
  });

  it('does not start at login with --no-enable, but still recovers from a crash', () => {
    // --no-enable is about persistence. Switching off crash recovery too would make the
    // same flag mean something different here than it does on systemd, whose unit keeps
    // Restart=on-failure either way.
    const plist = buildPlist(options({ enable: false }));

    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<false\s*\/>/);
    expect(plist).toContain('<key>SuccessfulExit</key>');
    expect(plist).not.toMatch(/<key>KeepAlive<\/key>\s*<false\s*\/>/);
  });

  it('escapes what would otherwise close a tag early', () => {
    // A token is random hex today, but it is operator-supplied and an `&` in one would produce
    // a plist launchd refuses to parse — which surfaces as a service that simply never starts.
    const plist = buildPlist(options({ env: { HOME: 'a&b<c>"d"' } }));

    expect(plist).toContain('<string>a&amp;b&lt;c&gt;&quot;d&quot;</string>');
  });

  it('sends both streams to the same file, so the order of a crash is readable', () => {
    const plist = buildPlist(options());

    expect(plist).toContain(`<key>StandardOutPath</key>\n  <string>${CONTROL_PLANE_UNIT.logPath}</string>`);
    expect(plist).toContain(`<key>StandardErrorPath</key>\n  <string>${CONTROL_PLANE_UNIT.logPath}</string>`);
  });

  it('labels itself under the domain the project already owns', () => {
    expect(CONTROL_PLANE_UNIT.launchdLabel).toBe('dev.qinnan.mini-cloud');
    expect(buildPlist(options())).toContain('<string>dev.qinnan.mini-cloud</string>');
  });

  it('runs the control plane as a background job, since it launches no tasks', () => {
    const plist = buildPlist(options());

    expect(plist).toMatch(/<key>ProcessType<\/key>\s*<string>Background<\/string>/);
    expect(plist).not.toContain('AbandonProcessGroup');
  });
});

describe('buildPlist for the agent', () => {
  const plist = buildPlist(options({ programArguments: ['/usr/local/bin/mini-cloud', 'agent', 'start'] }), AGENT_UNIT);

  it('takes its own label and log, so it installs beside a control plane', () => {
    expect(plist).toContain('<string>dev.qinnan.mini-cloud.agent</string>');
    expect(plist).toContain(`<string>${AGENT_UNIT.logPath}</string>`);
    expect(plist).not.toContain(CONTROL_PLANE_UNIT.logPath);
  });

  it('is not a background job, whose CPU and I/O throttling every task would inherit', () => {
    expect(plist).toMatch(/<key>ProcessType<\/key>\s*<string>Standard<\/string>/);
  });

  it('leaves the tasks it launched running when it stops', () => {
    expect(plist).toMatch(/<key>AbandonProcessGroup<\/key>\s*<true\s*\/>/);
  });

  it('still restarts a crash and still lets a stop stick', () => {
    expect(plist).toContain('<key>SuccessfulExit</key>');
  });
});
