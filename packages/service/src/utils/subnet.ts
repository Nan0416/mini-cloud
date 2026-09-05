/**
 * CIDR matching for the internal listener's allow-list.
 *
 * Pure and self-contained so the arithmetic can be tested without a socket, and
 * because the two consumers reach it from different places: an Express middleware for
 * ordinary requests, and the hub's `verifyClient` for WebSocket upgrades, which never
 * passes through the middleware stack.
 *
 * Everything is compared as a bigint rather than a string prefix. `192.168.` as a
 * prefix test looks right and is wrong twice over: it matches `192.168.1.1.evil.com`
 * in a hostname, and it misses `::ffff:192.168.1.1`, which is the form Node reports
 * for an IPv4 client on a dual-stack socket.
 */

/** Bit width of each address family, and the widest legal prefix. */
const WIDTH: Readonly<Record<AddressFamily, number>> = { 4: 32, 6: 128 };

/** The `::ffff:0:0/96` prefix, as the value of an IPv4-mapped address's top 96 bits. */
const IPV4_MAPPED_PREFIX = 0xffffn;

export type AddressFamily = 4 | 6;

export interface Address {
  readonly value: bigint;
  readonly family: AddressFamily;
}

export interface Subnet {
  /** As written in configuration, so a rejection can quote what was matched against. */
  readonly cidr: string;
  readonly network: bigint;
  readonly prefixLength: number;
  readonly family: AddressFamily;
}

/**
 * Parses a dotted-quad. Leading zeros are refused rather than accepted: `010` is 8 to
 * anything that reads it as octal and 10 to anything that does not, and an allow-list
 * that disagrees with the kernel about which host an address names is worse than one
 * that rejects the notation outright.
 */
function parseIpv4(raw: string): bigint | undefined {
  const parts = raw.split('.');
  if (parts.length !== 4) {
    return undefined;
  }
  let value = 0n;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) {
      return undefined;
    }
    const octet = Number(part);
    if (octet > 255) {
      return undefined;
    }
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

/** Expands one side of a `::` into 16-bit groups, with an optional IPv4 tail. */
function toGroups(parts: ReadonlyArray<string>): ReadonlyArray<number> | undefined {
  const groups: number[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.includes('.')) {
      // A dotted tail is only legal as the final element, as in `::ffff:192.168.1.1`.
      if (index !== parts.length - 1) {
        return undefined;
      }
      const embedded = parseIpv4(part);
      if (embedded === undefined) {
        return undefined;
      }
      groups.push(Number(embedded >> 16n), Number(embedded & 0xffffn));
      continue;
    }
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) {
      return undefined;
    }
    groups.push(parseInt(part, 16));
  }
  return groups;
}

function parseIpv6(raw: string): bigint | undefined {
  // A zone index (`fe80::1%en0`) names an interface, not a different host. Node
  // includes it on link-local addresses, so it has to come off before parsing.
  const withoutZone = raw.split('%')[0];
  if (!withoutZone.includes(':')) {
    return undefined;
  }

  const halves = withoutZone.split('::');
  if (halves.length > 2) {
    return undefined;
  }
  const head = halves[0].length === 0 ? [] : halves[0].split(':');
  const tail = halves.length === 2 && halves[1].length > 0 ? halves[1].split(':') : [];

  const headGroups = toGroups(head);
  const tailGroups = toGroups(tail);
  if (headGroups === undefined || tailGroups === undefined) {
    return undefined;
  }

  const missing = 8 - headGroups.length - tailGroups.length;
  // `::` stands for at least one group of zeros; without it every group must be written.
  if (halves.length === 2 ? missing < 1 : missing !== 0) {
    return undefined;
  }

  let value = 0n;
  for (const group of [...headGroups, ...new Array<number>(missing).fill(0), ...tailGroups]) {
    value = (value << 16n) | BigInt(group);
  }
  return value;
}

