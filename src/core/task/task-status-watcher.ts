import { TaskInstanceStatus } from '@ultrasa/mini-cloud-models';

interface TaskStatusTimestamp {
  instanceId: string;
  status: TaskInstanceStatus;
  referenceTime: number;
}

interface Timeout {
  instanceId: string;
  timeout: 'start_timeout' | 'launching_timeout';
}

interface TaskStatusWatcherConfig {
  // from the time when the task is initiated by task service to the time status changed.
  readonly launchingTimeout: number;
  // form the time when the task is launched by task agent to the time status changed.
  readonly startTimeout: number;
}

const WATCH_LIST: ReadonlyArray<TaskInstanceStatus> = ['initiated', 'launched'];

export class TaskStatusWatcher {
  private statusList: TaskStatusTimestamp[];
  private readonly config: TaskStatusWatcherConfig;
  constructor(config: TaskStatusWatcherConfig) {
    this.statusList = [];
    this.config = config;
  }

  watch(instanceId: string, status: TaskInstanceStatus, referenceTime: number) {
    const item = this.statusList.find((item) => item.instanceId === instanceId);
    if (item !== undefined) {
      item.status = status;
      item.referenceTime = referenceTime;
    } else {
      this.statusList.push({
        instanceId,
        status,
        referenceTime,
      });
    }
  }

  /**
   * If a task instance stays at "initiated" for more than the "launchingTimeout", then we assume there is something wrong between the task service and task agent, then the task
   * service sets the ask instance status to "launching_timeout".
   *
   * If a task instance stays at "launched" for more than the "startTimeout", then we assume there is something wrong between task agent and the task instance, such as wrong working
   * directory, then the task service sets the task instance status to "start_timeout"
   * @param referenceTime
   * @returns
   */
  listTimeouts(referenceTime: number): Timeout[] {
    const timeouts: Timeout[] = [];
    // only check the status in the WATCH_LIST.
    this.statusList = this.statusList.filter((item) => WATCH_LIST.includes(item.status));

    for (let i = 0; i < this.statusList.length; i++) {
      if (this.statusList[i].status === 'initiated' && referenceTime - this.statusList[i].referenceTime > this.config.launchingTimeout) {
        timeouts.push({
          instanceId: this.statusList[i].instanceId,
          timeout: 'launching_timeout', // initiated but task agent didn't report launched status
        });
      } else if (this.statusList[i].status === 'launched' && referenceTime - this.statusList[i].referenceTime > this.config.startTimeout) {
        timeouts.push({
          instanceId: this.statusList[i].instanceId,
          timeout: 'start_timeout', // launched but task instance didn't report running status
        });
      }
    }
    return timeouts;
  }
}
