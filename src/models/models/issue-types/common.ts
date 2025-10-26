export type IssueStatus = 'new' | 'work-in-process' | 'resolved';
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
  /**
   * @deprecated, I no longer want to support the field. Please use external notes to keep track of and document the issue.
   */
  readonly note?: string;
  /**
   * @deprecated, use lastUpdatedAt instead.
   */
  readonly resolvedAt?: number;
  readonly createdAt: number;
  readonly lastUpdatedAt: number;
}
