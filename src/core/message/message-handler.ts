import { MessageClient, Publisher } from '@ultrasa/mini-cloud-models';

export interface MessageHandler extends MessageClient, Publisher {
  terminate(): Promise<void>;
}
