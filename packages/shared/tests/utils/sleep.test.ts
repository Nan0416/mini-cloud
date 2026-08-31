import { LinearBackoff, sleep } from '../../src/utils/sleep';

describe('sleep', () => {
  it('resolves only after the delay has elapsed', async () => {
    const started = Date.now();

    await sleep(20);

    // Timers fire no earlier than asked but may fire late, so this is a lower bound.
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });

  it('resolves on the next turn for a zero delay', async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
  });
});

/**
 * Reconnect pacing, and the reason it is linear rather than exponential: a home-lab
 * service restarts in seconds, so doubling would sit a client out for minutes after a
 * blip, while a flat delay would hammer a control plane that is down for hours.
 */
describe('LinearBackoff', () => {
  it('starts at the minimum, so the first retry after a blip is immediate enough', () => {
    expect(new LinearBackoff(200, 10_000, 500).nextDelayMs()).toBe(200);
  });

  it('grows by one step per attempt', () => {
    const backoff = new LinearBackoff(200, 10_000, 500);

    expect([backoff.nextDelayMs(), backoff.nextDelayMs(), backoff.nextDelayMs()]).toEqual([200, 700, 1200]);
  });

  it('caps at the maximum and stays there however long the outage lasts', () => {
    const backoff = new LinearBackoff(200, 1_000, 500);

    expect([backoff.nextDelayMs(), backoff.nextDelayMs(), backoff.nextDelayMs(), backoff.nextDelayMs()]).toEqual([200, 700, 1000, 1000]);
    // Unbounded growth would leave a client that reconnects after an hour waiting
    // another hour before noticing the service is back.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      expect(backoff.nextDelayMs()).toBe(1_000);
    }
  });

  it('returns to the minimum once reset', () => {
    const backoff = new LinearBackoff(200, 10_000, 500);
    backoff.nextDelayMs();
    backoff.nextDelayMs();

    backoff.reset();

    // Called on a successful connect: the next disconnect is a fresh outage, not a
    // continuation of the last one.
    expect(backoff.nextDelayMs()).toBe(200);
  });

  it('defaults to 200ms rising by 500ms to a 10s ceiling', () => {
    const backoff = new LinearBackoff();

    expect([backoff.nextDelayMs(), backoff.nextDelayMs()]).toEqual([200, 700]);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      backoff.nextDelayMs();
    }
    expect(backoff.nextDelayMs()).toBe(10_000);
  });

  it('waits for the delay it just handed out', async () => {
    const backoff = new LinearBackoff(20, 100, 10);
    const started = Date.now();

    await backoff.wait();

    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
    // `wait` consumes an attempt like `nextDelayMs` does, rather than peeking.
    expect(backoff.nextDelayMs()).toBe(30);
  });
});
