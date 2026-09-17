import { NotFoundError, PortInUseError } from '@mini-cloud/shared';
import { Command } from 'commander';
import { resolve } from 'node:path';
import { parsePositiveInteger } from '../args';
import { serviceArgv } from '../self-exec';
import { createServiceManager, DaemonUnit, InstallOptions, ServiceManager, ServiceStatus, unitEnvironment } from '../service';

export type ServiceManagerFactory = (unit: DaemonUnit) => ServiceManager;

function describe(unit: DaemonUnit, status: ServiceStatus): string {
  const name = `mini-cloud ${unit.displayName} daemon`;
  switch (status.state) {
    case 'not-installed':
      return `${name}: not installed`;
    case 'stopped':
      return `${name}: stopped${status.enabled === true ? ' (starts at login)' : ''}`;
    case 'running': {
      const details = [status.pid === undefined ? undefined : `pid ${status.pid}`, status.enabled === true ? 'starts at login' : undefined].filter(
        (detail): detail is string => detail !== undefined,
      );
      return `${name}: running${details.length > 0 ? ` (${details.join(', ')})` : ''}`;
    }
  }
}

/**
 * The unit carries the command and the config file it was installed with, and nothing
 * else. Settings live in the file, so nothing here can drift against it — but *which*
 * file has to travel with the unit, or a daemon installed with `--config` would
 * supervise the default instance instead.
 */
function installOptions(unit: DaemonUnit, enable: boolean, configFile: string | undefined): InstallOptions {
  const subcommand = configFile === undefined ? unit.subcommand : ['--config', configFile, ...unit.subcommand];
  return { programArguments: serviceArgv(subcommand), env: unitEnvironment(unit.environmentKeys), enable };
}

/**
 * `--config` off the root program, resolved so the unit does not depend on a cwd. Read
 * with `optsWithGlobals`: each unit's group sits at a different depth.
 */
function configFileOption(command: Command): string | undefined {
  const path: unknown = command.optsWithGlobals()['config'];
  return typeof path === 'string' ? resolve(path) : undefined;
}

function installed(unit: DaemonUnit, service: ServiceManager): ServiceManager {
  if (!service.isInstalled()) {
    throw new NotFoundError(`The mini-cloud ${unit.displayName} daemon is not installed. Run \`${unit.command} start\` first.`);
  }
  return service;
}

/**
 * Names the daemon when a start in the foreground finds its port taken and the daemon
 * is running. Not when the port is known to be some other program's, and not unless the
 * daemon is known to be another process: one that lost its port to a copy started by
 * hand should not point at itself.
 */
export function explainPortConflict(err: unknown, unit: DaemonUnit, managers: ServiceManagerFactory = createServiceManager): unknown {
  if (!(err instanceof PortInUseError) || err.occupant === 'other') {
    return err;
  }
  let status: ServiceStatus;
  try {
    status = managers(unit).status();
  } catch {
    return err;
  }
  if (status.state !== 'running' || status.pid === undefined || status.pid === process.pid) {
    return err;
  }
  return new PortInUseError(
    `${err.message}\nThe mini-cloud ${unit.displayName} daemon is running (pid ${status.pid}) and most likely holds it. Run \`${unit.command} stop\` first to use this one in the foreground.`,
    err.occupant,
  );
}

export function buildDaemonCommand(unit: DaemonUnit, managers: ServiceManagerFactory = createServiceManager): Command {
  const daemon = new Command('daemon').description(`run the ${unit.displayName} under launchd or systemd, so it survives a logout and a crash`);

  daemon
    .command('start')
    .description('install the service and start it')
    .option('--no-enable', 'start it now, but do not start it again at login')
    .action((options: { enable: boolean }, command: Command) => {
      const service = managers(unit);
      const configFile = configFileOption(command);
      service.install(installOptions(unit, options.enable, configFile));
      console.log(`Wrote ${service.unitPath()}`);
      if (configFile !== undefined) {
        console.log(`Reading ${configFile}, and the secret.json beside it.`);
      }
      console.log(describe(unit, service.status()));
      const bootWarning = options.enable ? service.bootWarning() : undefined;
      if (bootWarning !== undefined) {
        console.log(bootWarning);
      }
      console.log(`Logs: ${unit.command} logs -f`);
    });

  daemon
    .command('stop')
    .description('stop the service, leaving it installed')
    .action(() => {
      installed(unit, managers(unit)).stop();
      console.log(`Stopped the mini-cloud ${unit.displayName} daemon.${unit.launchesTasks ? ' Tasks it launched keep running.' : ''}`);
    });

  daemon
    .command('restart')
    .description('restart the service')
    .action(() => {
      const service = installed(unit, managers(unit));
      service.restart();
      console.log(describe(unit, service.status()));
    });

  daemon
    .command('status')
    .description('whether the service is installed, running, and set to start at login')
    .action(() => {
      console.log(describe(unit, managers(unit).status()));
    });

  daemon
    .command('logs')
    .description('show what the daemon has been writing')
    .option('-f, --follow', 'keep printing as it writes', false)
    .option('-n, --lines <count>', 'how many trailing lines to show first', (value) => parsePositiveInteger(value, 'lines'), 200)
    .action((options: { follow: boolean; lines: number }) => {
      managers(unit).logs({ follow: options.follow, lines: options.lines });
    });

  daemon
    .command('uninstall')
    .description('stop the service and remove the unit')
    .action(() => {
      const service = managers(unit);
      const path = service.unitPath();
      service.uninstall();
      console.log(`Uninstalled the mini-cloud ${unit.displayName} daemon (${path}).`);
    });

  return daemon;
}
