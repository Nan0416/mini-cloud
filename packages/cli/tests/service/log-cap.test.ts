import {
  closeSync,
  existsSync,
  fstatSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MAX_LOG_BYTES, capLogFile, isDaemonLog, startLogCap } from '../../src/service/log-cap';
import { DaemonUnit } from '../../src/service/types';
import { AGENT_UNIT } from '../../src/service/units';

describe('log cap', () => {
  let dir: string;
  let logPath: string;
  let fd: number;
  const opened: number[] = [];

  /** `a` is O_APPEND, which is how launchd opens StandardOutPath. */
  const openLog = (file: string): number => {
    const handle = openSync(file, 'a');
    opened.push(handle);
    return handle;
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mini-cloud-log-cap-'));
    logPath = path.join(dir, 'agent.log');
    fd = openLog(logPath);
  });

  afterEach(() => {
    opened.splice(0).forEach((handle) => closeSync(handle));
    rmSync(dir, { recursive: true, force: true });
  });

  describe('capLogFile', () => {
    it('leaves a log at or under the cap alone', () => {
      writeSync(fd, 'a'.repeat(100));

      expect(capLogFile(fd, logPath, 100)).toBe(false);
      expect(readFileSync(logPath, 'utf8')).toBe('a'.repeat(100));
      expect(existsSync(`${logPath}.1`)).toBe(false);
    });

    it('copies a log past the cap to .1 and empties it, so nothing written is lost', () => {
      writeSync(fd, 'a'.repeat(150));

      expect(capLogFile(fd, logPath, 100)).toBe(true);
      expect(readFileSync(`${logPath}.1`, 'utf8')).toBe('a'.repeat(150));
      expect(fstatSync(fd).size).toBe(0);
    });

    it('lands the next write at the start, not past a hole where the old content was', () => {
      writeSync(fd, 'a'.repeat(150));
      capLogFile(fd, logPath, 100);

      writeSync(fd, 'next\n');

      expect(readFileSync(logPath, 'utf8')).toBe('next\n');
    });

    it('lands stderr at the start too, though launchd opens it separately from stdout', () => {
      const stderr = openLog(logPath);
      writeSync(fd, 'a'.repeat(150));
      capLogFile(fd, logPath, 100);

      writeSync(stderr, 'warn\n');

      expect(readFileSync(logPath, 'utf8')).toBe('warn\n');
    });

    it('leaves the previous copy whole, and the log untouched, when a copy fails', () => {
      writeSync(fd, 'a'.repeat(150));
      capLogFile(fd, logPath, 100);
      writeSync(fd, 'b'.repeat(150));
      // A directory in the way makes the copy fail, as a full disk would.
      mkdirSync(`${logPath}.1.tmp`);

      expect(() => capLogFile(fd, logPath, 100)).toThrow();
      expect(readFileSync(`${logPath}.1`, 'utf8')).toBe('a'.repeat(150));
      expect(readFileSync(logPath, 'utf8')).toBe('b'.repeat(150));
    });

    it('keeps only one earlier copy, replacing it each time', () => {
      writeSync(fd, 'a'.repeat(150));
      capLogFile(fd, logPath, 100);
      writeSync(fd, 'b'.repeat(150));
      capLogFile(fd, logPath, 100);

      expect(readFileSync(`${logPath}.1`, 'utf8')).toBe('b'.repeat(150));
      expect(readdirSync(dir).sort()).toEqual(['agent.log', 'agent.log.1']);
    });
  });

  describe('isDaemonLog', () => {
    it('recognises the file opened at the log path', () => {
      expect(isDaemonLog(fd, logPath)).toBe(true);
    });

    it('refuses output redirected to any other file, which is not the daemon’s to truncate', () => {
      const elsewhere = openLog(path.join(dir, 'elsewhere.log'));

      expect(isDaemonLog(elsewhere, logPath)).toBe(false);
    });

    it('refuses when nothing is at the log path, as under systemd', () => {
      expect(isDaemonLog(fd, path.join(dir, 'missing.log'))).toBe(false);
    });

    it('refuses anything that is not a regular file, such as journald’s socket', () => {
      const devNull = openLog('/dev/null');

      expect(isDaemonLog(devNull, '/dev/null')).toBe(false);
    });
  });

  describe('startLogCap', () => {
    const unit = (): DaemonUnit => ({ ...AGENT_UNIT, logPath });
    /** Sparse, so a test reaches the real cap without writing ten megabytes. */
    const growPastCap = (handle: number): void => ftruncateSync(handle, MAX_LOG_BYTES + 1);

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('caps a log that is already too big when the daemon starts, not a minute later', () => {
      growPastCap(fd);

      startLogCap(unit(), fd);

      expect(fstatSync(fd).size).toBe(0);
      expect(existsSync(`${logPath}.1`)).toBe(true);
    });

    it('caps the log again each time it grows back while the daemon runs', () => {
      startLogCap(unit(), fd);
      growPastCap(fd);

      jest.advanceTimersByTime(60_000);

      expect(fstatSync(fd).size).toBe(0);
    });

    it('never touches output that is not the daemon log', () => {
      const elsewherePath = path.join(dir, 'elsewhere.log');
      const elsewhere = openLog(elsewherePath);
      growPastCap(elsewhere);

      startLogCap(unit(), elsewhere);
      jest.advanceTimersByTime(60_000);

      expect(fstatSync(elsewhere).size).toBe(MAX_LOG_BYTES + 1);
      expect(existsSync(`${elsewherePath}.1`)).toBe(false);
    });

    it('leaves the log alone while capping fails, and caps it once it can', () => {
      mkdirSync(`${logPath}.1.tmp`);
      growPastCap(fd);

      startLogCap(unit(), fd);
      jest.advanceTimersByTime(3 * 60_000);

      expect(fstatSync(fd).size).toBe(MAX_LOG_BYTES + 1);

      rmdirSync(`${logPath}.1.tmp`);
      jest.advanceTimersByTime(60_000);

      expect(fstatSync(fd).size).toBe(0);
    });

    it('stops when the log is moved away, rather than copy whatever replaced it over the last good copy', () => {
      startLogCap(unit(), fd);
      renameSync(logPath, path.join(dir, 'agent.old'));
      writeFileSync(logPath, 'unrelated\n');
      growPastCap(fd);

      jest.advanceTimersByTime(60_000);

      expect(fstatSync(fd).size).toBe(MAX_LOG_BYTES + 1);
      expect(readFileSync(logPath, 'utf8')).toBe('unrelated\n');
      expect(existsSync(`${logPath}.1`)).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
