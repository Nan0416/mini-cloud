import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PUBLIC_TOKEN, isDefaultPublicToken, loadConfig, type ServiceConfig } from '../src/config';

/**
 * Configuration is files now, not the environment.
 *
 * The change that motivated it: a daemon inherits no shell. launchd and systemd read no
 * profile, so environment configuration had to be captured into the unit at install
 * time — which made the unit a second copy of the settings, stale the moment anything
 * changed and correctable only by reinstalling it. A file read at startup is the same
 * file however the process was started.
 *
 * So these cases write real files into a temporary directory rather than setting
 * variables. `loadConfig` takes both paths, which is also what `--config` uses.
 */
const workspace = mkdtempSync(join(tmpdir(), 'mini-cloud-config-'));
let counter = 0;

const loadWith = (settings?: unknown, secrets?: unknown): ServiceConfig => {
  counter += 1;
  const configPath = join(workspace, `config-${counter}.json`);
  const secretPath = join(workspace, `secret-${counter}.json`);
  if (settings !== undefined) {
    writeFileSync(configPath, typeof settings === 'string' ? settings : JSON.stringify(settings));
  }
  if (secrets !== undefined) {
    writeFileSync(secretPath, typeof secrets === 'string' ? secrets : JSON.stringify(secrets));
  }
  return loadConfig({ configPath, secretPath });
};

describe('defaults', () => {
  it('runs with no files at all, so the first five minutes need no setup', () => {
    // A control plane that will not start until it is configured is a worse first five
    // minutes than one that starts on sane defaults and says what they are.
    expect(() => loadWith()).not.toThrow();
  });

  it('binds both listeners to loopback, because exposing either must be deliberate', () => {
    const config = loadWith();

    // It commands processes on your machines. Listening on 0.0.0.0 by default would
    // make a laptop on an untrusted network an open remote-execution endpoint — and
    // for the public listener it would make opening the router the only step needed.
    expect(config.internal).toMatchObject({ host: '127.0.0.1', port: 3000 });
    expect(config.public).toMatchObject({ host: '127.0.0.1', port: 3001 });
  });

  it('keeps the agent-facing listener on the port agents already use', () => {
    expect(loadWith().internal.port).toBe(3000);
    expect(loadWith().internal.port).not.toBe(loadWith().public.port);
  });

  it('trusts loopback and the private ranges a home network uses', () => {
    const { trustedSubnets } = loadWith().internal;

    expect(trustedSubnets).toContain('192.168.0.0/16');
    expect(trustedSubnets).toContain('10.0.0.0/8');
    // IPv6 is not optional on a modern home LAN: a device that picks it would be
    // refused by an allow-list written only in IPv4.
    expect(trustedSubnets).toContain('fc00::/7');
  });

  it('points at the local database, and allows any console origin', () => {
    expect(loadWith().databaseUrl).toBe('postgres://localhost:5432/mini_cloud');
    expect(loadWith().public.corsOrigins).toEqual(['*']);
  });

  it('sets scheduler intervals that keep the job tick at or below the minimum interval', () => {
    const { scheduler } = loadWith();

    expect(scheduler.jobTickMs).toBe(1_000);
    expect(scheduler.jobTickMs).toBeLessThanOrEqual(5_000);
    // One slow tick must not flap an agent offline and straight back on.
    expect(scheduler.agentOfflineAfterMs / scheduler.maintenanceTickMs).toBe(3);
    // Acknowledging is a socket write; starting can mean loading a large model.
    expect(scheduler.launchTimeoutMs).toBe(15_000);
    expect(scheduler.startTimeoutMs).toBe(60_000);
  });

  it('points the CLI at the public listener, not the internal one', () => {
    // The internal listener answers a task command with a 404 that says so, which is a
    // confusing first experience for a default to hand out.
    expect(loadWith().cli).toEqual({ serviceUrl: 'http://127.0.0.1:3001', internalUrl: 'http://127.0.0.1:3000' });
  });
});

