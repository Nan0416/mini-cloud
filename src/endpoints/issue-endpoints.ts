import type { Express } from 'express';
import { LoggerFactory } from '@sparrow/logging-js';

import { Endpoints } from './endpoints';
import { IssueHandler } from '../core/issue';
import { CreateIssueRequest, InvalidRequestError, ISSUE_STATUSES, IssueStatus, UpdateIssueStatusRequest } from '../models';

const logger = LoggerFactory.getLogger('IssueEndpoints');
export class IssueEndpoints implements Endpoints {
  private readonly issueHandler: IssueHandler;
  constructor(issueHandler: IssueHandler) {
    this.issueHandler = issueHandler;
  }

  bind(app: Express) {
    app.get('/issue/issue', async (req, res, next) => {
      const issueId = req.query['issueId'] as string;
      logger.info(`Received request to get issue ${issueId}.`);
      try {
        this.assert(typeof issueId === 'string', `Invalid or missing issueId.`);
        const response = await this.issueHandler.getIssue({ issueId: issueId });
        res.status(200);
        res.json(response);
      } catch (err) {
        next(err);
      }
    });

    app.get('/issue/issues', async (req, res, next) => {
      const status = req.query['status'] as IssueStatus;
      const from = req.query['from'] as string;
      const limit = req.query['limit'] as string;
      const sort = req.query['sort'] as 'asc' | 'dec';

      logger.info(`Received request to list issue ids on status ${status} updated from ${from} limit ${limit} and sort ${sort}.`);
      try {
        this.assert(ISSUE_STATUSES.includes(status), 'Invalid status.');
        this.assert(typeof from === 'string', 'Invalid from.');
        this.assert(typeof limit === 'string', 'Invalid limit.');
        this.assert(sort === 'asc' || sort === 'dec', 'Invalid sort.');

        const fromTimestamp = Number(from);
        this.assert(Number.isInteger(fromTimestamp) && fromTimestamp >= 0, 'invalid from');
        const limitItems = Number(limit);
        this.assert(Number.isInteger(limitItems) && limitItems >= 0, 'invalid limit');

        const response = await this.issueHandler.listIssues({
          status: status,
          from: fromTimestamp,
          limit: limitItems,
          sort: sort,
        });

        res.status(200);
        res.json(response);
      } catch (err) {
        next(err);
      }
    });

    app.post('/issue/issue', async (req, res, next) => {
      const request = req.body as CreateIssueRequest;

      logger.info(`Received request to create issue ${JSON.stringify(request)}.`);
      try {
        this.assert(typeof request.category === 'string', 'missing or invalid issue category');
        this.assert(typeof request.deduplicationToken === 'string', 'missing or invalid deduplication token');
        this.assert(typeof request.description === 'string', 'missing or invalid issue description');
        this.assert(typeof request.title === 'string', 'missing or invalid issue title');
        this.assert(typeof request.type === 'string', 'missing or invalid issue type');
        this.assert(Number.isInteger(request.severity) && request.severity >= 1 && request.severity <= 5, 'missing or invalid issue severity');

        const response = await this.issueHandler.createIssue(request);
        res.status(200);
        res.json(response);
      } catch (err) {
        next(err);
      }
    });

    app.put('/issue/issue-status', async (req, res, next) => {
      const request = req.body as UpdateIssueStatusRequest;

      logger.info(`Received request to update issue ${request.issueId} status to ${request.status}.`);
      try {
        this.assert(typeof request.issueId === 'string', 'Missing or invalid issueId');
        this.assert(ISSUE_STATUSES.includes(request.status), 'Missing or invalid issue status');
        const response = await this.issueHandler.updateIssueStatus(request);
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
