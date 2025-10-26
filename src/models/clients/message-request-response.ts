import { MessageHubStatus } from '../models/message-types';

export interface GetMessageHubStatusRequest {}

export interface GetMessageHubStatusResponse {
  readonly status: MessageHubStatus;
}
