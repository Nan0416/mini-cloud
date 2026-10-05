import {
  CreateNotifierResponse,
  DeleteNotifierResponse,
  GetNotifierResponse,
  ListNotifiersResponse,
  LoggerFactory,
  TestNotifierResponse,
  UpdateNotifierResponse,
  assertRecord,
} from '@mini-cloud/shared';
import { Router } from 'express';
import type { Express } from 'express';
import { NotifierService } from '../services/notifier-service';
import { parseCreateNotifierRequest, parseUpdateNotifierRequest } from '../utils/request-parsing';
import { Endpoints } from './endpoints';

const logger = LoggerFactory.getLogger('NotifierEndpoints');

export interface NotifierEndpointsProps {
  readonly notifierService: NotifierService;
}

export class NotifierEndpoints implements Endpoints {
  private readonly router: Router;

  constructor(props: NotifierEndpointsProps) {
    const { notifierService } = props;
    this.router = Router();

    this.router.get('/notifiers', async (_req, res) => {
      const response: ListNotifiersResponse = await notifierService.listNotifiers({});
      res.status(200).json(response);
    });

    this.router.post('/notifiers', async (req, res) => {
      const request = parseCreateNotifierRequest(req.body);
      logger.info(`Create ${request.target.type} notifier "${request.name}".`);
      const response: CreateNotifierResponse = await notifierService.createNotifier(request);
      res.status(201).json(response);
    });

    this.router.get('/notifiers/:notifierId', async (req, res) => {
      const response: GetNotifierResponse = await notifierService.getNotifier({ notifierId: req.params.notifierId });
      res.status(200).json(response);
    });

    this.router.put('/notifiers/:notifierId', async (req, res) => {
      const request = parseUpdateNotifierRequest({ ...assertRecord(req.body, 'body'), notifierId: req.params.notifierId });
      logger.info(`Update notifier ${request.notifierId} from version ${request.version}.`);
      const response: UpdateNotifierResponse = await notifierService.updateNotifier(request);
      res.status(200).json(response);
    });

    this.router.delete('/notifiers/:notifierId', async (req, res) => {
      logger.info(`Delete notifier ${req.params.notifierId}.`);
      const response: DeleteNotifierResponse = await notifierService.deleteNotifier({ notifierId: req.params.notifierId });
      res.status(200).json(response);
    });

    this.router.post('/notifiers/:notifierId/test', async (req, res) => {
      logger.info(`Test notifier ${req.params.notifierId}.`);
      const response: TestNotifierResponse = await notifierService.testNotifier({ notifierId: req.params.notifierId });
      res.status(200).json(response);
    });
  }

  bind(app: Express): void {
    app.use(this.router);
  }
}
