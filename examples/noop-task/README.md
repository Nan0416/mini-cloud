# noop — a task that does nothing, on purpose

`noop.js` is the smallest program that exercises the whole reporting path:
`@mini-cloud/reporter` reports its pid, logs a few events, and reports either an exit
code or — when you stop it from the console — its own termination. Use it to watch a
launch move through the UI without a real workload in the way.

It needs the workspace built once, because it imports the reporter's `dist`:

```bash
npm run build            # or just `npm start`, which builds first
node examples/noop-task/noop.js          # runs standalone too; reporting is skipped
```

## Creating it as a repeated job in the console

**Tasks → New task**:

| Field | Value |
| --- | --- |
| Name | `noop` |
| Type | `Job` |
| Working directory | `${HOME}/workplace/mini-cloud/examples/noop-task` |
| Command | `node` |
| Arguments | `noop.js` |
| Environment | `NOOP_RUN_MS=15000`, `NOOP_EVENTS=3`, `NOOP_EXIT_CODE=0` |
| Stdout / Stderr | leave empty — the agent defaults them to `~/.mini-cloud/agent/{stdout,stderr}/<taskId>-<instanceId>.log` |
| Interval | `00:01:00` |
| First launch | now, or a minute out |

Then on the task page: **Target agents** → tick the agent, and turn **Active** on. The
scheduler only launches a job that is active and has at least one target agent.

## Knobs

| Variable | Default | What it does |
| --- | --- | --- |
| `NOOP_RUN_MS` | `15000` | How long the process stays alive. Keep it under the interval. |
| `NOOP_EVENTS` | `3` | Events logged, spread over that time. |
| `NOOP_EXIT_CODE` | `0` | Non-zero lands the instance on `exit_failure`. |

## What each part is for

- **Launch** on the task page runs it once, now — the fastest way to see a green
  instance without waiting for the schedule.
- **Terminate** an instance mid-run and it reports `terminated`, not `exit_success`:
  the script handles SIGINT itself.
- Stop the agent while an instance is running and the reports buffer to
  `~/.mini-cloud/agent/offline-reports.jsonl` instead of being lost.
