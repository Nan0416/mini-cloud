import { formatPayload, formatPayloadInline, truncate } from '@/lib/format';

describe('formatPayloadInline', () => {
  it('leads with the message, so the row opens on what the event says', () => {
    // The bug this replaced: the indented form's first line is `{`, so every
    // structured payload rendered as an empty-looking row.
    expect(formatPayload({ message: 'backup finished' }).split('\n')[0]).toBe('{');
    expect(formatPayloadInline({ message: 'backup finished' })).toEqual({ lead: 'backup finished', rest: '' });
  });

  it('keeps the remaining keys, compact, after the message', () => {
    expect(formatPayloadInline({ message: 'exited', code: 1, signal: null })).toEqual({
      lead: 'exited',
      rest: '{"code":1,"signal":null}',
    });
  });

  it('falls back to compact JSON when there is no string message', () => {
    expect(formatPayloadInline({ code: 1, phase: 'start' })).toEqual({ lead: '{"code":1,"phase":"start"}', rest: '' });
    expect(formatPayloadInline({ message: { nested: true } })).toEqual({ lead: '{"message":{"nested":true}}', rest: '' });
    expect(formatPayloadInline([1, 2])).toEqual({ lead: '[1,2]', rest: '' });
    expect(formatPayloadInline(null)).toEqual({ lead: 'null', rest: '' });
  });

  it('passes a string payload through, which is what the service and agent write', () => {
    expect(formatPayloadInline('agent reported pid 4211')).toEqual({ lead: 'agent reported pid 4211', rest: '' });
    expect(formatPayloadInline(undefined)).toEqual({ lead: '', rest: '' });
  });

  it('collapses newlines, so a stack trace occupies one row and not thirty', () => {
    expect(formatPayloadInline('Error: boom\n  at run()\n  at main()').lead).toBe('Error: boom at run() at main()');
    expect(formatPayloadInline({ message: 'failed:\n\tsee log' }).lead).toBe('failed: see log');
  });

  it('survives a payload that cannot be serialized', () => {
    const cyclic: Record<string, unknown> = { code: 1 };
    cyclic['self'] = cyclic;
    expect(() => formatPayloadInline(cyclic)).not.toThrow();
    expect(formatPayloadInline(cyclic).lead.length).toBeGreaterThan(0);
  });
});

describe('truncate', () => {
  it('reports that it dropped something, so the marker means truncated', () => {
    expect(truncate('abcdef', 3)).toEqual({ text: 'abc', truncated: true });
  });

  it('leaves text that fits untouched, and says so', () => {
    expect(truncate('abc', 3)).toEqual({ text: 'abc', truncated: false });
    expect(truncate('', 0)).toEqual({ text: '', truncated: false });
  });

  it('treats a zero budget as no room for anything present', () => {
    // What the cell hands it once a long message has spent the whole limit.
    expect(truncate('{"code":1}', 0)).toEqual({ text: '', truncated: true });
  });
});
