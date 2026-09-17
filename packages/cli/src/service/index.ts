import { SystemdServiceManager } from './systemd';
import { LaunchdServiceManager } from './launchd';
import { DaemonUnit, ServiceManager } from './types';

export { buildPlist } from './launchd';
export { buildUnit } from './systemd';
export { unitEnvironment } from './environment';
export { AGENT_UNIT, CONTROL_PLANE_UNIT } from './units';
export * from './types';

export function createServiceManager(unit: DaemonUnit, platform: NodeJS.Platform = process.platform): ServiceManager {
  switch (platform) {
    case 'darwin':
      return new LaunchdServiceManager(unit);
    case 'linux':
      return new SystemdServiceManager(unit);
    default:
      throw new Error(`Running the ${unit.displayName} as a service is not supported on ${platform}. Run it in the foreground with \`${unit.foregroundCommand}\`.`);
  }
}
