export type IssueStatus = 'new' | 'work-in-process' | 'resolved';

export const ISSUE_STATUSES: ReadonlyArray<IssueStatus> = ['new', 'work-in-process', 'resolved'];

export type IssueCategory =
  | 'AuthService'
  | 'ArtifactsService'
  | 'MetricsService'
  | 'MessageService'
  | 'MonitorsService'
  | 'IssuesService'
  | 'TasksService'
  | 'TickersService'
  | 'AccountsService'
  | 'ExecutionService'
  | string;

export interface Issue {
  readonly issueId: string;
  readonly status: IssueStatus; // indexed
  readonly category: IssueCategory;
  readonly type: string;
  readonly severity: number; // 1-5
  readonly title: string;
  readonly description: string;
  readonly createdAt: number;
  readonly lastUpdatedAt: number;
}
