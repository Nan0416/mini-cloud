import { SystemdServiceManager } from './systemd';
import { LaunchdServiceManager } from './launchd';
import { ServiceManager } from './types';

export { buildPlist, LAUNCHD_LABEL } from './launchd';
export { buildUnit, SYSTEMD_UNIT } from './systemd';
export { unitEnvironment } from './environment';
export * from './types';

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
