import { AsyncQueue } from '../../src/utilities';

function asleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe('async-queue', () => {
  test('enqueue_HappyPathWithTerminate_shouldReturnFinalValue', async () => {
    const queue = new AsyncQueue<number>();

    let count = 0;
    queue.onEvent = async (num: number) => {
      await asleep(500);
      count += num;
    };
    queue.enqueue(1);
    queue.enqueue(3);
    queue.enqueue(5);

    expect(count).toStrictEqual(0);
    await queue.terminate();
    expect(count).toStrictEqual(9);
  });

  test('enqueue_afterTerminationShouldIgnore_shouldReturnValueWithoutTermination', async () => {
    const queue = new AsyncQueue<number>();

    let count = 0;
    queue.onEvent = async (num: number) => {
      await asleep(500);
      count += num;
    };
    queue.enqueue(1);
    queue.enqueue(3);
    queue.enqueue(5);

    expect(count).toStrictEqual(0);

    const promise = queue.terminate();
    queue.enqueue(10);
    await promise;
    expect(count).toStrictEqual(9);
  });

  test('enqueue_withMaximumSize_shouldIgnoreFirstOne', async () => {
    const queue = new AsyncQueue<number>({
      maxSize: 2,
    });

    let count = 0;
    queue.onEvent = async (num: number) => {
      await asleep(500);
      count += num;
    };

    queue.enqueue(100); // throw
    queue.enqueue(3);
    queue.enqueue(5);

    expect(count).toStrictEqual(0);
    await queue.terminate();
    expect(count).toStrictEqual(8);
  });

  test('enqueue_afterTerminationWithThrowError_shouldThrowException', async () => {
    const queue = new AsyncQueue<number>({
      throwErrorOnTermination: true,
    });

    let count = 0;
    queue.onEvent = async (num: number) => {
      await asleep(500);
      count += num;
    };
    queue.enqueue(1);
    queue.enqueue(3);
    queue.enqueue(5);

    expect(count).toStrictEqual(0);
    const promise = queue.terminate();
    expect(() => queue.enqueue(10)).toThrowError('enqueue task while the async queue is terminated');
    await promise;
    expect(count).toStrictEqual(9);
  });
});
