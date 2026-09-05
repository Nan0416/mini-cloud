import { ForbiddenError } from '@mini-cloud/shared';
import { subnetFilter } from '../../src/middleware/subnet-filter';
import { fakeRequest, fakeResponse, recordingNext } from './test-helpers';

const SUBNETS = ['127.0.0.0/8', '192.168.0.0/16'];

const run = (init: Parameters<typeof fakeRequest>[0], subnets: ReadonlyArray<string> = SUBNETS) => {
  const next = recordingNext();
  subnetFilter({ subnets })(fakeRequest(init), fakeResponse().asResponse(), next);
  return next;
};

describe('subnetFilter', () => {
  it('lets a connection from a trusted network through', () => {
    const next = run({ remoteAddress: '192.168.1.20' });

    expect(next.called).toBe(true);
    expect(next.error).toBeUndefined();
  });

  it('refuses one from outside, with a 403 rather than a 401', () => {
    const next = run({ remoteAddress: '203.0.113.7' });

    // The caller is not missing a credential — no credential would help. Answering
    // 401 would have a client retry with a token forever.
    expect(next.error).toBeInstanceOf(ForbiddenError);
    expect((next.error as ForbiddenError).statusCode).toBe(403);
  });

  it('says which address was refused and how to admit it', () => {
    const next = run({ remoteAddress: '203.0.113.7' });

    expect((next.error as Error).message).toContain('203.0.113.7');
    expect((next.error as Error).message).toContain('MINI_CLOUD_TRUSTED_SUBNETS');
  });

  it('reads the peer from the socket, not from a header a caller can write', () => {
    // The whole filter is worthless if `X-Forwarded-For` can set the address: anyone
    // willing to send a header would be inside the LAN.
    const next = run({ remoteAddress: '203.0.113.7', headers: { 'x-forwarded-for': '192.168.1.20' } });

    expect(next.error).toBeInstanceOf(ForbiddenError);
  });

  it('refuses a connection whose address node could not report', () => {
    // A closed socket reports no address. Failing open here would make an
    // already-degraded connection the way past the check.
    expect(run({ remoteAddress: null }).error).toBeInstanceOf(ForbiddenError);
  });

  it('refuses to start with a subnet it cannot parse', () => {
    // At construction, so a typo is a startup failure rather than a machine that
    // mysteriously cannot connect later.
    expect(() => subnetFilter({ subnets: ['192.168.0.0/16', 'oops'] })).toThrow(/not a valid CIDR block/);
  });
});
