import { BroadcastResponse, GetHubStatusResponse, SendToResponse } from '@mini-cloud/shared';
import { Router } from 'express';
import type { Express } from 'express';
import { MessageHub } from '../facades/message-hub';
import { parseBroadcastRequest, parseSendToRequest } from '../utils/request-parsing';
import { Endpoints } from './endpoints';

export interface PubSubEndpointsProps {
  readonly messageHub: MessageHub;
}

/**
 * HTTP access to the pub/sub hub, for publishers that do not want to hold a
 * WebSocket open. Subscribing still requires the socket, and so does being
 * attributed: an HTTP publisher has no connection to be identified by, so its
 * messages arrive without a `senderId`.
 */
export class PubSubEndpoints implements Endpoints {
  private readonly router: Router;

  constructor(props: PubSubEndpointsProps) {
    this.router = Router();

    this.router.post('/pubsub/broadcast', async (req, res) => {
      const request = parseBroadcastRequest(req.body);
      const deliveredTo = props.messageHub.publish({ method: 'broadcast', to: request.topic }, { payload: request.payload, publishedAt: request.publishedAt });
      const response: BroadcastResponse = { deliveredTo };
      res.status(200).json(response);
    });

    this.router.post('/pubsub/p2p', async (req, res) => {
      const request = parseSendToRequest(req.body);
      // A recipient that has disconnected reports `deliveredTo: 0` rather than a 404:
      // subscribers come and go, so an absent one is news for the caller to act on,
      // not a malformed request.
      const deliveredTo = props.messageHub.publish({ method: 'p2p', to: request.recipientId }, { payload: request.payload, publishedAt: request.publishedAt });
      const response: SendToResponse = { deliveredTo };
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
