import {
  CreateMonitorResponse,
  DeleteMonitorResponse,
  GetMonitorResponse,
  ListMonitorHistoryResponse,
  ListMonitorsResponse,
  LoggerFactory,
  UpdateMonitorResponse,
  assertRecord,
} from '@mini-cloud/shared';
import { Router } from 'express';
import type { Express } from 'express';
import { MonitorService } from '../services/monitor-service';
import { parseCreateMonitorRequest, parseListMonitorHistoryRequest, parseUpdateMonitorRequest } from '../utils/request-parsing';
import { Endpoints } from './endpoints';

const logger = LoggerFactory.getLogger('MonitorEndpoints');

export interface MonitorEndpointsProps {
  readonly monitorService: MonitorService;
}

export class MonitorEndpoints implements Endpoints {
  private readonly router: Router;

  constructor(props: MonitorEndpointsProps) {
    const { monitorService } = props;
    this.router = Router();

    this.router.get('/monitors', async (_req, res) => {
      const response: ListMonitorsResponse = await monitorService.listMonitors({});
      res.status(200).json(response);
    });

    this.router.post('/monitors', async (req, res) => {
      const request = parseCreateMonitorRequest(req.body);
      logger.info(`Create monitor "${request.name}".`);
      const response: CreateMonitorResponse = await monitorService.createMonitor(request);
      res.status(201).json(response);
    });

    this.router.get('/monitors/:name', async (req, res) => {
      const response: GetMonitorResponse = await monitorService.getMonitor({ name: req.params.name });
      res.status(200).json(response);
    });

    this.router.put('/monitors/:name', async (req, res) => {
      const request = parseUpdateMonitorRequest({ ...assertRecord(req.body, 'body'), name: req.params.name });
      logger.info(`Update monitor "${request.name}" from version ${request.version}.`);
      const response: UpdateMonitorResponse = await monitorService.updateMonitor(request);
      res.status(200).json(response);
    });

    this.router.delete('/monitors/:name', async (req, res) => {
      logger.info(`Delete monitor "${req.params.name}".`);
      const response: DeleteMonitorResponse = await monitorService.deleteMonitor({ name: req.params.name });
      res.status(200).json(response);
    });

    this.router.get('/monitors/:name/history', async (req, res) => {
      const request = parseListMonitorHistoryRequest({ ...assertRecord(req.query, 'query'), name: req.params.name });
      const response: ListMonitorHistoryResponse = await monitorService.listMonitorHistory(request);
      res.status(200).json(response);
    });
  }

  bind(app: Express): void {
    app.use(this.router);
  }
}
