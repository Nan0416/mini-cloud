import { Command } from 'commander';
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
 * The unit carries the command and nothing else.
 *
 * Settings live in `~/.mini-cloud/config.json`, which `serve` reads at every start, so
 * there is no configuration to capture here and nothing that can drift between the
 * unit and the file.
 */
function installOptions(enable: boolean): InstallOptions {
  const { logPath } = getDaemonPaths();
  return { programArguments: serviceArgv(['serve']), env: unitEnvironment(), logPath, enable };
}

export function buildDaemonCommand(): Command {
  const daemon = new Command('daemon').description('run the control plane under launchd or systemd, so it survives a logout');

  daemon
    .command('start')
    .description('install the service and start it')
    .option('--no-enable', 'start it now, but do not start it again at login')
    .action((options: { enable: boolean }) => {
      const service = createServiceManager();
      service.install(installOptions(options.enable));
      console.log(`Wrote ${service.unitPath()}`);
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
