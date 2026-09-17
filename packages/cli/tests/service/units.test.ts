import { AGENT_UNIT, CONTROL_PLANE_UNIT } from '../../src/service/units';

describe('daemon units', () => {
  it('share no name, so a control plane and an agent install side by side', () => {
    // Either collision would have one `start` overwrite the other's unit, or one
    // `uninstall` remove both.
    const identity = ({ launchdLabel, systemdUnit, logPath, command }: typeof AGENT_UNIT): ReadonlyArray<string> => [launchdLabel, systemdUnit, logPath, command];

    for (const [index, value] of identity(CONTROL_PLANE_UNIT).entries()) {
      expect(identity(AGENT_UNIT)[index]).not.toEqual(value);
    }
  });

  it('run what each one runs in the foreground', () => {
    expect(`mini-cloud ${CONTROL_PLANE_UNIT.subcommand.join(' ')}`).toBe(CONTROL_PLANE_UNIT.foregroundCommand);
    expect(`mini-cloud ${AGENT_UNIT.subcommand.join(' ')}`).toBe(AGENT_UNIT.foregroundCommand);
  });
});
