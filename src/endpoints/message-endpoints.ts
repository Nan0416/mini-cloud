import type { Express } from 'express';
import { Endpoints } from './endpoints';
import { MessageHub } from '../core/message/message-hub';
import { LoggerFactory } from '@sparrow/logging-js';
import { InvalidRequestError, PublishTimestamp, SenderIdentifier } from '../models';

const logger = LoggerFactory.getLogger('MessageEndpoints');

export class MessageEndpoints implements Endpoints {
  private readonly messageHub: MessageHub;
  constructor(messageHub: MessageHub) {
    this.messageHub = messageHub;
  }
  bind(app: Express): void {
    app.post('/message/broadcast', async (req, res, next) => {
      const rawTopic = req.query['topic'] as string;
      logger.info(`Received request to broadcast message to topic ${rawTopic}.`);
      try {
        this.assert(typeof rawTopic === 'string', 'invalid topic');
        const topic = decodeURIComponent(rawTopic);
        const evt = req.body as PublishTimestamp & SenderIdentifier;
        this.assert(typeof evt?._publishedAt === 'number', 'missing or invalid _publishedAt timestamp');
        this.assert(evt?._senderId === undefined, 'publisher client could not set senderId, messages are sent anonymously');
        this.messageHub.publish({ method: 'broadcast', to: topic }, evt);
        res.status(200);
        res.json({ message: 'success' });
      } catch (err) {
        next(err);
      }
    });

    app.post('/message/p2p', async (req, res, next) => {
      const rawRecipientId = req.query['recipientId'] as string;
      logger.info(`Received request to forward message to recipient ${rawRecipientId}.`);
      try {
        this.assert(typeof rawRecipientId === 'string', 'invalid recipientId');
        const recipientId = decodeURIComponent(rawRecipientId);
        const evt = req.body as PublishTimestamp & SenderIdentifier;
        this.assert(typeof evt?._publishedAt === 'number', 'missing or invalid _publishedAt timestamp');
        this.assert(evt?._senderId === undefined, 'publisher client could not set senderId, messages are sent anonymously');
        this.messageHub.publish({ method: 'p2p', to: recipientId }, evt);
        res.status(200);
        res.json({ message: 'success' });
      } catch (err) {
        next(err);
      }
    });

    app.get('/message/status', async (req, res, next) => {
      logger.info(`Received request to get message hub status.`);
      try {
        const status = this.messageHub.getStatus();
        res.status(200);
        res.json(status);
      } catch (err) {
        next(err);
      }
    });
  }

  private assert(condition: boolean, message: string) {
    if (!condition) {
      throw new InvalidRequestError(message);
    }
  }
}
