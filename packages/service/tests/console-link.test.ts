import { consoleLink } from '../src/utils/console-link';

const CONSOLE = 'https://mini-cloud.example.com';

describe('consoleLink', () => {
  it('points the console at this service, percent-encoded', () => {
    expect(consoleLink({ consoleUrl: CONSOLE, host: '127.0.0.1', port: 3000 })).toBe('https://mini-cloud.example.com/?backend=http%3A%2F%2F127.0.0.1%3A3000');
  });

  it('offers loopback whenever loopback reaches the service', () => {
    // Bound to everything includes loopback, so the same link works.
    for (const host of ['127.0.0.1', 'localhost', '::1', '0.0.0.0', '::']) {
      expect(consoleLink({ consoleUrl: CONSOLE, host, port: 3000 })).toContain('127.0.0.1%3A3000');
    }
  });

  it('prints nothing when bound to one interface, because no address would work', () => {
    // 127.0.0.1 does not reach a service listening only on 192.168.1.50, and that
    // address is plain HTTP, which an HTTPS console may not call at all.
    expect(consoleLink({ consoleUrl: CONSOLE, host: '192.168.1.50', port: 3000 })).toBeUndefined();
    expect(consoleLink({ consoleUrl: CONSOLE, host: '10.0.0.4', port: 3000 })).toBeUndefined();
  });

  it('prints nothing when the console url is emptied, which is the way to switch it off', () => {
    expect(consoleLink({ consoleUrl: '', host: '127.0.0.1', port: 3000 })).toBeUndefined();
    expect(consoleLink({ consoleUrl: '   ', host: '127.0.0.1', port: 3000 })).toBeUndefined();
  });

  it('does not double the slash when the console url carries one', () => {
    expect(consoleLink({ consoleUrl: 'https://console.example.com/', host: '127.0.0.1', port: 3000 })).toBe('https://console.example.com/?backend=http%3A%2F%2F127.0.0.1%3A3000');
  });

  it('carries the port actually bound, which is what :0 in a test makes differ', () => {
    expect(consoleLink({ consoleUrl: CONSOLE, host: '127.0.0.1', port: 54321 })).toContain('%3A54321');
  });
});
