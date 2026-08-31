import { getenv, getenvBoolean, getenvInteger, getenvList, getenvOneOf } from '../../src/utils/env';

const NAME = 'MINI_CLOUD_TEST_ENV_FIXTURE';

/**
 * Every reader shares one rule that is easy to get wrong: a variable set to the empty
 * string means unset. `FOO=` in a shell, a docker-compose entry with nothing after
 * the colon and an unsubstituted CI variable all produce it, and treating it as a
 * value means the fallback silently stops applying.
 */
describe('environment readers', () => {
  afterEach(() => {
    delete process.env[NAME];
  });

  describe('getenv', () => {
    it('reads the variable when it is set', () => {
      process.env[NAME] = 'from-env';

      expect(getenv(NAME, 'fallback')).toBe('from-env');
    });

    it('falls back when unset or blank', () => {
      expect(getenv(NAME, 'fallback')).toBe('fallback');
      process.env[NAME] = '';
      expect(getenv(NAME, 'fallback')).toBe('fallback');
    });

    it('accepts an empty-string fallback, which is how a feature is switched off', () => {
      // `consoleUrl: ''` is the documented way to stop printing the console link, so
      // an empty fallback has to be honoured rather than treated as "no fallback".
      expect(getenv(NAME, '')).toBe('');
    });

    it('throws when there is no value and no fallback', () => {
      // A required variable missing is a startup failure, not a runtime surprise.
      expect(() => getenv(NAME)).toThrow(`Required environment variable ${NAME} is not set`);
    });

    it('does not trim, because a value may legitimately contain spaces', () => {
      process.env[NAME] = '  spaced  ';

      expect(getenv(NAME, 'fallback')).toBe('  spaced  ');
    });
  });

  describe('getenvInteger', () => {
    it('parses a whole number, including a negative one', () => {
      process.env[NAME] = '3000';
      expect(getenvInteger(NAME, 1)).toBe(3000);
      process.env[NAME] = '-1';
      expect(getenvInteger(NAME, 1)).toBe(-1);
    });

    it('falls back when unset or blank', () => {
      expect(getenvInteger(NAME, 3000)).toBe(3000);
      process.env[NAME] = '';
      expect(getenvInteger(NAME, 3000)).toBe(3000);
    });

    it('fails at startup rather than running with a nonsense value', () => {
      // A port of NaN binds to a random one, which is far harder to diagnose later.
      process.env[NAME] = 'abc';
      expect(() => getenvInteger(NAME, 3000)).toThrow(`Environment variable ${NAME} must be an integer, got "abc"`);
      process.env[NAME] = '3000.5';
      expect(() => getenvInteger(NAME, 3000)).toThrow(/must be an integer/);
    });
  });

  describe('getenvBoolean', () => {
    it('accepts either word or either digit, in any case', () => {
      for (const raw of ['true', 'TRUE', 'True', '1']) {
        process.env[NAME] = raw;
        expect(getenvBoolean(NAME, false)).toBe(true);
      }
      for (const raw of ['false', 'FALSE', '0']) {
        process.env[NAME] = raw;
        expect(getenvBoolean(NAME, true)).toBe(false);
      }
    });

    it('falls back when unset or blank', () => {
      expect(getenvBoolean(NAME, true)).toBe(true);
      process.env[NAME] = '';
      expect(getenvBoolean(NAME, true)).toBe(true);
    });

    it('rejects anything else rather than treating it as truthy', () => {
      // Every non-empty string is truthy, so `FEATURE=no` would silently enable it.
      process.env[NAME] = 'no';
      expect(() => getenvBoolean(NAME, false)).toThrow(`Environment variable ${NAME} must be a boolean, got "no"`);
    });
  });

  describe('getenvOneOf', () => {
    const levels = ['debug', 'info', 'warn', 'error'] as const;

    it('returns the matching member', () => {
      process.env[NAME] = 'warn';

      expect(getenvOneOf(NAME, levels, 'info')).toBe('warn');
    });

    it('falls back when unset or blank', () => {
      expect(getenvOneOf(NAME, levels, 'info')).toBe('info');
      process.env[NAME] = '';
      expect(getenvOneOf(NAME, levels, 'info')).toBe('info');
    });

    it('lists the alternatives when the value is not one of them', () => {
      process.env[NAME] = 'verbose';

      expect(() => getenvOneOf(NAME, levels, 'info')).toThrow(`Environment variable ${NAME} must be one of [debug, info, warn, error], got "verbose"`);
    });

    it('is case-sensitive', () => {
      process.env[NAME] = 'WARN';

      expect(() => getenvOneOf(NAME, levels, 'info')).toThrow(/must be one of/);
    });
  });

  describe('getenvList', () => {
    it('splits on commas and trims each entry', () => {
      process.env[NAME] = 'https://a.example.com, https://b.example.com';

      expect(getenvList(NAME)).toEqual(['https://a.example.com', 'https://b.example.com']);
    });

    it('drops blank entries, so a trailing comma is just a typo', () => {
      process.env[NAME] = 'a,,b, ,c,';

      expect(getenvList(NAME)).toEqual(['a', 'b', 'c']);
    });

    it('falls back when unset, and defaults that fallback to empty', () => {
      expect(getenvList(NAME)).toEqual([]);
      expect(getenvList(NAME, ['*'])).toEqual(['*']);
    });

    it('yields an empty list for a value that is all separators', () => {
      // Distinct from unset: the operator did set it, and setting it to nothing is a
      // meaningful way to say "allow none" rather than "use the default".
      process.env[NAME] = ',, ,';

      expect(getenvList(NAME, ['*'])).toEqual([]);
    });

    it('treats a blank value as unset, so the fallback still applies', () => {
      process.env[NAME] = '';

      expect(getenvList(NAME, ['*'])).toEqual(['*']);
    });
  });
});
