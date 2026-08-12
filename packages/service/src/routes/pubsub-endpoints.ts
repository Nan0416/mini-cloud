import { GetHubStatusResponse, PublishResponse } from '@mini-cloud/shared';
import { Router } from 'express';
import type { Express } from 'express';
import { MessageHub } from '../pubsub/message-hub';
import { parsePublishRequest } from '../utils/request-parsing';
import { Endpoints } from './endpoints';

export interface PubSubEndpointsProps {
  readonly messageHub: MessageHub;
}

/**
 * HTTP access to the pub/sub hub, for publishers that do not want to hold a
 * WebSocket open. Subscribing still requires the socket.
 */
export class PubSubEndpoints implements Endpoints {
  private readonly router: Router;

  constructor(props: PubSubEndpointsProps) {
    this.router = Router();

    this.router.post('/pubsub/publish', async (req, res) => {
      const request = parsePublishRequest(req.body);
      const response: PublishResponse = { deliveredTo: props.messageHub.publish(request.topic, request.payload) };
      res.status(200).json(response);
    });

    this.router.get('/pubsub/status', async (_req, res) => {
      const response: GetHubStatusResponse = { status: props.messageHub.getStatus() };
      res.status(200).json(response);
    });
  }

  bind(app: Express): void {
    app.use(this.router);
  }
}
