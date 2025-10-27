import {
  CreateIssueRequest,
  IssueStatus,
  ListIssuesRequest,
  InternalServiceError,
  IssueNotFoundError,
  CreateIssueResponse,
  UpdateIssueStatusRequest,
  UpdateIssueStatusResponse,
  ListIssuesResponse,
  GetIssueRequest,
  GetIssueResponse,
} from '../../models';
import { LoggerFactory } from '@sparrow/logging-js';
import { IssueDao } from './issue-dao';
import { Metrics } from '@sparrow/metrics-types';
import { InternalIssue } from './internal-models/issue';
import { customAlphabet } from 'nanoid';
import { IssueNotifier } from './issue-notifier';
import { MetricsContext } from '@sparrow/metrics-logger';
import { IssueHandler } from './issue-handler';
const idFunc = customAlphabet('1234567890', 10);

const NEW_ISSUE_COUNT = 'NewIssueCount';

/**
 * handle store, notification, deduplication.
 */
const logger = LoggerFactory.getLogger('IssueHandlerImpl');

export class IssueHandlerImpl implements IssueHandler {
  private readonly notifier: IssueNotifier;
  private readonly issueDao: IssueDao;
  private readonly metrics: Metrics;

  constructor(issueDao: IssueDao, notifer: IssueNotifier) {
    this.notifier = notifer;
    this.issueDao = issueDao;
    this.metrics = MetricsContext.getMetrics();
  }

  async createIssue(request: CreateIssueRequest): Promise<CreateIssueResponse> {
    logger.info(`Creates issue ${request.category} ${request.title}.`);

    const openStatus: IssueStatus = 'new';
    const openIssue = await this.issueDao.getAnyIssueByDeduplicationToken(openStatus, request.deduplicationToken);
    if (openIssue !== undefined) {
      logger.info(`Having open issue associated with deduplication token ${request.deduplicationToken}.`);
      return {
        issueId: openIssue.issueId,
      };
    }

    const workingStatus: IssueStatus = 'work-in-process';
    const workingIssue = await this.issueDao.getAnyIssueByDeduplicationToken(workingStatus, request.deduplicationToken);
    if (workingIssue !== undefined) {
      logger.info(`Having working issue associated with deduplication token ${request.deduplicationToken}.`);
      return {
        issueId: workingIssue.issueId,
      };
    }

    this.metrics.incrementCounter(NEW_ISSUE_COUNT + '.' + request.category);

    const issueId = `T${idFunc()}`;
    logger.info(`Assigns id ${issueId} issue ${request.category} ${request.title}`);

    const internalIssue: InternalIssue = {
      issueId,
      category: request.category,
      status: 'new',
      type: request.type,
      severity: request.severity,
      title: request.title,
      description: request.description,
      deduplicationToken: request.deduplicationToken,
    };
    await this.issueDao.createIssue(internalIssue);

    const issue = await this.issueDao.getIssue(issueId);
    if (issue) {
      await this.notifier.newIssue(issue);
      return {
        issueId: issue.issueId,
      };
    } else {
      const message = `Can't find just created issue ${issueId}.`;
      logger.error(message);
      throw new InternalServiceError(message);
    }
  }

  async updateIssueStatus(request: UpdateIssueStatusRequest): Promise<UpdateIssueStatusResponse> {
    logger.info(`Update issue ${request.issueId} status to ${request.status}.`);
    const issue = await this.issueDao.getIssue(request.issueId);
    if (issue) {
      if (issue.status !== request.status) {
        await this.issueDao.updateIssueStatus(request.issueId, request.status);
        logger.info('Sending notification.');
        await this.notifier.statusChange(request.issueId, request.status);
      } else {
        logger.info(`Don't update issue ${request.issueId} status to ${request.status} because the current status is already ${request.status}.`);
      }
    } else {
      throw new IssueNotFoundError(`Issue ${request.issueId} doesn't exist.`);
    }

    return {};
  }

  async listIssues(request: ListIssuesRequest): Promise<ListIssuesResponse> {
    logger.info(`Lists ${request.status} issues updated time from ${new Date(request.from).toISOString()} limit ${request.limit} and sort ${request.sort}.`);
    const issues = await this.issueDao.listIssues(request.status, request.from, request.limit, request.sort);
    logger.info(`Found ${issues.length} issues.`);
    return {
      issues: issues,
    };
  }

  async getIssue(request: GetIssueRequest): Promise<GetIssueResponse> {
    logger.info(`Get issue by issueId ${request.issueId}`);
    const issue = await this.issueDao.getIssue(request.issueId);
    if (issue === undefined) {
      throw new IssueNotFoundError(`Issue ${request.issueId} doesn't exist.`);
    }
    return {
      issue: issue,
    };
  }
}
