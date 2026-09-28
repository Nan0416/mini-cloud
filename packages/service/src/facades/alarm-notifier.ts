import { LoggerFactory, Monitor, MonitorStateChange } from '@mini-cloud/shared';

const logger = LoggerFactory.getLogger('LoggingAlarmNotifier');

/** A monitor that changed state, and the change: everything a message about it needs. */
export interface AlarmNotification {
  readonly monitor: Monitor;
  readonly change: MonitorStateChange;
}

/**
 * Where a change of state is sent. Discord, email and the rest each implement this.
 *
 * Called after the change is committed, and at most once per change. A rejection is
 * logged by the caller and not retried, so an implementation that must not lose a
 * message has to hold on to it itself.
 */
export interface AlarmNotifier {
  notify(notification: AlarmNotification): Promise<void>;
}

/** The only notifier for now: the change goes to the service's log. */
export class LoggingAlarmNotifier implements AlarmNotifier {
  async notify({ monitor, change }: AlarmNotification): Promise<void> {
    const line = `Monitor "${monitor.name}" is ${change.toState} (was ${change.fromState}): ${change.reason}`;
    if (change.toState === 'ALARM') {
      logger.warn(line);
    } else {
      logger.info(line);
    }
  }
}
