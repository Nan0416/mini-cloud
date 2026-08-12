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
npm run build

npm run migrate                    # or: mini-cloud migrate
node packages/cli/bin/mini-cloud.js serve
```

To get `mini-cloud` on your PATH while developing:

```bash
npm link -w @mini-cloud/cli
```

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run build` | Build every package, in dependency order |
| `npm test` | Run unit tests across all packages |
| `npm run lint` | ESLint |
| `npm run format:fix` | Prettier, in place |
| `npm run clean` | Remove build output |

Packages build in dependency order, so `npm run build` after touching `shared` is
what makes the change visible to everything downstream.

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
| `MINI_CLOUD_AGENT_ID` | *(required)* | Unique per agent. Two agents sharing an id would receive each other's commands |
| `MINI_CLOUD_AGENT_NAME` | machine hostname | Display name |
| `MINI_CLOUD_SERVICE_URL` | `http://127.0.0.1:3000` | Where the control plane is |
| `MINI_CLOUD_AGENT_PORT` | `3100` | Loopback port the reporter API listens on |
| `MINI_CLOUD_AGENT_DIR` | `~/.mini-cloud/agent` | Offline reports and default stdout/stderr files |
| `MINI_CLOUD_PING_FAILURE_THRESHOLD` | `3` | Consecutive failed probes before an instance is unhealthy |
| `MINI_CLOUD_PASSIVE_TOLERANCE_MS` | `2000` | Grace added to a passive check's period before a heartbeat counts as missed |

## Database schema

Migrations are plain SQL in `packages/service/migrations/`, applied in filename order,
each in its own transaction, tracked in `schema_migration`. `mini-cloud serve` applies
pending migrations on startup; `--skip-migrations` opts out.

To add one, create the next numbered file — never edit a migration that has shipped.

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
