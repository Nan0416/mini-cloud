import { Issue, IssueStatus } from '../../models';

export interface IssueNotifier {
  newIssue(issue: Issue): Promise<void>;

  statusChange(issueId: string, status: IssueStatus): Promise<void>;
}