describe('settings', () => {
  it('takes values from the file', () => {
    const config = loadWith({ databaseUrl: 'postgres://db/mc', internal: { host: '192.168.1.50', port: 4000 }, public: { port: 8080 } });

    expect(config.databaseUrl).toBe('postgres://db/mc');
    expect(config.internal).toMatchObject({ host: '192.168.1.50', port: 4000 });
    expect(config.public.port).toBe(8080);
  });

  it('leaves everything unmentioned at its default', () => {
    // A partial file is the normal case: someone sets a port and expects the other
    // eleven values to keep working.
    const config = loadWith({ public: { port: 8080 } });

    expect(config.public.host).toBe('127.0.0.1');
    expect(config.internal.port).toBe(3000);
  });

  it('replaces a list rather than adding to it', () => {
    // Naming origins has to genuinely narrow the service. Appending to the `*` default
    // would leave it wide open while looking restricted.
    const config = loadWith({ public: { corsOrigins: ['http://localhost:5173'] } });

    expect(config.public.corsOrigins).toEqual(['http://localhost:5173']);
    expect(config.public.corsOrigins).not.toContain('*');
  });

  it('honours an empty list as "no check at all"', () => {
    // The distinction JSON gets right and the environment never could: `[]` and absent
    // are different values, so the documented way to switch a check off no longer
    // collapses into the way to keep it on.
    expect(loadWith({ public: { corsOrigins: [] } }).public.corsOrigins).toEqual([]);
    expect(loadWith({ internal: { trustedSubnets: [] } }).internal.trustedSubnets).toEqual([]);
  });

  it('refuses a value of the wrong type, naming the setting', () => {
    // JSON has types, so `"port": "3000"` is a mistake that can be caught here rather
    // than becoming NaN somewhere inside `listen()`.
    expect(() => loadWith({ internal: { port: '3000' } })).toThrow(/internal\.port must be a whole number/);
    expect(() => loadWith({ public: { corsOrigins: 'http://localhost' } })).toThrow(/public\.corsOrigins must be an array of strings/);
    expect(() => loadWith({ internal: 'nope' })).toThrow(/internal must be an object/);
  });

  it('separates "no file" from "cannot read that file"', () => {
    // The distinction this turns on is structural, not `instanceof Error` — Jest builds
    // core fs errors in another vm realm, so an `instanceof` check reports false for
    // every one of them and quietly reclassifies a missing file as an unreadable one.
    // Absent must give defaults; a directory where a file should be must not.
    expect(() => loadConfig({ configPath: join(workspace, 'nothing-here.json'), secretPath: join(workspace, 'nor-here.json') })).not.toThrow();
    expect(() => loadConfig({ configPath: workspace })).toThrow(/Could not read/);
  });

  it('refuses a file it cannot parse rather than falling back to defaults', () => {
    // The most important failure in the file. Treating a broken file as absent would
    // start the service on defaults — wrong port, wrong address — and look identical to
    // the settings being ignored.
    expect(() => loadWith('{ "databaseUrl": ')).toThrow(/is not valid JSON/);
    expect(() => loadWith('[1, 2, 3]')).toThrow(/must contain a JSON object/);
  });
});

describe('the token', () => {
  it('comes from secret.json', () => {
    expect(loadWith({}, { publicToken: 'a-real-secret' }).public.authToken).toBe('a-real-secret');
  });

  it('falls back to the published default when there is no secret file', () => {
    expect(loadWith().public.authToken).toBe(DEFAULT_PUBLIC_TOKEN);
    expect(isDefaultPublicToken(loadWith().public.authToken)).toBe(true);
  });

  it('is never read out of config.json, however plausibly it is spelled there', () => {
    // The split is only worth having if it is enforced. Accepting a token in the
    // settings file would make `config.json` unsafe to share exactly when someone had
    // been told it was safe.
    const config = loadWith({ publicToken: 'leaked', public: { authToken: 'also-leaked' } });

    expect(config.public.authToken).toBe(DEFAULT_PUBLIC_TOKEN);
  });

  it('treats an empty token as absent, because that is what an unfinished edit leaves', () => {
    expect(loadWith({}, { publicToken: '' }).public.authToken).toBe(DEFAULT_PUBLIC_TOKEN);
    expect(loadWith({}, { publicToken: '   ' }).public.authToken).toBe(DEFAULT_PUBLIC_TOKEN);
  });

  it('trims it, so a value pasted with a newline is the one the console sends', () => {
    expect(loadWith({}, { publicToken: '  a-real-secret\n' }).public.authToken).toBe('a-real-secret');
  });

  it('calls a hand-typed copy of the default what it is', () => {
    // The risk is the value being guessable, not where it came from.
    expect(isDefaultPublicToken(loadWith({}, { publicToken: DEFAULT_PUBLIC_TOKEN }).public.authToken)).toBe(true);
    expect(isDefaultPublicToken(loadWith({}, { publicToken: 'a-real-secret' }).public.authToken)).toBe(false);
  });
});

describe('importing', () => {
  it('reads nothing at import, so no CLI command depends on a well-formed config file', () => {
    // The CLI imports this package for every command. A module-level read would make
    // `mini-cloud --help` fail on a config file with a stray comma in it.
    expect(() => require('../src/config')).not.toThrow();
  });
});
