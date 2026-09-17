import { INHERITED_ENV_KEYS } from '@mini-cloud/agent';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DaemonUnit } from './types';

const DATA_DIR = join(homedir(), '.mini-cloud');

export const CONTROL_PLANE_UNIT: DaemonUnit = {
  displayName: 'control plane',
  command: 'mini-cloud daemon',
  subcommand: ['serve'],
  // Reverse-DNS, matching the domain the console is served from.
  launchdLabel: 'dev.qinnan.mini-cloud',
  systemdUnit: 'mini-cloud.service',
  logPath: join(DATA_DIR, 'service', 'service.log'),
  environmentKeys: ['HOME', 'PATH'],
  launchesTasks: false,
};

export const AGENT_UNIT: DaemonUnit = {
  displayName: 'agent',
  command: 'mini-cloud agent daemon',
  subcommand: ['agent', 'start'],
  launchdLabel: 'dev.qinnan.mini-cloud.agent',
  systemdUnit: 'mini-cloud-agent.service',
  logPath: join(DATA_DIR, 'agent', 'agent.log'),
  // Everything a task inherits, so a task behaves the same under the daemon as it did
  // in the terminal the daemon was installed from.
  environmentKeys: INHERITED_ENV_KEYS,
  launchesTasks: true,
};
