import { compareVersions, parseVersion } from '../../src/update/semver';

describe('compareVersions', () => {
  const ascending = [
    '0.0.0-dev',
    '0.9.9',
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-alpha.beta',
    '1.0.0-beta.2',
    '1.0.0-beta.11',
    '1.0.0-rc.1',
    '1.0.0',
    '1.0.1',
    '1.2.0',
    '1.10.0',
    '2.0.0',
  ];

  it('orders releases and prereleases as semver does', () => {
    const reversed = [...ascending].reverse();

    expect(reversed.sort(compareVersions)).toEqual(ascending);
  });

  it('treats a leading v as the same version', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
  });

  it('never ranks something unparseable above a real version', () => {
    expect(compareVersions('latest', '0.0.1')).toBeLessThan(0);
    expect(compareVersions('0.0.1', '1.2')).toBeGreaterThan(0);
  });
});

describe('parseVersion', () => {
  it.each(['1.2', '1.2.3.4', '01.2.3x', '', '1.2.3-'])('rejects %p', (value) => {
    expect(parseVersion(value)).toBeUndefined();
  });
});
