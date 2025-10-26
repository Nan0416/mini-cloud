import { Issue, IssueCategory, IssueStatus } from '../../models';
import { IssueDao } from './issue-dao';
import { LoggerFactory } from '@sparrow/logging-js';
import IssueSchema from './mongoose-models/issue';
import { Error } from 'mongoose';
import { InternalIssue } from './internal-models/issue';
import { EnhancedError, Errors } from '@sparrow/standard-error';

interface Timestamps {
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const logger = LoggerFactory.getLogger('MongoDBIssueDao');

export class MongoDBIssueDao implements IssueDao {
  constructor() {}

  async createIssue(internalIssue: InternalIssue): Promise<void> {
    logger.info(`Mongodb creates issue ${internalIssue.issueId} ${internalIssue.title}`);
    try {
      await IssueSchema.create(internalIssue);
    } catch (err: any) {
      if (err.name === 'MongoError' && err.code === 11000) {
        const message = `${internalIssue.issueId} issue already existed`;
        logger.error(message);
        // caller, we, should guarantee the id is unique.
        throw EnhancedError.create(Errors.INTERNAL_ERROR, 500, message);
      } else if (err instanceof Error.ValidationError) {
        const message = err.message;
        logger.error(message);
        throw EnhancedError.create(Errors.INTERNAL_ERROR, 500, message ?? '');
      }
      throw err;
    }
  }

  async updateIssueStatus(issueId: string, status: string): Promise<void> {
    logger.info(`Mongodb updates issue ${issueId} status to ${status}.`);
    try {
      await IssueSchema.findOneAndUpdate({ issueId }, { status }, { upsert: false }).exec();
    } catch (err: any) {
      const message = `Failed to issue ${issueId} status to ${status} due to issue not exist.`;
      logger.error(message);
      // caller, we, guarantee the issue exists before updating.
      throw EnhancedError.create(Errors.INTERNAL_ERROR, 500, message);
    }
  }

  async listIssues(status: string, from: number, limit: number, sort: 'asc' | 'dec'): Promise<Issue[]> {
    logger.info(`Mongodb lists issues status ${status} updated from ${from} limit ${limit} and sort ${sort}.`);

    let updatedAt: any = {};
    let sort_: any = {};

    if (sort === 'asc') {
      updatedAt['$gte'] = new Date(from);
      sort_['updatedAt'] = 1;
    } else if (sort === 'dec') {
      updatedAt['$lte'] = new Date(from);
      sort_['updatedAt'] = -1;
    }

    const query: any = {
      status: status,
      updatedAt: updatedAt,
    };

    const issues = await IssueSchema.find(query, null, { limit: limit, sort: sort_ }).exec();
    return issues.map((issue) => this.convertInternalIssueToIssue(issue.toObject<InternalIssue & Timestamps>()));
  }

  private convertInternalIssueToIssue(internalIssue: InternalIssue & Timestamps): Issue {
    return {
      issueId: internalIssue.issueId,
      status: internalIssue.status as IssueStatus,
      category: internalIssue.category as IssueCategory,
      type: internalIssue.type,
      severity: internalIssue.severity,
      title: internalIssue.title,
      description: internalIssue.description,
      note: internalIssue.note,
      resolvedAt: internalIssue.resolvedAt,
      createdAt: internalIssue.createdAt.getTime(),
      lastUpdatedAt: internalIssue.updatedAt.getTime(),
    };
  }

  async getIssue(issueId: string): Promise<Issue | undefined> {
    logger.info(`Mongodb queries issue ${issueId}.`);
    const issue = await IssueSchema.findOne({ issueId }).exec();

    if (issue) {
      return this.convertInternalIssueToIssue(issue.toObject<InternalIssue & Timestamps>());
    } else {
      return undefined;
    }
  }

  async getAnyIssueByDeduplicationToken(status: string, token: string): Promise<Issue | undefined> {
    logger.info(`Mongodb queries ${status} issues by deduplication token ${token}.`);
    const issue = await IssueSchema.findOne({ status, deduplicationToken: token }).exec();
    if (issue) {
      return this.convertInternalIssueToIssue(issue.toObject<InternalIssue & Timestamps>());
    } else {
      return undefined;
    }
  }
}
