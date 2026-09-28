import {
  CreateDashboardResponse,
  DeleteDashboardResponse,
  GetDashboardResponse,
  ListDashboardsResponse,
  LoggerFactory,
  UpdateDashboardResponse,
  assertRecord,
} from '@mini-cloud/shared';
import { Router } from 'express';
import type { Express } from 'express';
import { DashboardService } from '../services/dashboard-service';
import { parseCreateDashboardRequest, parseUpdateDashboardRequest } from '../utils/request-parsing';
import { Endpoints } from './endpoints';

const logger = LoggerFactory.getLogger('DashboardEndpoints');

export interface DashboardEndpointsProps {
  readonly dashboardService: DashboardService;
}

export class DashboardEndpoints implements Endpoints {
  private readonly router: Router;

  constructor(props: DashboardEndpointsProps) {
    const { dashboardService } = props;
    this.router = Router();

    this.router.get('/dashboards', async (_req, res) => {
      const response: ListDashboardsResponse = await dashboardService.listDashboards({});
      res.status(200).json(response);
    });

    this.router.post('/dashboards', async (req, res) => {
      const request = parseCreateDashboardRequest(req.body);
      logger.info(`Create dashboard "${request.name}".`);
      const response: CreateDashboardResponse = await dashboardService.createDashboard(request);
      res.status(201).json(response);
    });

    this.router.get('/dashboards/:name', async (req, res) => {
      const response: GetDashboardResponse = await dashboardService.getDashboard({ name: req.params.name });
      res.status(200).json(response);
    });

    this.router.put('/dashboards/:name', async (req, res) => {
      const request = parseUpdateDashboardRequest({ ...assertRecord(req.body, 'body'), name: req.params.name });
      logger.info(`Update dashboard "${request.name}" from version ${request.version}.`);
      const response: UpdateDashboardResponse = await dashboardService.updateDashboard(request);
      res.status(200).json(response);
    });

    this.router.delete('/dashboards/:name', async (req, res) => {
      logger.info(`Delete dashboard "${req.params.name}".`);
      const response: DeleteDashboardResponse = await dashboardService.deleteDashboard({ name: req.params.name });
      res.status(200).json(response);
    });
  }

  bind(app: Express): void {
    app.use(this.router);
  }
}
