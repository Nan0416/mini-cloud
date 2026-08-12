import { AsyncQueue } from '../src/utils/async-queue';
import { sleep } from '../src/utils/sleep';

describe('AsyncQueue', () => {
  it('handles events one at a time, in enqueue order', async () => {
    const observed: number[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;

    const queue = new AsyncQueue<number>(async (event) => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      // Deliberately let later events have shorter handlers: if they ran in
      // parallel they would finish first and `observed` would come out unordered.
      await sleep(10 - event);
      observed.push(event);
      concurrent -= 1;
    });

    for (const event of [1, 2, 3, 4, 5]) {
      queue.enqueue(event);
    }
    await queue.drain();

    expect(observed).toEqual([1, 2, 3, 4, 5]);
    expect(maxConcurrent).toBe(1);
  });

  it('keeps draining after a handler throws', async () => {
    const observed: string[] = [];
    const queue = new AsyncQueue<string>(async (event) => {
      if (event === 'boom') {
        throw new Error('handler failed');
      }
      observed.push(event);
    });

    queue.enqueue('a');
    queue.enqueue('boom');
    queue.enqueue('b');
    await queue.drain();

    expect(observed).toEqual(['a', 'b']);
  });

  it('resolves drain immediately when already idle', async () => {
    const queue = new AsyncQueue<number>(async () => {});
    await expect(queue.drain()).resolves.toBeUndefined();
  });

  it('accepts events enqueued while a handler is in flight', async () => {
    const observed: number[] = [];
    const queue = new AsyncQueue<number>(async (event) => {
      await sleep(5);
      observed.push(event);
    });

    queue.enqueue(1);
    await sleep(1);
    queue.enqueue(2);
    await queue.drain();

    expect(observed).toEqual([1, 2]);
  });
});
