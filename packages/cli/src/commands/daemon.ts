import { Command } from 'commander';
import { resolve } from 'node:path';
import { getDaemonPaths } from '../paths';
import { serviceArgv } from '../self-exec';
import { createServiceManager, InstallOptions, ServiceStatus, unitEnvironment } from '../service';
import { parsePositiveInteger } from '../args';

function describe(status: ServiceStatus): string {
  switch (status.state) {
    case 'not-installed':
      return 'mini-cloud daemon: not installed';
    case 'stopped':
      return `mini-cloud daemon: stopped${status.enabled === true ? ' (starts at login)' : ''}`;
    case 'running': {
      const details = [status.pid === undefined ? undefined : `pid ${status.pid}`, status.enabled === true ? 'starts at login' : undefined].filter(
        (detail): detail is string => detail !== undefined,
      );
      return `mini-cloud daemon: running${details.length > 0 ? ` (${details.join(', ')})` : ''}`;
    }
  }
}

/**
 * The unit carries the command and the config file it was installed with, and nothing
 * else. Settings live in the file, so nothing here can drift against it — but *which*
 * file has to travel with the unit, or a daemon installed with `--config` would
 * supervise the default instance instead.
 */
function installOptions(enable: boolean, configFile: string | undefined): InstallOptions {
  const { logPath } = getDaemonPaths();
  const serve = configFile === undefined ? ['serve'] : ['--config', configFile, 'serve'];
  return { programArguments: serviceArgv(serve), env: unitEnvironment(), logPath, enable };
}

/** `--config` off the root program, resolved so the unit does not depend on a cwd. */
function configFileOption(command: Command): string | undefined {
  const path: unknown = command.parent?.parent?.opts()['config'];
  return typeof path === 'string' ? resolve(path) : undefined;
}

export function buildDaemonCommand(): Command {
  const daemon = new Command('daemon').description('run the control plane under launchd or systemd, so it survives a logout');

  daemon
    .command('start')
    .description('install the service and start it')
    .option('--no-enable', 'start it now, but do not start it again at login')
    .action((options: { enable: boolean }, command: Command) => {
      const service = createServiceManager();
      const configFile = configFileOption(command);
      service.install(installOptions(options.enable, configFile));
      console.log(`Wrote ${service.unitPath()}`);
      if (configFile !== undefined) {
        console.log(`Reading ${configFile}, and the secret.json beside it.`);
      }
      console.log(describe(service.status()));
      console.log('Logs: mini-cloud daemon logs -f');
    });

  daemon
    .command('stop')
    .description('stop the service, leaving it installed')
    .action(() => {
      createServiceManager().stop();
      console.log('Stopped the mini-cloud daemon.');
    });

  daemon
    .command('restart')
    .description('restart the service')
    .action(() => {
      const service = createServiceManager();
      if (!service.isInstalled()) {
        throw new Error('The mini-cloud daemon is not installed. Run `mini-cloud daemon start` first.');
      }
      service.restart();
      console.log(describe(service.status()));
    });

  daemon
    .command('status')
    .description('whether the service is installed, running, and set to start at login')
    .action(() => {
      console.log(describe(createServiceManager().status()));
    });

  daemon
    .command('logs')
    .description('show what the daemon has been writing')
    .option('-f, --follow', 'keep printing as it writes', false)
    .option('-n, --lines <count>', 'how many trailing lines to show first', (value) => parsePositiveInteger(value, 'lines'), 200)
    .action((options: { follow: boolean; lines: number }) => {
      createServiceManager().logs({ follow: options.follow, lines: options.lines });
    });

  daemon
    .command('uninstall')
    .description('stop the service and remove the unit')
    .action(() => {
      const service = createServiceManager();
      const path = service.unitPath();
      service.uninstall();
      console.log(`Uninstalled the mini-cloud daemon (${path}).`);
    });

  return daemon;
}
