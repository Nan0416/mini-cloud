import { generateEventId, generateInstanceId, generateTaskId } from '../../src/utils/ids';

/**
 * Each alphabet was chosen for where its ids end up, so the constraint worth pinning
 * down is the character set rather than the randomness. A task id widened to include
 * letters would still work everywhere except the places these were narrowed for.
 */
describe('generateTaskId', () => {
  it('is ten digits, because task ids get typed and read aloud', () => {
    // Mixed case invites transcription mistakes when someone reads an id off a screen
    // to someone else, or types one from a note.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      expect(generateTaskId()).toMatch(/^[0-9]{10}$/);
    }
  });

  it('does not repeat itself', () => {
    const ids = new Set(Array.from({ length: 1_000 }, generateTaskId));

    expect(ids.size).toBe(1_000);
  });
});

describe('generateInstanceId', () => {
  it('is twelve lowercase alphanumerics, because instance ids appear in paths and URLs', () => {
    // No uppercase: a case-insensitive filesystem would collide two distinct ids.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      expect(generateInstanceId()).toMatch(/^[0-9a-z]{12}$/);
    }
  });

  it('does not repeat itself', () => {
    const ids = new Set(Array.from({ length: 1_000 }, generateInstanceId));

    expect(ids.size).toBe(1_000);
  });
});

describe('generateEventId', () => {
  it('is sixteen lowercase alphanumerics', () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      expect(generateEventId()).toMatch(/^[0-9a-z]{16}$/);
    }
  });

  it('is longer than an instance id, because events are written far more often', () => {
    // A chatty task writes thousands of events per instance; the wider space keeps
    // the collision probability negligible at that rate.
    expect(generateEventId().length).toBeGreaterThan(generateInstanceId().length);
  });

  it('does not repeat itself', () => {
    const ids = new Set(Array.from({ length: 1_000 }, generateEventId));

    expect(ids.size).toBe(1_000);
  });
});

describe('id namespaces', () => {
  it('keeps the three kinds distinguishable by shape', () => {
    // An id that turns up in a log or a URL should say what it identifies without
    // needing the surrounding context.
    expect(generateTaskId()).toHaveLength(10);
    expect(generateInstanceId()).toHaveLength(12);
    expect(generateEventId()).toHaveLength(16);
  });
});
