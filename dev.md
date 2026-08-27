# Development setup

## Requirements

- Node.js 22 or newer (`.nvmrc` pins the version this repo is built against)
- PostgreSQL 15 or newer

## PostgreSQL

Install and start it as a background service:

```bash
brew install postgresql@18
brew services start postgresql@18
```

Create the databases. mini-cloud uses one per stage so a `beta` experiment cannot
touch `prod` data:

```bash
createdb mini_cloud_beta
createdb mini_cloud_prod
```

Point the service somewhere else with `MINI_CLOUD_DATABASE_URL` if you use a
different host, port, user or database name.

If you would rather not run a daemon on your machine, a container works the same way:

```bash
docker run -d --name mini-cloud-pg \
  -e POSTGRES_USER=minicloud -e POSTGRES_PASSWORD=minicloud -e POSTGRES_DB=mini_cloud_beta \
  -p 5432:5432 postgres:17-alpine
export MINI_CLOUD_DATABASE_URL=postgres://minicloud:minicloud@127.0.0.1:5432/mini_cloud_beta
```

## Build and run

```bash
npm install
npm start
```

`npm start` builds every package, applies any pending migrations, and runs the
control plane in the foreground. Ctrl-C shuts it down cleanly.

In another terminal, start a worker agent:

```bash
npm run start:agent
```

To get `mini-cloud` on your PATH and stop typing `npm run cli --`:

```bash
npm link -w @mini-cloud/cli
```

## Web console

The console is a separate static app that calls the service's HTTP API directly, from
its own origin. Nothing to configure:

```bash
npm start      # terminal 1 — the control plane
npm run web    # terminal 2 — the console, on http://localhost:5173
```

The service allows any origin by default, which is what makes those two commands work
together. **That is wider than it sounds**: the browser makes the request, so binding
to loopback does not stop a page you happen to be visiting from reaching the service
and reading the answer — and an unauthenticated control plane will happily launch a
command for it. Two ways to close that, either of which is worth doing before you
leave it running:

```bash
MINI_CLOUD_CORS_ORIGINS=http://localhost:5173    # only the console's origin
MINI_CLOUD_TOKEN=$(openssl rand -hex 32)         # or require a token from everyone
```

Setting `MINI_CLOUD_CORS_ORIGINS` replaces the default rather than adding to it, so
naming your own origins genuinely narrows things. Setting it to an empty value
disables CORS altogether and no browser gets through at all.

There is deliberately no dev proxy: the browser talks cross-origin in development
exactly as it will in production, so nothing about the request path changes between
the two.

