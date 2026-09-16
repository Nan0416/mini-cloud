import { buildUnit, SYSTEMD_UNIT } from '../../src/service/systemd';
import { InstallOptions } from '../../src/service/types';

const options = (overrides: Partial<InstallOptions> = {}): InstallOptions => ({
  programArguments: ['/usr/local/bin/mini-cloud', 'serve'],
  env: { HOME: '/home/someone' },
  logPath: '/home/someone/.mini-cloud/service/service.log',
  enable: true,
  ...overrides,
});

describe('buildUnit', () => {
  it('quotes every argument, so a path with a space stays one argument', () => {
    // systemd parses ExecStart as a command line: unquoted, this installs a unit that
    // tries to run `/home/some` and fails at boot rather than at install.
    const unit = buildUnit(options({ programArguments: ['/home/some one/bin/mini-cloud', 'serve'] }));

    expect(unit).toContain('ExecStart="/home/some one/bin/mini-cloud" "serve"');
  });

  it('doubles a percent, which systemd would otherwise read as a specifier', () => {
    const unit = buildUnit(options({ env: { PATH: '/opt/50%off/bin' } }));

    expect(unit).toContain('Environment="PATH=/opt/50%%off/bin"');
  });

  it('bakes the environment, because a user unit reads no profile', () => {
    expect(buildUnit(options())).toContain('Environment="HOME=/home/someone"');
  });

  it('retries a crash on a fixed delay, which is also how it waits for Postgres', () => {
    // A user unit cannot order itself after a system service, so a database that is not up yet
    // reads as a crash.
    const unit = buildUnit(options());

    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('RestartSec=5');
  });

  it('gives shutdown room, but less than systemd would wait by default', () => {
    expect(buildUnit(options())).toContain('TimeoutStopSec=30');
  });

  it('installs into the user target, so it needs no root', () => {
    expect(buildUnit(options())).toContain('WantedBy=default.target');
    expect(SYSTEMD_UNIT).toBe('mini-cloud.service');
  });
});
