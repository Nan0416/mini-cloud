import { queryKeys } from '@/lib/query-keys';

/**
 * The keys are hierarchical on purpose: react-query invalidates by prefix, so
 * `['tasks']` has to drop every task detail and dynamics entry with it. A launch or a
 * delete changes more than the row it names, and hand-listing the affected keys at
 * each call site is exactly how a stale panel survives a mutation.
 */
const startsWith = (key: ReadonlyArray<unknown>, prefix: ReadonlyArray<unknown>): boolean =>
  prefix.every((segment, index) => JSON.stringify(key[index]) === JSON.stringify(segment));

describe('queryKeys', () => {
  it('nests every task key under the tasks prefix', () => {
    for (const key of [queryKeys.task('t1'), queryKeys.task('t1', 3), queryKeys.taskDynamics('t1')]) {
      expect(startsWith(key, queryKeys.tasks())).toBe(true);
    }
  });

  it('nests every instance key under the instances prefix', () => {
    for (const key of [queryKeys.instances(), queryKeys.instance('i1'), queryKeys.instanceEvents('i1')]) {
      expect(startsWith(key, ['instances'])).toBe(true);
    }
  });

  it('distinguishes the latest version from a pinned one', () => {
    // Without a placeholder, `['tasks','t1',undefined]` and `['tasks','t1',3]` would
    // both serialise in ways that make the two views share a cache entry.
    expect(queryKeys.task('t1')).toEqual(['tasks', 't1', 'latest']);
    expect(queryKeys.task('t1', 3)).toEqual(['tasks', 't1', 3]);
    expect(queryKeys.task('t1')).not.toEqual(queryKeys.task('t1', 3));
  });

  it('keeps two tasks apart', () => {
    expect(queryKeys.task('t1')).not.toEqual(queryKeys.task('t2'));
    expect(queryKeys.taskDynamics('t1')).not.toEqual(queryKeys.taskDynamics('t2'));
  });

  it('keeps a task detail apart from its dynamics', () => {
    expect(queryKeys.task('t1')).not.toEqual(queryKeys.taskDynamics('t1'));
  });

  it('makes an instance listing depend on its filter', () => {
    // Two filtered views must not share a cache entry, or switching the agent filter
    // would show the previous agent's rows.
    expect(queryKeys.instances({ agentId: 'a' })).not.toEqual(queryKeys.instances({ agentId: 'b' }));
    expect(queryKeys.instances({ agentId: 'a' })).toEqual(queryKeys.instances({ agentId: 'a' }));
  });

  it('treats an absent filter as the unfiltered listing', () => {
    expect(queryKeys.instances()).toEqual(queryKeys.instances({}));
  });

  it('keeps an instance detail apart from its events', () => {
    expect(queryKeys.instance('i1')).not.toEqual(queryKeys.instanceEvents('i1'));
  });

  it('gives the top-level resources their own roots', () => {
    expect(queryKeys.agents()).toEqual(['agents']);
    expect(queryKeys.variables()).toEqual(['variables']);
    expect(queryKeys.hubStatus()).toEqual(['hub-status']);
    expect(queryKeys.ping()).toEqual(['ping']);
  });

  it('does not let one root prefix another', () => {
    // `['instances']` must not be a prefix of `['instance-events']`, or invalidating
    // one would silently drop the other.
    const roots = [queryKeys.tasks(), ['instances'], queryKeys.agents(), queryKeys.variables(), queryKeys.hubStatus(), queryKeys.ping()];
    const firstSegments = roots.map((root) => root[0]);

    expect(new Set(firstSegments).size).toBe(roots.length);
  });
});
