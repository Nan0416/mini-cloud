import { Issue, IssueCategory, IssueStatus } from '../models';

export interface CreateIssueRequest {
  readonly category: IssueCategory;
  readonly type: string;
  readonly severity: number; // 1-5
  readonly title: string;
  readonly description: string;
  readonly deduplicationToken: string;
}

export interface CreateIssueResponse {
  readonly issueId: string;
}

export interface UpdateIssueStatusRequest {
  readonly issueId: string;
  readonly status: IssueStatus;
}

export interface UpdateIssueStatusResponse {}

export interface ListIssuesRequest {
  readonly status: IssueStatus;
  // updated time.
  readonly from: number;
  readonly limit: number;
  readonly sort: 'asc' | 'dec';
}

export interface ListIssuesResponse {
  readonly issues: Issue[];
}

export interface GetIssueRequest {
  readonly issueId: string;
}

export interface GetIssueResponse {
  readonly issue: Issue;
}
