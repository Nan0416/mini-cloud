import {
  CreateIssueRequest,
  CreateIssueResponse,
  GetIssueRequest,
  GetIssueResponse,
  ListIssuesRequest,
  ListIssuesResponse,
  UpdateIssueStatusRequest,
  UpdateIssueStatusResponse,
} from './issue-request-response';

export interface IssueClient {
  /**
   *
   * @param request avoid create new issue if there is an open or in-progress issue that has the same deduplication token.
   */
  createIssue(request: CreateIssueRequest): Promise<CreateIssueResponse>;

  updateIssueStatus(request: UpdateIssueStatusRequest): Promise<UpdateIssueStatusResponse>;

  listIssues(request: ListIssuesRequest): Promise<ListIssuesResponse>;

  getIssue(request: GetIssueRequest): Promise<GetIssueResponse>;
}
