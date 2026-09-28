import { formatSpan, isSameWindow, parseSpan, readWindow, windowSearch, withWindowRange } from '@/lib/graph-window';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatSpan and parseSpan', () => {
  it('writes a span in the largest unit that divides it', () => {
    expect(formatSpan(3 * HOUR)).toBe('3h');
    expect(formatSpan(90 * MINUTE)).toBe('90m');
    expect(formatSpan(14 * DAY)).toBe('2w');
    expect(formatSpan(3 * DAY)).toBe('3d');
  });

  it('reads back what it writes', () => {
    for (const span of [MINUTE, 5 * MINUTE, 3 * HOUR, 90 * MINUTE, DAY, 28 * DAY]) {
      expect(parseSpan(formatSpan(span), 'range')).toBe(span);
    }
  });

  it('refuses something that is not a whole number of a unit, naming the parameter', () => {
    expect(() => parseSpan('3', 'range')).toThrow(/range "3" is not a span/);
    expect(() => parseSpan('1.5h', 'period')).toThrow(/period/);
    expect(() => parseSpan('0h', 'range')).toThrow();
  });
});

describe('readWindow', () => {
  const fallback = { range: { kind: 'relative' as const, durationMs: 3 * HOUR }, periodMs: 5 * MINUTE };

  it('opens on the default when the link names no window', () => {
    expect(readWindow(new URLSearchParams(''), fallback)).toEqual(fallback);
  });

  it('overrides the default one parameter at a time', () => {
    expect(readWindow(new URLSearchParams('period=1h'), fallback)).toEqual({ range: fallback.range, periodMs: HOUR });
    expect(readWindow(new URLSearchParams('range=1d'), fallback)).toEqual({ range: { kind: 'relative', durationMs: DAY }, periodMs: 5 * MINUTE });
  });

  it('reads auto as no chosen period, even over a default that has one', () => {
    expect(readWindow(new URLSearchParams('period=auto'), fallback).periodMs).toBeUndefined();
  });

  it('reads a fixed window in ISO time', () => {
    const window = readWindow(new URLSearchParams('from=2026-09-01T12:00:00.000Z&to=2026-09-02T12:00:00.000Z'), fallback);

    expect(window.range).toEqual({ kind: 'absolute', from: Date.UTC(2026, 8, 1, 12), to: Date.UTC(2026, 8, 2, 12) });
  });

  it('refuses half a fixed window rather than guessing the other end', () => {
    expect(() => readWindow(new URLSearchParams('from=2026-09-01T12:00Z'), fallback)).toThrow(/needs to as well/);
  });

  it('refuses a window that ends before it starts', () => {
    expect(() => readWindow(new URLSearchParams('from=2026-09-02T00:00Z&to=2026-09-01T00:00Z'), fallback)).toThrow(/before/);
  });
});

describe('windowSearch', () => {
  it('writes a relative window readably', () => {
    expect(windowSearch({ range: { kind: 'relative', durationMs: 3 * HOUR }, periodMs: 5 * MINUTE })).toBe('range=3h&period=5m');
    expect(windowSearch({ range: { kind: 'relative', durationMs: DAY } })).toBe('range=1d&period=auto');
  });

  it('writes a fixed window as ISO times a link can carry unescaped', () => {
    expect(windowSearch({ range: { kind: 'absolute', from: Date.UTC(2026, 8, 1), to: Date.UTC(2026, 8, 2) } })).toBe(
      'from=2026-09-01T00:00:00.000Z&to=2026-09-02T00:00:00.000Z&period=auto',
    );
  });

  it('survives a trip through a link', () => {
    const windows = [
      { range: { kind: 'relative' as const, durationMs: 12 * HOUR }, periodMs: 15 * MINUTE },
      { range: { kind: 'absolute' as const, from: Date.UTC(2026, 8, 1), to: Date.UTC(2026, 8, 3) }, periodMs: undefined },
    ];
    for (const window of windows) {
      expect(readWindow(new URLSearchParams(windowSearch(window)), { range: { kind: 'relative', durationMs: HOUR } })).toEqual(window);
    }
  });
});

describe('withWindowRange', () => {
  it('keeps a period that still fits, and drops one that no longer does', () => {
    const window = { range: { kind: 'relative' as const, durationMs: DAY }, periodMs: 6 * HOUR };

    expect(withWindowRange(window, { kind: 'relative', durationMs: 3 * DAY }).periodMs).toBe(6 * HOUR);
    expect(withWindowRange(window, { kind: 'relative', durationMs: HOUR }).periodMs).toBeUndefined();
  });
});

describe('isSameWindow', () => {
  it('treats an absent period as automatic', () => {
    expect(isSameWindow({ range: { kind: 'relative', durationMs: HOUR } }, { range: { kind: 'relative', durationMs: HOUR }, periodMs: undefined })).toBe(true);
    expect(isSameWindow({ range: { kind: 'relative', durationMs: HOUR } }, { range: { kind: 'relative', durationMs: HOUR }, periodMs: MINUTE })).toBe(false);
  });
});
