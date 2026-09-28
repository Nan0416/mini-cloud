import {
  ConflictError,
  CreateDashboardRequest,
  CreateDashboardResponse,
  DeleteDashboardRequest,
  DeleteDashboardResponse,
  GetDashboardRequest,
  GetDashboardResponse,
  ListDashboardsRequest,
  ListDashboardsResponse,
  LoggerFactory,
  NotFoundError,
  UpdateDashboardRequest,
  UpdateDashboardResponse,
} from '@mini-cloud/shared';
import { DashboardDao } from '../data/dashboard-dao';

const logger = LoggerFactory.getLogger('DashboardService');

export interface DashboardServiceProps {
  readonly dashboardDao: DashboardDao;
}

/** Dashboards: stored graphs, read and written whole. */
export class DashboardService {
  private readonly dashboardDao: DashboardDao;

  constructor(props: DashboardServiceProps) {
    this.dashboardDao = props.dashboardDao;
  }

  async listDashboards(_request: ListDashboardsRequest = {}): Promise<ListDashboardsResponse> {
    const { dashboards } = await this.dashboardDao.listDashboards({});
    return { dashboards };
  }

  async getDashboard(request: GetDashboardRequest): Promise<GetDashboardResponse> {
    const { dashboard } = await this.dashboardDao.getDashboard({ name: request.name });
    if (dashboard === undefined) {
      throw new NotFoundError(`Dashboard "${request.name}" does not exist. List dashboards to see the names there are.`);
    }
    return { dashboard };
  }

  async createDashboard(request: CreateDashboardRequest): Promise<CreateDashboardResponse> {
    const { dashboard } = await this.dashboardDao.createDashboard(request);
    if (dashboard === undefined) {
      throw new ConflictError(`Dashboard "${request.name}" already exists. Add to it instead, or choose another name.`);
    }
    logger.info(`Created dashboard "${dashboard.name}" with ${dashboard.widgets.length} widget(s).`);
    return { dashboard };
  }

  async updateDashboard(request: UpdateDashboardRequest): Promise<UpdateDashboardResponse> {
    const { dashboard } = await this.dashboardDao.updateDashboard(request);
    if (dashboard !== undefined) {
      logger.info(`Saved dashboard "${dashboard.name}" as version ${dashboard.version}.`);
      return { dashboard };
    }

    // Nothing written: either there is no such dashboard or someone saved it first. Read
    // after the fact only to say which, since the write itself was already guarded.
    const { dashboard: current } = await this.dashboardDao.getDashboard({ name: request.name });
    if (current === undefined) {
      throw new NotFoundError(`Dashboard "${request.name}" does not exist; it may have been deleted. Create it again to keep these widgets.`);
    }
    throw new ConflictError(
      `Dashboard "${request.name}" was saved elsewhere since version ${request.version}; it is at version ${current.version} now. Reload it and make the edit again.`,
    );
  }

  async deleteDashboard(request: DeleteDashboardRequest): Promise<DeleteDashboardResponse> {
    const { deleted } = await this.dashboardDao.deleteDashboard({ name: request.name });
    if (!deleted) {
      throw new NotFoundError(`Dashboard "${request.name}" does not exist, so there is nothing to delete.`);
    }
    logger.info(`Deleted dashboard "${request.name}".`);
    return {};
  }
}
