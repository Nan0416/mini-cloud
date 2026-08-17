# mini-cloud

![PR workflow](https://github.com/Nan0416/mini-cloud/actions/workflows/pr.yml/badge.svg)

Turn the computers you already own into a small private cloud — schedule work across
them, watch it run, and get told when it breaks. No hosting bill, no external
dependency, one command to start.

```
mini-cloud serve                          # the control plane
mini-cloud agent start --id laptop-1      # on each machine that should run work
mini-cloud task create --name backup --cmd ./backup.sh --every 1d
```

## What it does

**Runs programs on a schedule, across machines.** A *job* runs to completion on an
interval; a *service* stays up and is health-checked. Both are ordinary programs —
mini-cloud does not ask you to package anything.

**Watches what it started.** Every launch becomes an *instance* with a status and an
event log, so "did last night's backup run?" is one command, not a hunt through logs.

**Carries messages.** A topic-based pub/sub hub the service uses to reach agents, and
that your own programs can use too.

## How it fits together

```
  CLI ──HTTP──▶ ┌──────────────────────────────┐
                │  service                     │
                │  • task + instance store     │──▶ PostgreSQL
                │  • scheduler                 │
                │  • pub/sub hub (WebSocket)   │
                └──────────────────────────────┘
                    │  commands            ▲  reports
                    │  (WebSocket)         │  (HTTP)
                    ▼                      │
                ┌──────────────────────────────┐
                │  agent (one per machine)     │
                │  • spawns processes          │
                │  • health checks             │
                └──────────────────────────────┘
                    │ spawns          ▲ reports pid / exit / logs
                    ▼                 │
                  your program ───────┘   (optional: @mini-cloud/reporter)
```

Commands travel out over WebSocket because they are one-way and need push delivery.
Reports come back over HTTP because they need an acknowledgement the agent can retry.

An agent spawns tasks **detached**, so restarting or upgrading an agent never takes
down the services it supervises. The cost is that the agent cannot observe an exit
itself, which is why a task that wants accurate lifecycle tracking imports
`@mini-cloud/reporter`. Without it, a task still runs — you just see less.

## Packages

| Package | What it is |
| --- | --- |
| `@mini-cloud/shared` | Domain models, API contracts, errors, utilities |
| `@mini-cloud/service` | Control plane: HTTP API, pub/sub hub, scheduler, Postgres |
| `@mini-cloud/client` | Typed HTTP + WebSocket client |
| `@mini-cloud/agent` | Worker process for each machine |
| `@mini-cloud/reporter` | Imported by launched programs to report their own lifecycle |
| `@mini-cloud/cli` | The `mini-cloud` command |

## Getting started

See [dev.md](./dev.md) for setup, and [md/GUIDELINES.md](./md/GUIDELINES.md) for the
conventions the code follows.

```bash
npm install
createdb mini_cloud_beta    # one-time; see dev.md for installing PostgreSQL
npm start                   # builds, applies the schema, starts the control plane
```

Then, in another terminal:

```bash
npm run start:agent -- --id laptop-1

npm run cli -- agent list
npm run cli -- task create --name hello --cmd 'echo hello from mini-cloud'
npm run cli -- task launch <taskId> --agent laptop-1
npm run cli -- instance list
npm run cli -- instance events <instanceId>
```

`npm run cli -- <args>` gets tedious. Put `mini-cloud` on your PATH once and drop the
prefix everywhere:

```bash
npm link -w @mini-cloud/cli
mini-cloud agent list
```

Run `mini-cloud --help` for the full command list, or `mini-cloud <command> --help`
for one command's flags.

## Variable substitution

Fleet-wide values are stored in the service and substituted before a task is
dispatched:

```bash
mini-cloud var set PROJECT_DIR=/srv/projects
mini-cloud task create --name build --cmd '${PROJECT_DIR}/build.sh'
```

Agents then resolve host-local values on the machine where the task actually runs —
`${HOME}`, `${HOSTNAME}`, `${AGENT_ID}`, `${AGENT_NAME}`, `${AGENT_DIR}`,
`${STDOUT_DIR}`, `${STDERR_DIR}`, `${INSTANCE_ID}`, `${TASK_ID}`. Substitution runs in
a single pass and leaves unknown placeholders alone, which is what lets the service's
pass and the agent's pass compose without interfering.

## Status

Task scheduling and pub/sub work end to end. Artifact storage, the issue tracker,
metrics aggregation and the web UI are next.

## License

MIT © Nan Qin
