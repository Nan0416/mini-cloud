import { buildPlist, LAUNCHD_LABEL } from '../../src/service/launchd';
import { InstallOptions } from '../../src/service/types';

const options = (overrides: Partial<InstallOptions> = {}): InstallOptions => ({
  programArguments: ['/usr/local/bin/mini-cloud', 'serve'],
  env: { MINI_CLOUD_PUBLIC_TOKEN: 'secret', PATH: '/usr/bin' },
  logPath: '/Users/someone/.mini-cloud/service/service.log',
  enable: true,
  ...overrides,
});

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

    expect(plist).toContain('<key>MINI_CLOUD_PUBLIC_TOKEN</key>');
    expect(plist).toContain('<string>secret</string>');
  });

  it('restarts a crash but not a clean exit, so `daemon stop` sticks', () => {
    // KeepAlive=true would have launchd relaunch within the second of a stop. The
    // SuccessfulExit=false form is the launchd spelling of Restart=on-failure.
    const plist = buildPlist(options());

    expect(plist).toContain('<key>SuccessfulExit</key>');
    expect(plist).not.toMatch(/<key>KeepAlive<\/key>\s*<true\s*\/>/);
  });

  it('does not persist or auto-restart when installed with --no-enable', () => {
    const plist = buildPlist(options({ enable: false }));

    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<false\s*\/>/);
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<false\s*\/>/);
  });

  it('escapes what would otherwise close a tag early', () => {
    // A token is random hex today, but it is operator-supplied and an `&` in one
    // would produce a plist launchd refuses to parse — which surfaces as a service
    // that simply never starts.
    const plist = buildPlist(options({ env: { MINI_CLOUD_PUBLIC_TOKEN: 'a&b<c>"d"' } }));

    expect(plist).toContain('<string>a&amp;b&lt;c&gt;&quot;d&quot;</string>');
  });

  it('sends both streams to the same file, so the order of a crash is readable', () => {
    const plist = buildPlist(options());

    expect(plist).toContain(`<key>StandardOutPath</key>\n  <string>${options().logPath}</string>`);
    expect(plist).toContain(`<key>StandardErrorPath</key>\n  <string>${options().logPath}</string>`);
  });

  it('labels itself under the domain the project already owns', () => {
    expect(LAUNCHD_LABEL).toBe('dev.qinnan.mini-cloud');
    expect(buildPlist(options())).toContain(`<string>${LAUNCHD_LABEL}</string>`);
  });
});
