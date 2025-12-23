import moment from 'moment-timezone';

const HHmmss_Regex = /^([01]{1}\d|2[0-3]):([0-5]{1}\d):([0-5]{1}\d)$/;

const MS_IN_A_DAY = 86400000; // 24 * 3600_000
export class Clock {
  readonly timezone: string;

  constructor(timezone: string) {
    this.timezone = timezone;
  }

  time(timestamp?: number): string {
    return moment(typeof timestamp === 'number' ? new Date(timestamp) : new Date())
      .tz(this.timezone)
      .format('HH:mm:ss');
  }

  date(timestamp?: number): string {
    return moment(typeof timestamp === 'number' ? new Date(timestamp) : new Date())
      .tz(this.timezone)
      .format('YYYY-MM-DD');
  }

  datetime(timestamp?: number): string {
    return moment(typeof timestamp === 'number' ? new Date(timestamp) : new Date())
      .tz(this.timezone)
      .format('YYYY-MM-DDTHH:mm:ssZ');
  }

  timestamp(date: string, time?: string): number {
    if (typeof time === 'string') {
      if (time.match(HHmmss_Regex) === null) {
        throw new Error(`invalid time input ${time}, must follow format HH:mm:ss`);
      }
      return moment.tz(`${date} ${time}`, this.timezone).toDate().getTime();
    } else {
      return moment.tz(date, this.timezone).toDate().getTime();
    }
  }

  /**
   * The Unix epoch second doesn't count leap seconds.
   *
   * An OS needs to listen to a NTP server for time synchronization. The synchronization process will adjust
   * the system time, therefore, the unix epoch second.
   *
   * It also implies the unix epoch second will "pause" for a second at the leap second.
   *
   * @param date
   * @returns
   */
  nextDate(date?: string, days?: number): string {
    const _date = date ?? this.date();
    const _days = days ?? 1;
    return this.date(this.timestamp(_date, '00:00:00') + MS_IN_A_DAY * _days);
  }
}
