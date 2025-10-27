import { MessageClient, Publisher } from '../../models';

export interface MessageHandler extends MessageClient, Publisher {
  terminate(): Promise<void>;
}
