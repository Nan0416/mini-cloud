#!/usr/bin/env node
'use strict';

/**
 * A task that does nothing, on purpose.
 *
 * It is the smallest program that walks the whole reporting path — pid, events,
 * termination, exit — so you can watch a launch move through the console without a
 * real workload muddying what you are looking at.
 *
 * `TaskReporter.fromEnvironment()` returns undefined when mini-cloud did not launch
 * the program, so the same file also runs by hand (`node noop.js`) as a smoke test
 * of nothing but itself.
 *
 * Knobs, all read from the task's `env` in the console:
 *
 *   NOOP_RUN_MS     how long to stay alive, in ms          (default 15000)
 *   NOOP_EVENTS     events logged, spread over that time   (default 3)
 *   NOOP_EXIT_CODE  code to exit with                      (default 0)
 *
 * Set NOOP_EXIT_CODE to something non-zero to see an instance land on
 * `exit_failure` instead of `exit_success`.
 */

const os = require('node:os');

// Only the reporter, so this file stays copy-pasteable into a program that is not in
// this repo. The identity variables below are `REPORTER_ENV` in @mini-cloud/shared.
const { TaskReporter } = require('@mini-cloud/reporter');

function envInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

const RUN_MS = Math.max(0, envInteger('NOOP_RUN_MS', 15_000));
const EVENTS = Math.max(0, envInteger('NOOP_EVENTS', 3));
const EXIT_CODE = envInteger('NOOP_EXIT_CODE', 0);

const IDENTITY = {
  instanceId: process.env['MINI_CLOUD_INSTANCE_ID'],
  taskId: process.env['MINI_CLOUD_TASK_ID'],
  taskVersion: process.env['MINI_CLOUD_TASK_VERSION'],
  agentId: process.env['MINI_CLOUD_AGENT_ID'],
  host: os.hostname(),
  pid: process.pid,
};

/** Goes to the task's stdout file, which is the half of this you can read on the box. */
function say(message) {
  console.log(`[${new Date().toISOString()}] noop: ${message}`);
}

let shuttingDown = false;
// Replaced for the duration of each nap. A terminate from the console arrives as
// SIGINT, and waking the nap is what lets this report its own termination rather
// than being killed mid-sleep and leaving the instance to time out.
let wake = () => {};

function nap(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

async function main() {
  const reporter = TaskReporter.fromEnvironment();
  if (reporter === undefined) {
    say('not launched by mini-cloud — reporting is disabled, running anyway');
  } else {
    say(`reporting instance ${IDENTITY.instanceId} to the agent at ${process.env['MINI_CLOUD_AGENT_URL']}`);
    // Reports the pid, which is what moves the instance from `launched` to `running`,
    // and starts the passive heartbeat if the task asked for one.
    await reporter.start();
    await reporter.log('success', { message: 'noop started', ...IDENTITY, runMs: RUN_MS, events: EVENTS, exitCode: EXIT_CODE });
  }

  say(`staying alive for ${RUN_MS}ms, logging ${EVENTS} event(s), then exiting ${EXIT_CODE}`);

  const startedAt = Date.now();
  const step = EVENTS > 0 ? Math.floor(RUN_MS / EVENTS) : RUN_MS;

  for (let index = 1; index <= EVENTS && !shuttingDown; index += 1) {
    await nap(step);
    if (shuttingDown) {
      break;
    }
    const elapsedMs = Date.now() - startedAt;
    say(`tick ${index}/${EVENTS} at ${elapsedMs}ms`);
    if (reporter !== undefined) {
      // Cycling the level gives the console's event filter something to sort on.
      const level = index === EVENTS ? 'success' : index % 2 === 0 ? 'warning' : 'success';
      await reporter.log(level, { message: `noop tick ${index} of ${EVENTS}`, elapsedMs, instanceId: IDENTITY.instanceId });
    }
  }

  // Whatever the integer division left over, so NOOP_RUN_MS means what it says.
  const remainingMs = RUN_MS - (Date.now() - startedAt);
  if (!shuttingDown && remainingMs > 0) {
    await nap(remainingMs);
  }

  if (shuttingDown) {
    say('terminated');
    // Termination and exit share a status rank, so reporting both would overwrite
    // `terminated` with `exit_success` and lose the fact that someone stopped it.
    await reporter?.reportTermination();
    return 0;
  }

  say(`done after ${Date.now() - startedAt}ms, exiting ${EXIT_CODE}`);
  await reporter?.log(EXIT_CODE === 0 ? 'success' : 'error', { message: 'noop finished', exitCode: EXIT_CODE, elapsedMs: Date.now() - startedAt });
  await reporter?.reportExit(EXIT_CODE);
  return EXIT_CODE;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    say(`received ${signal}`);
    wake();
  });
}

main()
  .then((code) => {
    // Not process.exit(): letting the loop drain means the last report is on the wire
    // before the process is gone.
    process.exitCode = code;
  })
  .catch(async (err) => {
    say(`failed: ${err instanceof Error ? err.stack : String(err)}`);
    const reporter = TaskReporter.fromEnvironment();
    await reporter?.log('error', { message: 'noop failed', error: String(err) });
    await reporter?.reportExit(1);
    process.exitCode = 1;
  });
