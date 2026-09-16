import { SystemdServiceManager } from './systemd';
import { LaunchdServiceManager } from './launchd';
import { ServiceManager } from './types';

export { buildPlist, LAUNCHD_LABEL } from './launchd';
export { buildUnit, SYSTEMD_UNIT } from './systemd';
export { unitEnvironment } from './environment';
export * from './types';

/**
 * The supervisor for this platform.
 *
 * Throws where there is none rather than pretending: Windows has its own service
 * model and nobody has written that yet, and `mini-cloud serve` in a terminal still
 * works everywhere.
 */
export function createServiceManager(platform: NodeJS.Platform = process.platform): ServiceManager {
  switch (platform) {
    case 'darwin':
      return new LaunchdServiceManager();
    case 'linux':
      return new SystemdServiceManager();
    default:
      throw new Error(`Running as a service is not supported on ${platform}. Start the control plane in the foreground with \`mini-cloud serve\`.`);
  }
}
