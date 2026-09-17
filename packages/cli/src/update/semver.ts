/**
 * Just enough semver for `cli-v*` tags: `MAJOR.MINOR.PATCH` with an optional
 * `-prerelease`. Not named `version.ts`: the binary build swaps any module by that name
 * for the generated one holding the stamped version.
 */
interface ParsedVersion {
  readonly core: ReadonlyArray<number>;
  readonly prerelease: ReadonlyArray<string>;
}

export function parseVersion(value: string): ParsedVersion | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim());
  if (match === null) {
    return undefined;
  }
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] === undefined ? [] : match[4].split('.') };
}

function compareIdentifiers(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) {
    return Number(a) - Number(b);
  }
  if (aNumeric !== bNumeric) {
    return aNumeric ? -1 : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Negative when `a` is older. Anything unparseable sorts below every real version, so
 * a garbled manifest never reads as an update.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === undefined || pb === undefined) {
    return (pa === undefined ? 0 : 1) - (pb === undefined ? 0 : 1);
  }
  for (let i = 0; i < 3; i++) {
    const difference = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  // A release outranks its own prereleases.
  const aIsRelease = pa.prerelease.length === 0;
  const bIsRelease = pb.prerelease.length === 0;
  if (aIsRelease || bIsRelease) {
    return Number(aIsRelease) - Number(bIsRelease);
  }
  for (let i = 0; i < Math.min(pa.prerelease.length, pb.prerelease.length); i++) {
    const difference = compareIdentifiers(pa.prerelease[i] ?? '', pb.prerelease[i] ?? '');
    if (difference !== 0) {
      return difference;
    }
  }
  return pa.prerelease.length - pb.prerelease.length;
}
