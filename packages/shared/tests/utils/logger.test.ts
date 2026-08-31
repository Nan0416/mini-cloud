import { LoggerFactory } from '../../src/utils/logger';

/**
 * The level is process-wide state, so every test here restores it. Without that, one
 * test lowering the level to `debug` would leak into the rest of the file.
 */
describe('LoggerFactory', () => {
  const original = LoggerFactory.level;
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    LoggerFactory.setLevel('debug');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    LoggerFactory.setLevel(original);
  });

  it('hands back the same logger for a name, rather than one per call site', () => {
    // Callers hold these in module scope; minting a new object per lookup would make
    // the cache pointless and quietly grow forever.
    expect(LoggerFactory.getLogger('Scheduler')).toBe(LoggerFactory.getLogger('Scheduler'));
    expect(LoggerFactory.getLogger('Scheduler')).not.toBe(LoggerFactory.getLogger('Hub'));
  });

  it('tags every line with the logger name, which is what makes the output greppable', () => {
    LoggerFactory.getLogger('Scheduler').info('tick');

    // The service, hub and scheduler all write to one stream at once.
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[Scheduler] tick'));
  });

  it('writes the level and an ISO timestamp', () => {
    LoggerFactory.getLogger('Scheduler').info('tick');

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z INFO {2}\[Scheduler] tick$/));
  });

  it('sends warnings and errors to their own streams', () => {
    const logger = LoggerFactory.getLogger('Hub');

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    // stderr for the two that matter, so `2>` still captures the problems.
    expect(log).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('drops anything below the current level', () => {
    LoggerFactory.setLevel('warn');
    const logger = LoggerFactory.getLogger('Hub');

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(log).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('applies a level change to loggers that already exist', () => {
    // They are cached, so a logger created before the change must not keep the old
    // level baked in.
    const logger = LoggerFactory.getLogger('Hub');
    LoggerFactory.setLevel('error');

    logger.warn('w');

    expect(warn).not.toHaveBeenCalled();
  });

  describe('metadata', () => {
    it('appends a stack for an Error, because the message alone loses the origin', () => {
      LoggerFactory.getLogger('Hub').error('failed', new Error('boom'));

      const line = error.mock.calls[0]?.[0] as string;
      expect(line).toContain('failed');
      expect(line).toContain('Error: boom');
      expect(line).toContain('logger.test.ts');
    });

    it('falls back to name and message for an Error carrying no stack', () => {
      const stackless = new Error('boom');
      stackless.stack = undefined;

      LoggerFactory.getLogger('Hub').error('failed', stackless);

      expect(error).toHaveBeenCalledWith(expect.stringContaining('Error: boom'));
    });

    it('appends a string as-is, without quoting it', () => {
      LoggerFactory.getLogger('Hub').info('sent', 'to agent mac-mini');

      expect(log).toHaveBeenCalledWith(expect.stringContaining('sent to agent mac-mini'));
    });

    it('serialises anything else as JSON', () => {
      LoggerFactory.getLogger('Hub').info('sent', { agentId: 'mac-mini', count: 2 });

      expect(log).toHaveBeenCalledWith(expect.stringContaining('{"agentId":"mac-mini","count":2}'));
    });

    it('says so rather than throwing when the metadata cannot be serialised', () => {
      const cyclic: Record<string, unknown> = {};
      cyclic['self'] = cyclic;

      // A logger that can crash the thing it is logging about is worse than no logger.
      expect(() => LoggerFactory.getLogger('Hub').info('sent', cyclic)).not.toThrow();
      expect(log).toHaveBeenCalledWith(expect.stringContaining('[unserializable meta]'));
    });

    it('adds nothing at all when there is no metadata', () => {
      LoggerFactory.getLogger('Hub').info('tick');

      expect(log).toHaveBeenCalledWith(expect.stringMatching(/\[Hub] tick$/));
    });
  });
});
