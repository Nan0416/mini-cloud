import {
  ConflictError,
  CreateMonitorRequest,
  CreateMonitorResponse,
  DeleteMonitorRequest,
  DeleteMonitorResponse,
  GetMonitorRequest,
  GetMonitorResponse,
  ListMonitorHistoryRequest,
  ListMonitorHistoryResponse,
  ListMonitorsRequest,
  ListMonitorsResponse,
  LoggerFactory,
  MONITOR_HISTORY_PAGE_SIZE,
  NotFoundError,
  UpdateMonitorRequest,
  UpdateMonitorResponse,
} from '@mini-cloud/shared';
import { MonitorDao } from '../data/monitor-dao';

const logger = LoggerFactory.getLogger('MonitorService');

export interface MonitorServiceProps {
  readonly monitorDao: MonitorDao;
}

/** Monitor definitions, and the state history the evaluator writes. */
export class MonitorService {
  private readonly monitorDao: MonitorDao;

  constructor(props: MonitorServiceProps) {
    this.monitorDao = props.monitorDao;
  }

  async listMonitors(_request: ListMonitorsRequest = {}): Promise<ListMonitorsResponse> {
    const { monitors } = await this.monitorDao.listMonitors({});
    return { monitors };
  }

  async getMonitor(request: GetMonitorRequest): Promise<GetMonitorResponse> {
    const { monitor } = await this.monitorDao.getMonitor({ name: request.name });
    if (monitor === undefined) {
      throw new NotFoundError(`Monitor "${request.name}" does not exist. List monitors to see the names there are.`);
    }
    return { monitor };
  }

  async createMonitor(request: CreateMonitorRequest): Promise<CreateMonitorResponse> {
    const { monitor } = await this.monitorDao.createMonitor({ ...request, stateReason: 'Not evaluated yet; the first evaluation is within a minute.' });
    if (monitor === undefined) {
      throw new ConflictError(`Monitor "${request.name}" already exists. Edit it instead, or choose another name.`);
    }
    logger.info(`Created monitor "${monitor.name}" on ${monitor.metric.namespace}/${monitor.metric.metricName}.`);
    return { monitor };
  }

  async updateMonitor(request: UpdateMonitorRequest): Promise<UpdateMonitorResponse> {
    const { monitor } = await this.monitorDao.updateMonitor(request);
    if (monitor !== undefined) {
      logger.info(`Saved monitor "${monitor.name}" as version ${monitor.version}.`);
      return { monitor };
    }

    // Nothing written: either there is no such monitor or someone saved it first.
    const { monitor: current } = await this.monitorDao.getMonitor({ name: request.name });
    if (current === undefined) {
      throw new NotFoundError(`Monitor "${request.name}" does not exist; it may have been deleted. Create it again to keep this definition.`);
    }
    throw new ConflictError(
      `Monitor "${request.name}" was saved elsewhere since version ${request.version}; it is at version ${current.version} now. Reload it and make the edit again.`,
    );
  }

  async deleteMonitor(request: DeleteMonitorRequest): Promise<DeleteMonitorResponse> {
    const { deleted } = await this.monitorDao.deleteMonitor({ name: request.name });
    if (!deleted) {
      throw new NotFoundError(`Monitor "${request.name}" does not exist, so there is nothing to delete.`);
    }
    logger.info(`Deleted monitor "${request.name}".`);
    return {};
  }

  async listMonitorHistory(request: ListMonitorHistoryRequest): Promise<ListMonitorHistoryResponse> {
    // Asked first, so a monitor that does not exist is a 404 rather than an empty history.
    await this.getMonitor({ name: request.name });
    const { changes } = await this.monitorDao.listStateChanges({ name: request.name, limit: request.limit ?? MONITOR_HISTORY_PAGE_SIZE.default });
    return { changes };
  }
}
