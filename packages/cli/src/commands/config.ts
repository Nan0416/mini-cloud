import { configPath, DEFAULT_PUBLIC_TOKEN, isDefaultPublicToken, loadConfig, PublicListenerConfig, secretPath, ServiceConfig } from '@mini-cloud/service';
import { resolveAgentConfig } from '@mini-cloud/agent';
import { AgentSettings } from '@mini-cloud/shared';
import { Command } from 'commander';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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

function write(path: string, contents: string, mode: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, { encoding: 'utf-8', mode });
}

export function buildConfigCommand(): Command {
  const config = new Command('config').description('read and write ~/.mini-cloud/config.json and secret.json');

  config
    .command('init')
    .description('write a starter config.json and a secret.json with a generated token')
    .option('--force', 'overwrite files that already exist', false)
    .action((options: { force: boolean }) => {
      const settings = configPath();
      const secrets = secretPath();

      for (const path of [settings, secrets]) {
        if (existsSync(path) && !options.force) {
          throw new Error(`${path} already exists. Pass --force to overwrite it — but read it first: --force on secret.json rotates your token and logs every browser out.`);
        }
      }

      write(settings, starterConfig(), 0o644);
      write(secrets, `${JSON.stringify({ publicToken: generateToken() }, null, 2)}\n`, 0o600);

      console.log(`Wrote ${settings} (settings, every value at its default)`);
      console.log(`Wrote ${secrets} (a generated token, readable only by you)`);
      console.log('Restart the control plane to pick them up: mini-cloud daemon restart');
    });

  config
    .command('show')
    .description('print the settings in force, and where they came from')
    .action((_options: unknown, command: Command) => {
      const override: unknown = command.parent?.parent?.opts()['config'];
      const settings = typeof override === 'string' ? override : configPath();
      const resolved = loadConfig(typeof override === 'string' ? { configPath: override } : {});
      const { authToken } = resolved.public;

      console.log(`# settings: ${settings}${existsSync(settings) ? '' : ' (absent — every value below is a default)'}`);
      console.log(`# secret:   ${secretPath()}${existsSync(secretPath()) ? '' : ' (absent)'}`);
      // Redacted, so this output is as safe to paste as the file it reads.
      console.log(
        `# token:    ${isDefaultPublicToken(authToken) ? `the published default ("${DEFAULT_PUBLIC_TOKEN}") — run \`mini-cloud config init\` to generate your own` : 'set (hidden)'}`,
      );
      console.log(JSON.stringify(withoutToken(resolved), null, 2));
    });

  return config;
}
