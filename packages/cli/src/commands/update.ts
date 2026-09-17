import { InvalidRequestError } from '@mini-cloud/shared';
import { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { isSeaBinary } from '../self-exec';
import { AGENT_UNIT, CONTROL_PLANE_UNIT, createServiceManager } from '../service';
import { ReleaseChannel } from '../update/release-channel';
import { compareVersions } from '../update/semver';
import { cliVersion } from '../version';
import type { ServiceManagerFactory } from './daemon';

export interface Releases {
  latestVersion(): Promise<string>;
  install(version: string): Promise<void>;
}

export interface UpdateDependencies {
  readonly releases: Releases;
  readonly currentVersion: () => string;
  readonly isBinary: () => boolean;
  readonly confirm: (question: string) => Promise<boolean>;
  readonly managers: ServiceManagerFactory;
}

async function confirmOnTerminal(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new InvalidRequestError('There is no terminal to ask whether to install. Pass --yes to install without asking.');
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`${question} [y/N] `);
    return ['y', 'yes'].includes(answer.trim().toLowerCase());
  } finally {
    prompt.close();
  }
}

const DEFAULT_DEPENDENCIES: UpdateDependencies = {
  releases: new ReleaseChannel(),
  currentVersion: cliVersion,
  isBinary: isSeaBinary,
  confirm: confirmOnTerminal,
  managers: createServiceManager,
};

/** A daemon keeps running the binary it started from until it is restarted. */
function runningDaemonHints(managers: ServiceManagerFactory, version: string): ReadonlyArray<string> {
  return [CONTROL_PLANE_UNIT, AGENT_UNIT].flatMap((unit) => {
    try {
      return managers(unit).status().state === 'running' ? [`The ${unit.displayName} daemon is still on the old binary. \`${unit.command} restart\` moves it to ${version}.`] : [];
    } catch {
      return [];
    }
  });
}

export function buildUpdateCommand(deps: UpdateDependencies = DEFAULT_DEPENDENCIES): Command {
  return new Command('update')
    .description('replace this binary with the latest release')
    .option('--check', 'only say whether there is a newer release', false)
    .option('-y, --yes', 'install without asking', false)
    .action(async (options: { check: boolean; yes: boolean }) => {
      if (!deps.isBinary()) {
        throw new InvalidRequestError('This mini-cloud runs from a checkout, which updates with `git pull` and `npm run build`. `update` is for the installed binary.');
      }
      const current = deps.currentVersion();
      const latest = await deps.releases.latestVersion();
      const order = compareVersions(latest, current);
      if (order <= 0) {
        console.log(order === 0 ? `mini-cloud ${current} is the latest release.` : `mini-cloud ${current} is newer than the latest release, ${latest}.`);
        return;
      }

      console.log(`mini-cloud ${latest} is available; this is ${current}.`);
      if (options.check) {
        console.log('Run `mini-cloud update` to install it.');
        return;
      }
      if (!options.yes && !(await deps.confirm(`Install ${latest}?`))) {
        console.log('Nothing was installed.');
        return;
      }

      await deps.releases.install(latest);
      for (const hint of runningDaemonHints(deps.managers, latest)) {
        console.log(hint);
      }
    });
}
