import { DEFAULT_PUBLIC_TOKEN, isDefaultPublicToken, LoadConfigOptions, loadConfig, PublicListenerConfig, resolvePaths, ServiceConfig } from '@mini-cloud/service';
import { resolveAgentConfig } from '@mini-cloud/agent';
import { AgentSettings } from '@mini-cloud/shared';
import { Command } from 'commander';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Every default written out, so the file shows what can be set, not what has been. */
function starterConfig(): string {
  const defaults = loadConfig({ configPath: '/nonexistent/config.json', secretPath: '/nonexistent/secret.json' });
  return `${JSON.stringify({ ...withoutToken(defaults), agent: starterAgent() }, null, 2)}\n`;
}

/**
 * The agent's own defaults, from the package that owns them.
 *
 * `id` and `name` are left out: both default to this machine's hostname, and writing
 * that in would turn a value the agent resolves into one the file pins.
 */
function starterAgent(): AgentSettings {
  const { serviceUrl, port, workDir, heartbeatIntervalMs, healthCheckTickMs, passiveToleranceMs, pingFailureThreshold } = resolveAgentConfig({ id: 'placeholder' });
  return { internalUrl: serviceUrl, port, workDir, heartbeatIntervalMs, healthCheckTickMs, passiveToleranceMs, pingFailureThreshold };
}

/** The token came from `secret.json` and must not be written or printed beside settings. */
function withoutToken(config: ServiceConfig): Omit<ServiceConfig, 'public'> & { public: Omit<PublicListenerConfig, 'authToken'> } {
  const { authToken, ...publicConfig } = config.public;
  void authToken;
  return { ...config, public: publicConfig };
}

/** The same shape `openssl rand -hex 32` produces. */
function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * `mode` is honoured by `writeFileSync` only when it creates the file, so an existing
 * `secret.json` at 0644 would silently keep it while we report otherwise.
 */
function write(path: string, contents: string, mode: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, { encoding: 'utf-8' });
  chmodSync(path, mode);
}

/** `--config` off the root program, which is two levels up from a `config` subcommand. */
function configOption(command: Command): LoadConfigOptions {
  const path: unknown = command.parent?.parent?.opts()['config'];
  return typeof path === 'string' ? { configPath: path } : {};
}

export function buildConfigCommand(): Command {
  const config = new Command('config').description('read and write ~/.mini-cloud/config.json and secret.json');

  config
    .command('init')
    .description('write a starter config.json, and a secret.json with a generated token')
    .option('--force', 'overwrite a file that already exists', false)
    .action((options: { force: boolean }, command: Command) => {
      const { configFile, secretFile } = resolvePaths(configOption(command));

      // Each file is considered on its own. Refusing both because one exists left the
      // common case — settings written, token still missing — reachable only through
      // `--force`, which would then overwrite the settings with defaults.
      const written: string[] = [];
      const kept: string[] = [];

      if (!existsSync(configFile) || options.force) {
        write(configFile, starterConfig(), 0o644);
        written.push(`${configFile} (settings, every value at its default)`);
      } else {
        kept.push(configFile);
      }

      if (!existsSync(secretFile) || options.force) {
        write(secretFile, `${JSON.stringify({ publicToken: generateToken() }, null, 2)}\n`, 0o600);
        written.push(`${secretFile} (a generated token, readable only by you)`);
      } else {
        kept.push(secretFile);
      }

      for (const line of written) {
        console.log(`Wrote ${line}`);
      }
      for (const path of kept) {
        console.log(`Kept ${path} (already exists)`);
      }
      if (kept.length > 0 && !options.force) {
        console.log('Pass --force to replace one — it writes defaults over your settings, and a new token logs every browser out.');
      }
      if (written.length > 0) {
        console.log('Restart whatever runs from them to pick them up: mini-cloud daemon restart, mini-cloud agent daemon restart');
      }
    });

  config
    .command('show')
    .description('print the settings in force, and where they came from')
    .action((_options: unknown, command: Command) => {
      const options = configOption(command);
      const { configFile, secretFile } = resolvePaths(options);
      const resolved = loadConfig(options);
      const { authToken } = resolved.public;

      console.log(`# settings: ${configFile}${existsSync(configFile) ? '' : ' (absent — every value below is a default)'}`);
      console.log(`# secret:   ${secretFile}${existsSync(secretFile) ? '' : ' (absent)'}`);
      // Redacted, so this output is as safe to paste as the file it reads.
      console.log(
        `# token:    ${isDefaultPublicToken(authToken) ? `the published default ("${DEFAULT_PUBLIC_TOKEN}") — run \`mini-cloud config init\` to generate your own` : 'set (hidden)'}`,
      );
      console.log(JSON.stringify(withoutToken(resolved), null, 2));
    });

  return config;
}
