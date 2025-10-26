import { GetMessageHubStatusRequest, GetMessageHubStatusResponse } from './message-request-response';

export interface MessageClient {
  getMessageHubStatus(request: GetMessageHubStatusRequest): Promise<GetMessageHubStatusResponse>;
}
