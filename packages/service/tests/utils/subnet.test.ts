import { describeUntrustedAddress, isTrustedAddress, parseAddress, parseSubnet, parseSubnets } from '../../src/utils/subnet';

const HOME = parseSubnets(['192.168.0.0/16']);
const DEFAULTS = parseSubnets(['127.0.0.0/8', '::1/128', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7', 'fe80::/10']);

describe('matching an address against a subnet', () => {
  it('admits an address inside the block and refuses one outside it', () => {
    expect(isTrustedAddress('192.168.1.10', HOME)).toBe(true);
    expect(isTrustedAddress('203.0.113.7', HOME)).toBe(false);
  });

  it('matches an IPv4-mapped address against IPv4 rules', () => {
    // This is the form node reports for an IPv4 client on a dual-stack socket, so a
    // rule written as 192.168.0.0/16 has to match it. Comparing strings would not.
    expect(isTrustedAddress('::ffff:192.168.1.10', HOME)).toBe(true);
    expect(isTrustedAddress('::ffff:203.0.113.7', HOME)).toBe(false);
  });

  it('never matches on a shared textual prefix', () => {
    // `startsWith('192.168.')` says yes to both of these. The whole reason the
    // comparison is arithmetic is that neither is on the home network.
    expect(isTrustedAddress('192.168.1.1.evil.com', HOME)).toBe(false);
    expect(isTrustedAddress('192.1680.1.1', HOME)).toBe(false);
  });

  it('respects the boundaries of an awkward prefix length', () => {
    const twelve = parseSubnets(['172.16.0.0/12']);

    expect(isTrustedAddress('172.15.255.255', twelve)).toBe(false);
    expect(isTrustedAddress('172.16.0.0', twelve)).toBe(true);
    expect(isTrustedAddress('172.31.255.255', twelve)).toBe(true);
    expect(isTrustedAddress('172.32.0.0', twelve)).toBe(false);
  });

  it('matches IPv6 in its own right, not as an afterthought', () => {
    // A home LAN hands out IPv6 as readily as IPv4, and which one a device picks is
    // not the operator's choice — an allow-list that only spoke IPv4 would refuse
    // machines at random.
    expect(isTrustedAddress('::1', DEFAULTS)).toBe(true);
    expect(isTrustedAddress('fd12:3456::1', DEFAULTS)).toBe(true);
    expect(isTrustedAddress('fe80::1c2b:aaff:fe00:1', DEFAULTS)).toBe(true);
    expect(isTrustedAddress('2001:db8::1', DEFAULTS)).toBe(false);
  });

  it('ignores the zone index node appends to a link-local address', () => {
    // `fe80::1%en0` names an interface, not a different host.
    expect(isTrustedAddress('fe80::1%en0', DEFAULTS)).toBe(true);
  });

  it('treats a bare address as a single host', () => {
    const one = parseSubnets(['192.168.1.10']);

    expect(isTrustedAddress('192.168.1.10', one)).toBe(true);
    expect(isTrustedAddress('192.168.1.11', one)).toBe(false);
  });

  it('admits everything under a zero-length prefix', () => {
    expect(isTrustedAddress('203.0.113.7', parseSubnets(['0.0.0.0/0']))).toBe(true);
  });

  it('keeps the families apart', () => {
    // ::ffff:c0a8:10a and 192.168.1.10 are the same host; ::1 and 0.0.0.1 are not,
    // and a comparison on the raw integer would have said they were.
    expect(isTrustedAddress('::1', HOME)).toBe(false);
    expect(isTrustedAddress('192.168.0.1', parseSubnets(['::/0']))).toBe(false);
  });
});

describe('what cannot be matched', () => {
  it('refuses anything it cannot read as an address', () => {
    // The caller's next move on `false` is to drop the connection. "I could not tell"
    // is not a reason to admit one.
    for (const raw of ['', 'localhost', 'not-an-address', '999.1.1.1', '192.168.1', '1.2.3.4.5', '::ffff:1.2.3.4.5', 'fe80:::1']) {
      expect(isTrustedAddress(raw, DEFAULTS)).toBe(false);
    }
  });

  it('refuses an address that was never supplied', () => {
    expect(isTrustedAddress(undefined, DEFAULTS)).toBe(false);
  });

  it('refuses an octet written with a leading zero', () => {
    // `010` is 8 to a parser that reads it as octal and 10 to one that does not. An
    // allow-list that disagrees with the kernel about which host it named is worse
    // than one that refuses the notation.
    expect(isTrustedAddress('192.168.010.1', HOME)).toBe(false);
  });

  it('refuses every address when the list is empty', () => {
    // Empty means "no check configured", and the callers skip installing one. Reading
    // it as "matches everything" here would make an empty list silently permissive in
    // any caller that forgot.
    expect(isTrustedAddress('192.168.1.10', [])).toBe(false);
  });
});

describe('reading configuration', () => {
  it('rejects a malformed block at startup rather than dropping it', () => {
    // A skipped entry is a shorter allow-list, and the machine it was meant to admit
    // then fails at connect time with nothing pointing at the typo.
    expect(() => parseSubnet('192.168.0.0/64')).toThrow(/between 0 and 32/);
    expect(() => parseSubnet('nonsense/24')).toThrow(/not an IP address/);
    expect(() => parseSubnet('192.168.0.0/24/8')).toThrow(/expected <address>/);
    expect(() => parseSubnets(['192.168.0.0/16', 'oops'])).toThrow(/not a valid CIDR block/);
  });

  it('accepts a full-width IPv6 prefix', () => {
    expect(() => parseSubnet('::1/128')).not.toThrow();
    expect(() => parseSubnet('::1/129')).toThrow(/between 0 and 128/);
  });

  it('masks the host bits away, so a block written from an address still matches', () => {
    // `192.168.1.37/24` is how people write down the network they are on.
    expect(isTrustedAddress('192.168.1.99', parseSubnets(['192.168.1.37/24']))).toBe(true);
  });

  it('parses both families and reports which one it found', () => {
    expect(parseAddress('10.0.0.1')).toEqual({ value: 167772161n, family: 4 });
    expect(parseAddress('::ffff:10.0.0.1')?.family).toBe(4);
    expect(parseAddress('2001:db8::1')?.family).toBe(6);
    expect(parseAddress('nope')).toBeUndefined();
  });
});

describe('explaining a rejection', () => {
  it('names the address, the list and the variable that holds it', () => {
    const message = describeUntrustedAddress('203.0.113.7', HOME);

    // A bare "Forbidden" reads as a broken service: nothing about the request says
    // the objection was to where it came from.
    expect(message).toContain('203.0.113.7');
    expect(message).toContain('192.168.0.0/16');
    expect(message).toContain('MINI_CLOUD_TRUSTED_SUBNETS');
  });

  it('still says something useful when there was no address at all', () => {
    expect(describeUntrustedAddress(undefined, HOME)).toContain('This connection');
  });
});