/**
 * Parses an address in either family, or `undefined` when it is not one.
 *
 * An IPv4-mapped address is returned as IPv4. It is the same host connecting over the
 * same wire — the mapping is an artefact of the socket being dual-stack — so
 * `192.168.0.0/16` has to match it, and a rule written in IPv6 would not.
 */
export function parseAddress(raw: string): Address | undefined {
  const trimmed = raw.trim();
  const ipv4 = parseIpv4(trimmed);
  if (ipv4 !== undefined) {
    return { value: ipv4, family: 4 };
  }
  const ipv6 = parseIpv6(trimmed);
  if (ipv6 === undefined) {
    return undefined;
  }
  if (ipv6 >> 32n === IPV4_MAPPED_PREFIX) {
    return { value: ipv6 & 0xffffffffn, family: 4 };
  }
  return { value: ipv6, family: 6 };
}

/**
 * Parses one `address/prefix`, or a bare address meaning a single host.
 *
 * Throws rather than skipping what it cannot read: a mistyped entry that is silently
 * dropped turns an allow-list into a shorter allow-list, and the machine it was meant
 * to admit fails at connect time with no mention of the typo.
 */
export function parseSubnet(cidr: string): Subnet {
  const trimmed = cidr.trim();
  const [rawAddress, rawPrefix, ...rest] = trimmed.split('/');
  if (rest.length > 0) {
    throw new Error(`"${cidr}" is not a valid CIDR block: expected <address>[/<prefix>]`);
  }

  const address = parseAddress(rawAddress);
  if (address === undefined) {
    throw new Error(`"${cidr}" is not a valid CIDR block: "${rawAddress}" is not an IP address`);
  }

  const width = WIDTH[address.family];
  const prefixLength = rawPrefix === undefined ? width : Number(rawPrefix);
  if (!/^\d{1,3}$/.test(rawPrefix ?? '0') || !Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > width) {
    throw new Error(`"${cidr}" is not a valid CIDR block: the prefix must be between 0 and ${width} for IPv${address.family}`);
  }

  const mask = prefixLength === 0 ? 0n : ((1n << BigInt(prefixLength)) - 1n) << BigInt(width - prefixLength);
  return { cidr: trimmed, network: address.value & mask, prefixLength, family: address.family };
}

export function parseSubnets(cidrs: ReadonlyArray<string>): ReadonlyArray<Subnet> {
  return cidrs.map(parseSubnet);
}

function contains(subnet: Subnet, address: Address): boolean {
  if (subnet.family !== address.family) {
    return false;
  }
  const width = WIDTH[address.family];
  const mask = subnet.prefixLength === 0 ? 0n : ((1n << BigInt(subnet.prefixLength)) - 1n) << BigInt(width - subnet.prefixLength);
  return (address.value & mask) === subnet.network;
}

/**
 * Whether `raw` falls inside any of `subnets`.
 *
 * Fails closed on everything it cannot make sense of — an absent address, a hostname,
 * a malformed literal — because the caller's next move on `false` is to refuse the
 * connection, and "I could not tell" is not a reason to admit one.
 */
export function isTrustedAddress(raw: string | undefined, subnets: ReadonlyArray<Subnet>): boolean {
  if (typeof raw !== 'string' || subnets.length === 0) {
    return false;
  }
  const address = parseAddress(raw);
  if (address === undefined) {
    return false;
  }
  return subnets.some((subnet) => contains(subnet, address));
}

/**
 * Names the address, the list it was matched against and the variable that holds it.
 *
 * A bare "Forbidden" here costs an hour: the request looks correct from the caller's
 * side, and nothing about it says the objection was to where it came from.
 */
export function describeUntrustedAddress(address: string | undefined, subnets: ReadonlyArray<Subnet>): string {
  const source = address === undefined ? 'This connection' : `The address ${address}`;
  const allowed = subnets.map((subnet) => subnet.cidr).join(', ');
  return (
    `${source} is not inside the internal listener's trusted subnets [${allowed}]. ` +
    'Add its network to MINI_CLOUD_TRUSTED_SUBNETS, or set that variable to an empty value to accept any address.'
  );
}
