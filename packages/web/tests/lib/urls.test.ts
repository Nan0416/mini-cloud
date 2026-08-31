import { urls } from '@/lib/urls';

/**
 * Routes are functions rather than string literals scattered through components, so
 * these check the one thing a caller cannot see at the call site: that an id is
 * encoded on its way into a path. An id containing a slash would otherwise silently
 * become two path segments and route somewhere else entirely.
 */
describe('urls', () => {
  it('builds the static routes', () => {
    expect(urls.overview()).toBe('/');
    expect(urls.tasks()).toBe('/tasks');
    expect(urls.createTask()).toBe('/tasks/new');
    expect(urls.instances()).toBe('/instances');
    expect(urls.agents()).toBe('/agents');
    expect(urls.variables()).toBe('/variables');
    expect(urls.pubsub()).toBe('/pubsub');
  });

  it('builds a task link', () => {
    expect(urls.task('1234567890')).toBe('/tasks/1234567890');
    expect(urls.editTask('1234567890')).toBe('/tasks/1234567890/edit');
  });

  it('builds an instance link', () => {
    expect(urls.instance('abc123def456')).toBe('/instances/abc123def456');
  });

  it('encodes an id, so one that contains a slash stays one path segment', () => {
    expect(urls.task('a/b')).toBe('/tasks/a%2Fb');
    expect(urls.editTask('a/b')).toBe('/tasks/a%2Fb/edit');
    expect(urls.instance('a b')).toBe('/instances/a%20b');
  });

  it('adds a version to the query rather than to the path', () => {
    // The path names the task; the version is a view of it, and keeping it in the
    // query is what lets the tab and the version vary independently.
    expect(urls.task('t1', { version: 3 })).toBe('/tasks/t1?version=3');
  });

  it('adds a tab', () => {
    expect(urls.task('t1', { tab: 'instances' })).toBe('/tasks/t1?tab=instances');
  });

  it('combines a version and a tab', () => {
    expect(urls.task('t1', { version: 3, tab: 'instances' })).toBe('/tasks/t1?version=3&tab=instances');
  });

  it('omits the question mark entirely when there is nothing to put after it', () => {
    // A trailing `?` makes two links to the same page compare unequal, which shows up
    // as a nav item that fails to highlight.
    expect(urls.task('t1', {})).toBe('/tasks/t1');
    expect(urls.task('t1', { version: undefined, tab: undefined })).toBe('/tasks/t1');
  });
});
