import type { Express } from 'express';
import { Endpoints } from './endpoints';
import { MessageHandler } from '../core/message';
import { LoggerFactory } from '@sparrow/logging-js';
import { InvalidRequestError, PublishTimestamp, SenderIdentifier } from '../models';

const logger = LoggerFactory.getLogger('MessageEndpoints');

export class MessageEndpoints implements Endpoints {
  private readonly messageHandler: MessageHandler;
  constructor(messageHandler: MessageHandler) {
    this.messageHandler = messageHandler;
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
        const response = await this.messageHandler.broadcast({
          topic: topic,
          event: evt,
        });
        res.status(200);
        res.json(response);
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
        const response = await this.messageHandler.sendTo({
          recipientId: recipientId,
          event: evt,
        });
        res.status(200);
        res.json(response);
      } catch (err) {
        next(err);
      }
    });

    app.get('/message/status', async (req, res, next) => {
      logger.info(`Received request to get message hub status.`);
      try {
        const response = await this.messageHandler.getMessageHubStatus({});
        res.status(200);
        res.json(response);
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
