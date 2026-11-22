import { LoggerFactory } from '@mini-cloud/shared';
import { copyFileSync, fstatSync, ftruncateSync, renameSync, statSync } from 'node:fs';
import { DaemonUnit } from './types';

const logger = LoggerFactory.getLogger('LogCap');

/** Checked once a minute, so the live log can pass it by a minute's output. */
export const MAX_LOG_BYTES = 10 * 1024 * 1024;
const CHECK_INTERVAL_MS = 60_000;

/**
 * Whether `fd` is the regular file at `logPath`. Only then is it this process's to
 * truncate: under systemd, in a terminal, or redirected anywhere else, it is not.
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
 * `copytruncate`. The daemon inherits the file as stdout and stderr and cannot reopen it,
 * but launchd opened it O_APPEND, so the next write lands at the start.
 */
export function capLogFile(fd: number, logPath: string, maxBytes: number): boolean {
  if (fstatSync(fd).size <= maxBytes) {
    return false;
  }
  // Through a temporary name, so a copy that fails leaves the previous one whole.
  const copy = `${logPath}.1`;
  copyFileSync(logPath, `${copy}.tmp`);
  renameSync(`${copy}.tmp`, copy);
  ftruncateSync(fd, 0);
  return true;
}

/** Keeps the unit's launchd log under {@link MAX_LOG_BYTES} for as long as this process runs. */
export function startLogCap(unit: DaemonUnit, fd = 1): void {
  if (!isDaemonLog(fd, unit.logPath)) {
    logger.debug(`Output is not going to ${unit.logPath}, so it is not capped.`);
    return;
  }
  let failing = false;
  const check = (): void => {
    // Moved or deleted by hand: whatever is at the path now is not ours to copy over the last good copy.
    if (!isDaemonLog(fd, unit.logPath)) {
      logger.warn(`${unit.logPath} was moved or deleted, so this log is no longer capped. \`${unit.command} restart\` starts a new one.`);
      clearInterval(timer);
      return;
    }
    try {
      if (capLogFile(fd, unit.logPath, MAX_LOG_BYTES)) {
        logger.info(`The log passed ${MAX_LOG_BYTES / (1024 * 1024)} MB; what came before is in ${unit.logPath}.1.`);
      }
      failing = false;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // Once per run of failures: a warning a minute would grow the very log that cannot be capped.
      if (failing) {
        logger.debug(`Still cannot cap ${unit.logPath}: ${reason}`);
      } else {
        logger.warn(`Could not cap ${unit.logPath}, so it grows until this is fixed: ${reason}. Retrying each minute.`);
      }
      failing = true;
    }
  };
  const timer = setInterval(check, CHECK_INTERVAL_MS);
  timer.unref();
  check();
}
