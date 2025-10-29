import { Issue, IssueStatus } from '@ultrasa/mini-cloud-models';

export interface IssueNotifier {
  newIssue(issue: Issue): Promise<void>;

  statusChange(issueId: string, status: IssueStatus): Promise<void>;
}
