import { InvalidRequestError } from '@mini-cloud/shared';
import { createServiceManager } from '../../src/service';
import { AGENT_UNIT, CONTROL_PLANE_UNIT } from '../../src/service/units';

describe('createServiceManager', () => {
  it('points at the foreground command where there is no supervisor to install under', () => {
    expect(() => createServiceManager(AGENT_UNIT, 'win32')).toThrow('Run it in the foreground with `mini-cloud agent start`.');
    expect(() => createServiceManager(CONTROL_PLANE_UNIT, 'win32')).toThrow('Run it in the foreground with `mini-cloud serve`.');
  });

  it('says so as an expected outcome, not a bug', () => {
    expect(() => createServiceManager(AGENT_UNIT, 'win32')).toThrow(InvalidRequestError);
  });
});