`npm run build` produces `packages/web/dist`, a folder of static files you can serve
from anything. Point it at a different service with `VITE_MINI_CLOUD_API_URL` — see
[packages/web/README.md](./packages/web/README.md).

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm start` | Build, then run the control plane |
| `npm run start:agent` | Build, then run a worker agent on this machine |
| `npm run web` | Run the web console's dev server on :5173 |
| `npm run cli -- <args>` | Run any CLI command, e.g. `npm run cli -- task list` |
| `npm run migrate` | Build, then apply pending migrations and exit |
| `npm run serve` / `npm run agent` | Same as the `start` pair, but skip the build |
| `npm run build` | Build every package, in dependency order |
| `npm test` | Run unit tests across all packages |
| `npm run lint` | ESLint |
| `npm run format:fix` | Prettier, in place |
| `npm run clean` | Remove build output |

Packages build in dependency order, so `npm run build` after touching `shared` is
what makes the change visible to everything downstream. The `start` scripts build
first — it costs under two seconds and means you never run stale code. `serve` and
`agent` skip it for when you know the build is current.

### Passing flags

Everything after `--` goes to the command, not to npm:

```bash
npm start -- --port 4000
npm run start:agent -- --id laptop-1 --name "mac mini"
npm run cli -- instance list --status running
```

The `--` matters. Without it npm consumes the flags itself, so `npm start --port 4000`
reaches the service as a bare `4000` and fails.

## Configuration

Every value has a default; nothing is required to run locally.

### Service

| Variable | Default | Meaning |
| --- | --- | --- |
| `MINI_CLOUD_STAGE` | `beta` | `beta` or `prod`; selects the default database name |
| `MINI_CLOUD_PORT` | `3000` | HTTP and WebSocket port |
| `MINI_CLOUD_HOST` | `127.0.0.1` | Bind address. Loopback by default — exposing the service should be deliberate |
| `MINI_CLOUD_DATABASE_URL` | `postgres://localhost:5432/mini_cloud_<stage>` | Connection string |
| `MINI_CLOUD_TOKEN` | *(unset)* | Bearer token for HTTP and WebSocket. Unset means no authentication |
| `MINI_CLOUD_CORS_ORIGINS` | `*` | Comma-separated browser origins allowed to call the API. `*` allows any; an empty value installs no CORS middleware at all |
| `MINI_CLOUD_JOB_TICK_MS` | `1000` | How often to check for due jobs. Must be at or below the shortest job interval |
| `MINI_CLOUD_MAINTENANCE_TICK_MS` | `5000` | Agent probe and stuck-instance sweep interval |
| `MINI_CLOUD_AGENT_OFFLINE_AFTER_MS` | `15000` | Silence after which an agent is marked offline |
| `MINI_CLOUD_LAUNCH_TIMEOUT_MS` | `15000` | How long an instance may sit at `initiated` |
| `MINI_CLOUD_START_TIMEOUT_MS` | `60000` | How long an instance may sit at `launched` without reporting a pid |
| `MINI_CLOUD_RETENTION_DAYS` | `365` | How long instance and event history is kept |
| `MINI_CLOUD_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |

### Agent

| Variable | Default | Meaning |
| --- | --- | --- |
| `MINI_CLOUD_AGENT_ID` | this machine's hostname, lowercased with a trailing `.local` stripped | Unique per agent — two sharing an id would receive each other's commands. Needed only for a second agent on one machine, or when the hostname is `localhost` |
| `MINI_CLOUD_AGENT_NAME` | the agent id | Display name |
| `MINI_CLOUD_SERVICE_URL` | `http://127.0.0.1:3000` | Where the control plane is |
| `MINI_CLOUD_AGENT_PORT` | `3100` | Loopback port the reporter API listens on |
| `MINI_CLOUD_AGENT_DIR` | `~/.mini-cloud/agent` | Offline reports and default stdout/stderr files |
| `MINI_CLOUD_PING_FAILURE_THRESHOLD` | `3` | Consecutive failed probes before an instance is unhealthy |
| `MINI_CLOUD_PASSIVE_TOLERANCE_MS` | `2000` | Grace added to a passive check's period before a heartbeat counts as missed |

### Web console

Read at build time and inlined into the bundle, so changing either means rebuilding.
Set them in `packages/web/.env` (copy `.env.example`).

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_MINI_CLOUD_API_URL` | `http://127.0.0.1:3000` | Base URL of the service the console calls |
| `VITE_MINI_CLOUD_TOKEN` | *(unset)* | Bearer token, for a service running with `MINI_CLOUD_TOKEN` set |

## Database schema

Migrations are plain SQL in `packages/service/migrations/`, named
`<sequence>_<name>.sql` and applied in ascending sequence order, each in its own
transaction, tracked in `schema_migration`. `mini-cloud serve` applies pending
migrations on startup; `--skip-migrations` opts out.

To add one, create the next numbered file — never edit a migration that has shipped,
because it has already run against every database that applied it.

```
packages/service/migrations/
  001_initial.sql
  002_add_artifacts.sql     ← the next one
```

The sequence is compared as a number, so `2_x.sql` and `002_x.sql` sort the same and
zero padding is only cosmetic (`001_` is the house style). The runner refuses to start
if a filename has no sequence number, or if two migrations share one — the latter is
the merge collision where two branches each add an `002_`, and picking a winner by
filesystem order would give the two developers different schemas.

## Reporting from your own programs

A launched program can report its own lifecycle:

```ts
import { TaskReporter } from '@mini-cloud/reporter';

const reporter = TaskReporter.fromEnvironment(); // undefined when not run by mini-cloud
await reporter?.start();                          // reports the pid, starts any heartbeat

await reporter?.log('success', 'finished importing 1,240 rows');

process.on('SIGINT', async () => {
  await reporter?.reportTermination();
  process.exit(0);
});
```

`fromEnvironment()` returns undefined when the program was not launched by an agent,
which is what makes it safe to leave in a program you also run by hand. No reporter
method ever throws, and a report that cannot be delivered is buffered to disk and
replayed the next time the agent starts.
