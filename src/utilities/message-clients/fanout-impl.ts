import { Fanout, Listener } from '@ultrasa/mini-cloud-models';
import { v4 as uuidv4 } from 'uuid';

export class FanoutImpl<T> implements Fanout<T> {
  readonly onEvent: (event: T, senderId?: string) => void;
  private listeners: Listener<T>[];

  constructor() {
    this.onEvent = (event: T, senderId?: string) => {
      for (let i = 0; i < this.listeners.length; i++) {
        const func = this.listeners[i].onEvent;
        func ? func(event, senderId) : 0;
      }
    };
    this.listeners = [];
  }

  register(listener?: (event: T, senderId?: string) => void): Listener<T> {
    const _listener: Listener<T> = {
      onEvent: listener,
      id: uuidv4(),
    };
    this.listeners.push(_listener);

    return _listener;
  }

  deregister(listenerId: string): boolean {
    const size = this.listeners.length;
    this.listeners = this.listeners.filter((l) => l.id !== listenerId);
    return size > this.listeners.length;
  }
}
