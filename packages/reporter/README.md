# @mini-cloud/reporter

Imported by programs [mini-cloud](https://github.com/Nan0416/mini-cloud) launches, to
report their own lifecycle back to the local agent.

The agent spawns tasks **detached**, so that restarting or upgrading the agent does not
take down the services it is supervising. The consequence is that the agent cannot
observe a task's exit itself — so the task reports it. That is what this package is
for.

```bash
npm install @mini-cloud/reporter
```

## Usage

```js
const { TaskReporter } = require('@mini-cloud/reporter');

const reporter = TaskReporter.fromEnvironment();

async function main() {
  // Reports the pid, and starts the heartbeat if the task has a passive health check.
  await reporter?.start();

  await reporter?.log('success', 'warming up');
  await doTheWork();

  await reporter?.reportExit(0);
}

process.on('SIGINT', async () => {
  await shutDownCleanly();
  await reporter?.reportTermination();
  process.exit(0);
});
```

`fromEnvironment()` returns `undefined` when the program was **not** started by
mini-cloud, which is what makes it safe to call unconditionally: the same binary runs
under the scheduler and by hand from a shell, with no flag to remember. That is why
every call above is written `reporter?.`.

## Two promises

**No method ever throws.** A monitoring library that can crash the program it monitors
is worse than no monitoring. An unreachable agent, a rejected report, a timeout, an
unwritable buffer — all of them resolve, and log.

**A report that cannot be delivered is not lost.** It is appended to a local file, one
JSON object per line, and the agent replays it on its next start. That format is
crash-safe: a process killed mid-write loses at most the final partial line. Without
it, an exit that happened during an agent restart would leave the instance showing as
running until a timeout sweep guessed at it.

Heartbeats are the deliberate exception — they are never buffered, because a missed
heartbeat *is* the health check's signal and replaying a stale one later would assert
liveness at a time the task may well have been dead.

## API

| Method | What it does |
| --- | --- |
| `TaskReporter.fromEnvironment()` | Builds a reporter from what the agent injected, or `undefined` when not launched by mini-cloud. |
| `start()` | Reports the pid, and begins the heartbeat when a passive health check is configured. |
| `reportPid()` | Reports the pid on its own. |
| `log(level, payload)` | Adds an entry to the instance's event log. `level` is `success`, `warning` or `error`; the payload is any JSON value. |
| `reportTermination()` | Call from a SIGINT/SIGTERM handler, once shutdown is complete. |
| `reportExit(code?)` | Call just before exiting. A non-zero code marks the instance failed. Defaults to `0`. |
| `stopHeartbeat()` | Stops the passive heartbeat. `reportExit` and `reportTermination` already do this. |

Constructing one directly is also supported, for a program that knows its own identity:

```js
new TaskReporter({ instanceId, agentUrl, offlineReportPath, healthCheckPeriodMs, timeoutMs });
```

## Environment

The agent injects these; `fromEnvironment()` reads them. Nothing else needs setting.

| Variable | Meaning |
| --- | --- |
| `MINI_CLOUD_INSTANCE_ID` | Which run this process is. Required. |
| `MINI_CLOUD_AGENT_URL` | The local agent's loopback address. Required. |
| `MINI_CLOUD_OFFLINE_REPORT_PATH` | Where to buffer reports the agent could not accept. |
| `MINI_CLOUD_HEALTH_CHECK_PERIOD_MS` | Heartbeat interval for a passive health check. Absent disables it. |

The agent injects these *last*, after the task's own `env`, so a task cannot overwrite
its own identity and report against somebody else's instance.

## License

MIT
