export interface InternalIssue {
  readonly issueId: string;
  readonly status: string;
  readonly category: string;
  readonly type: string;
  readonly severity: number;
  readonly title: string;
  readonly description: string;
  readonly deduplicationToken: string;
  readonly note?: string;
  readonly resolvedAt?: number;
}
