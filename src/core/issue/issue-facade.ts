import { Issue, IssueStatus, CreateIssueRequest, ListIssuesRequest } from '../../models';

export interface IssueFacade {
  createIssue(request: CreateIssueRequest): Promise<string>;

  updateIssueStatus(issueId: string, status: IssueStatus): Promise<void>;

  listIssues(request: ListIssuesRequest): Promise<Issue[]>;

  getIssue(issueId: string): Promise<Issue | undefined>;
}
