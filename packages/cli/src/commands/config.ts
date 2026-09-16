import { configPath, DEFAULT_PUBLIC_TOKEN, isDefaultPublicToken, loadConfig, PublicListenerConfig, secretPath, ServiceConfig } from '@mini-cloud/service';
import { Command } from 'commander';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * A starter `config.json`: every default, written out.
 *
 * Written in full rather than left empty, because a file that shows what can be set is
 * worth far more than one that shows what has been. The values are the defaults, so
 * writing it changes no behaviour — it only makes the behaviour visible and editable.
 */
function starterConfig(): string {
  const defaults = loadConfig({ configPath: '/nonexistent', secretPath: '/nonexistent' });
  return `${JSON.stringify(withoutToken(defaults), null, 2)}\n`;
}

/**
 * The settings, minus the credential.
 *
 * `ServiceConfig` carries the token because that is what the listener needs, but it
 * came from `secret.json` and must not be written back into — or printed beside —
 * `config.json`, which is the one people share.
 */
function withoutToken(config: ServiceConfig): Omit<ServiceConfig, 'public'> & { public: Omit<PublicListenerConfig, 'authToken'> } {
  const { authToken, ...publicConfig } = config.public;
  void authToken;
  return { ...config, public: publicConfig };
}

/** 32 random bytes, the same shape `openssl rand -hex 32` produces. */
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

      // 0644: settings are meant to be readable, and the whole point of the split is
      // that this file can be handed to someone without thinking about it.
      write(settings, starterConfig(), 0o644);
      // 0600: this one is the credential.
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
      // Redacted, so the output of this command is as safe to paste as the file it
      // reads — which is the entire reason the token lives in a different file.
      console.log(
        `# token:    ${isDefaultPublicToken(authToken) ? `the published default ("${DEFAULT_PUBLIC_TOKEN}") — run \`mini-cloud config init\` to generate your own` : 'set (hidden)'}`,
      );
      console.log(JSON.stringify(withoutToken(resolved), null, 2));
    });

  return config;
}
