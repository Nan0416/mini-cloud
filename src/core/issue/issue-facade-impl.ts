import { CreateIssueRequest, IssueStatus, Issue, ListIssuesRequest } from '../../models';
import { LoggerFactory } from '@sparrow/logging-js';
import { IssueDao } from './issue-dao';
import { Metrics } from '@sparrow/metrics-types';
import { InternalIssue } from './internal-models/issue';
import { customAlphabet } from 'nanoid';
import { EnhancedError, Errors } from '@sparrow/standard-error';
import { IssueFacade } from './issue-facade';
import { IssueNotifier } from './issue-notifier';

import { MetricsContext } from '@sparrow/metrics-logger';
const idFunc = customAlphabet('1234567890', 10);

const NEW_ISSUE_COUNT = 'NewIssueCount';

/**
 * handle store, notification, deduplication.
 */
const logger = LoggerFactory.getLogger('IssueFacadeImpl');

export class IssueFacadeImpl implements IssueFacade {
  private readonly notifier: IssueNotifier;
  private readonly issueDao: IssueDao;
  private readonly metrics: Metrics;

  constructor(issueDao: IssueDao, notifer: IssueNotifier) {
    this.notifier = notifer;
    this.issueDao = issueDao;
    this.metrics = MetricsContext.getMetrics();
  }

  async createIssue(request: CreateIssueRequest): Promise<string> {
    logger.info(`Creates issue ${request.category} ${request.title}.`);

    const openStatus: IssueStatus = 'new';
    const openIssue = await this.issueDao.getAnyIssueByDeduplicationToken(openStatus, request.deduplicationToken);
    if (openIssue !== undefined) {
      logger.info(`Having open issue associated with deduplication token ${request.deduplicationToken}.`);
      return openIssue.issueId;
    }

    const workingStatus: IssueStatus = 'work-in-process';
    const workingIssue = await this.issueDao.getAnyIssueByDeduplicationToken(workingStatus, request.deduplicationToken);
    if (workingIssue !== undefined) {
      logger.info(`Having working issue associated with deduplication token ${request.deduplicationToken}.`);
      return workingIssue.issueId;
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
      return issue.issueId;
    } else {
      const message = `Can't find just created issue ${issueId}.`;
      logger.error(message);
      throw EnhancedError.create(Errors.INTERNAL_ERROR, 500, message);
    }
  }

  async updateIssueStatus(issueId: string, status: IssueStatus): Promise<void> {
    logger.info(`Update issue ${issueId} status to ${status}.`);
    const issue = await this.issueDao.getIssue(issueId);
    if (issue) {
      if (issue.status !== status) {
        await this.issueDao.updateIssueStatus(issueId, status);
        logger.info('Sending notification.');
        await this.notifier.statusChange(issueId, status);
      } else {
        logger.info(`Don't update issue ${issueId} status to ${status} because the current status is already ${status}.`);
      }
    } else {
      throw EnhancedError.create(Errors.NOT_FOUND, 404, `Issue ${issueId} doesn't exist.`);
    }
  }

  async listIssues(request: ListIssuesRequest): Promise<Issue[]> {
    logger.info(`Lists ${request.status} issues updated time from ${new Date(request.from).toISOString()} limit ${request.limit} and sort ${request.sort}.`);
    const issues = await this.issueDao.listIssues(request.status, request.from, request.limit, request.sort);
    logger.info(`Found ${issues.length} issues.`);
    return issues;
  }

  async getIssue(issueId: string): Promise<Issue | undefined> {
    logger.info(`Queries issue ${issueId}.`);
    return await this.issueDao.getIssue(issueId);
  }
}
