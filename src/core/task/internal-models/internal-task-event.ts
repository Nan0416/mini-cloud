export interface InternalTaskEvent {
  readonly instanceId: string;
  readonly eventId: string;
  readonly source: string;
  readonly timestamp: Date;
  readonly level: string;
  readonly format: string;
  readonly payload: string;
}
