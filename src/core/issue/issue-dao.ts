import { Issue } from '@ultrasa/mini-cloud-models';
import { InternalIssue } from './internal-models/issue';

export interface IssueDao {
  createIssue(issue: InternalIssue): Promise<void>;

  updateIssueStatus(issueId: string, status: string): Promise<void>;

  listIssues(status: string, from: number, limit: number, sort: 'asc' | 'dec'): Promise<Issue[]>;

  getIssue(issueId: string): Promise<Issue | undefined>;

  getAnyIssueByDeduplicationToken(status: string, token: string): Promise<Issue | undefined>;
}
