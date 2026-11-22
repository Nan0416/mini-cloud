import { LoggerFactory } from '@mini-cloud/shared';
import { copyFileSync, fstatSync, ftruncateSync, statSync } from 'node:fs';
import { DaemonUnit } from './types';

const logger = LoggerFactory.getLogger('LogCap');

/** Disk use stays under twice this: the live log plus one earlier copy. */
export const MAX_LOG_BYTES = 10 * 1024 * 1024;
const CHECK_INTERVAL_MS = 60_000;

/**
 * Whether `fd` is the file at `logPath`. Only then is it this process's to truncate:
 * under systemd, in a terminal, or redirected anywhere else, it is someone else's.
 */
export function isDaemonLog(fd: number, logPath: string): boolean {
  try {
    const stream = fstatSync(fd);
    const log = statSync(logPath);
    return stream.isFile() && stream.dev === log.dev && stream.ino === log.ino;
  } catch {
    return false;
  }
}

/**
 * Past `maxBytes`, copies the log to `<logPath>.1` and empties it in place: logrotate's
 * `copytruncate`. launchd holds the file open as stdout and stderr, so a rename would
 * leave the daemon writing into the copy; it opens with O_APPEND, so the next write lands
 * at the start. No line falls between the copy and the truncate, because a file stdout is
 * written synchronously, on this same thread.
 */
export function capLogFile(fd: number, logPath: string, maxBytes: number): boolean {
  if (fstatSync(fd).size <= maxBytes) {
    return false;
  }
  copyFileSync(logPath, `${logPath}.1`);
  ftruncateSync(fd, 0);
  return true;
}

/** Keeps the unit's launchd log under {@link MAX_LOG_BYTES} for as long as this process runs. */
export function startLogCap(unit: DaemonUnit, fd = 1): void {
  if (!isDaemonLog(fd, unit.logPath)) {
    return;
  }
  const check = (): void => {
    try {
      if (capLogFile(fd, unit.logPath, MAX_LOG_BYTES)) {
        logger.info(`The log passed ${MAX_LOG_BYTES / (1024 * 1024)} MB; what came before is in ${unit.logPath}.1.`);
      }
    } catch (err) {
      logger.warn(`Could not cap ${unit.logPath}; trying again in a minute.`, err);
    }
  };
  check();
  setInterval(check, CHECK_INTERVAL_MS).unref();
}
