import { buildUnit as buildUnitFor } from '../../src/service/systemd';
import { DaemonUnit, InstallOptions } from '../../src/service/types';
import { AGENT_UNIT, CONTROL_PLANE_UNIT } from '../../src/service/units';

const options = (overrides: Partial<InstallOptions> = {}): InstallOptions => ({
  programArguments: ['/usr/local/bin/mini-cloud', 'serve'],
  env: { HOME: '/home/someone' },
  enable: true,
  ...overrides,
});

const buildUnit = (installOptions: InstallOptions, unit: DaemonUnit = CONTROL_PLANE_UNIT): string => buildUnitFor(unit, installOptions);

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
    expect(CONTROL_PLANE_UNIT.systemdUnit).toBe('mini-cloud.service');
  });

  it('stops the control plane with its whole cgroup, since nothing in it should outlive it', () => {
    const unit = buildUnit(options());

    expect(unit).toContain('Description=mini-cloud control plane');
    expect(unit).not.toContain('KillMode');
  });
});

describe('buildUnit for the agent', () => {
  const unit = buildUnit(options({ programArguments: ['/usr/local/bin/mini-cloud', 'agent', 'start'] }), AGENT_UNIT);

  it('describes itself as the agent', () => {
    expect(unit).toContain('Description=mini-cloud agent');
    expect(AGENT_UNIT.systemdUnit).toBe('mini-cloud-agent.service');
  });

  it('signals only the agent on stop, so a restart does not kill every task it launched', () => {
    // Detaching a task gives it its own session, but not its own cgroup; the default
    // KillMode=control-group would take every task down with the agent.
    expect(unit).toContain('KillMode=process');
  });

  it('keeps the crash restart that also covers a control plane that is not up yet', () => {
    expect(unit).toContain('Restart=on-failure');
  });
});
