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

Create the database:

```bash
createdb mini_cloud
```

Point the service somewhere else with `MINI_CLOUD_DATABASE_URL` if you use a
different host, port, user or database name. Running a second copy — an experiment you
do not want touching your real tasks — is a second database and a second value for that
variable, rather than anything mini-cloud knows about:

```bash
createdb mini_cloud_scratch
MINI_CLOUD_DATABASE_URL=postgres://localhost:5432/mini_cloud_scratch npm start
```

If you would rather not run a daemon on your machine, a container works the same way:

```bash
docker run -d --name mini-cloud-pg \
  -e POSTGRES_USER=minicloud -e POSTGRES_PASSWORD=minicloud -e POSTGRES_DB=mini_cloud \
  -p 5432:5432 postgres:17-alpine
export MINI_CLOUD_DATABASE_URL=postgres://minicloud:minicloud@127.0.0.1:5432/mini_cloud
```

## Build and run

```bash
npm install
export MINI_CLOUD_PUBLIC_TOKEN=$(openssl rand -hex 32)
npm start
```

The token is required, and `serve` refuses to start without one:

```
Error: MINI_CLOUD_PUBLIC_TOKEN is not set. The public listener will not start without
one: it is the listener a port forward points at, and anything that reaches it can
launch programs on your machines.
```

Put it somewhere it survives a new shell — a profile, an `EnvironmentFile=` in a
systemd unit, a launchd plist — rather than generating a fresh one each time. The
console stores the token you give it, so rotating the value logs every browser out.

`npm start` then builds every package, applies any pending migrations, and runs the
control plane in the foreground. Ctrl-C shuts it down cleanly.

It prints two listeners and a link that opens the console already pointed at itself:

```
Internal listener (agents, pub/sub) on http://127.0.0.1:3000 — WebSocket at ws://127.0.0.1:3000/ws.
Public listener (console, CLI) on http://127.0.0.1:3001.
Open the console: https://mini-cloud.qinnan.dev/?backend=http%3A%2F%2F127.0.0.1%3A3001
```

### Two listeners

One process, two ports, and the split is by who calls:

| | Internal — `:3000` | Public — `:3001` |
| --- | --- | --- |
| Serves | `/agent-api/*`, `/pubsub/*`, `/ws`, `/ping`, `/health` | `/tasks*`, `/instances*`, `/agents*`, `/variables`, `/pubsub/*`, `/ping`, `/health` |
| Called by | agents, and programs on your LAN | the console, the CLI, you |
| Bind it to | the home network | wherever you reach it from |
| Authentication | none — the source address is the credential | `MINI_CLOUD_PUBLIC_TOKEN`, always required |
| Source check | `MINI_CLOUD_TRUSTED_SUBNETS` | none |
| CORS | none at all | `MINI_CLOUD_CORS_ORIGINS` |

The point is that they get exposed differently. The internal one carries agent reports
and the WebSocket the fleet takes its commands from, so it stays on the LAN; the public
one is the only one a port forward should ever point at. They share one scheduler, one
database and one object graph — the split decides what is *reachable* from where, not
what exists, so a bug in a public route can still touch everything.

An agent presents no credential at all. What admits it is where it is connecting from,
so `MINI_CLOUD_TRUSTED_SUBNETS` is not a second line of defence on the internal listener
— it is the only one. Widen it and you have widened who can launch programs on your
machines; empty it and anything that can reach the port can.

The WebSocket is on the internal listener because that is the server it is attached to,
and a socket shares the port of its server. Nothing claims an upgrade on the public
listener, so one arriving there gets the same 404 as any other unknown path — no filter
involved. On the internal listener the upgrade is checked against the trusted subnets
separately from ordinary requests, because an upgrade never passes through the
middleware stack that checks those.

Ask for a path on the wrong listener and the 404 says which one serves it:

```
$ curl -s localhost:3000/tasks
{"error":"GET /tasks is not served by the internal listener. The public listener (port 3001) serves /tasks, /instances, /agents, /variables.","errorCode":"NOT_FOUND"}
```

On the public listener the token is checked before anything is routed, so an
unauthenticated request is a 401 whatever the path — a path that does not exist
included, which is what stops someone mapping the API by reading which paths 404.
`/ping` and `/health` are the two exceptions, left open so that a probe can tell a
service that is down from one that is refusing it. The console's setup screen is built
on exactly that difference:

```
$ curl -s -o /dev/null -w '%{http_code}\n' localhost:3001/ping
200
$ curl -s -o /dev/null -w '%{http_code}\n' localhost:3001/tasks
401
$ curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $MINI_CLOUD_PUBLIC_TOKEN" localhost:3001/tasks
200
```

That console is a static page which talks to whatever address the link names — nothing
is sent anywhere else, and the link never carries a token. It is printed only when a
browser on this machine could follow it, so binding `MINI_CLOUD_PUBLIC_HOST` to one LAN
interface prints no link: loopback would not reach the service, and the interface's own
`http://` address is one an HTTPS page may not call. `MINI_CLOUD_CONSOLE_URL` points it
at your own console, or set it empty for no link at all.

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
its own origin:

```bash
npm start      # terminal 1 — the control plane
npm run web    # terminal 2 — the console, on http://localhost:5173
```

It talks to the public listener — `http://127.0.0.1:3001` — and asks for the address
and the token on first load. Paste the value of `MINI_CLOUD_PUBLIC_TOKEN`; the browser
stores it, so this is a first-run step rather than a per-session one. Baking both into
the bundle instead is `VITE_MINI_CLOUD_API_URL` and `VITE_MINI_CLOUD_TOKEN`, below.

That listener allows **any** browser origin by default, which is what makes those two
commands work with no CORS setup — and it is wider than it sounds: the browser makes
the request, so binding to loopback does not stop a page you happen to be visiting from
reaching the listener. The token is what stops that page getting an answer; narrowing
the origins closes it a step earlier, and is worth doing before you leave the service
running:

```bash
MINI_CLOUD_CORS_ORIGINS=http://localhost:5173    # only the console's origin
```

The internal listener installs no CORS middleware at all, whatever this is set to. A
page can still send it a request; without the response header the browser will not let
that page read the answer, which is the difference that matters for agent traffic —
that listener has no token to fall back on.

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
| `npm run cli -- serve` / `npm run cli -- agent start` | Same as the `start` pair, but skip the build |
| `npm run build` | Build every package, in dependency order |
| `npm test` | Run unit tests across all packages. Tests live in `packages/*/tests/`, mirroring each package's `src/` |
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
npm start -- --port 4000 --public-port 4001
npm run start:agent -- --id laptop-1 --name "mac mini"
npm run cli -- instance list --status running
```

`serve` keeps `--port` and `--host` pointed at the internal listener, under the names
they had when there was only one: that is where already-deployed agents look. The
public listener takes `--public-port` and `--public-host`.

The `--` matters. Without it npm consumes the flags itself, so `npm start --port 4000`
reaches the service as a bare `4000` and fails.

## Configuration

Every value has a default except `MINI_CLOUD_PUBLIC_TOKEN`, which the control plane
refuses to start without.

### Service

| Variable | Default | Meaning |
| --- | --- | --- |
| `MINI_CLOUD_PUBLIC_TOKEN` | **required** | Bearer token for the public listener. There is no default and no way to run without one |
| `MINI_CLOUD_INTERNAL_PORT` | `3000` | Internal listener: agent API, pub/sub, WebSocket. Also reads `MINI_CLOUD_PORT` |
| `MINI_CLOUD_INTERNAL_HOST` | `127.0.0.1` | Internal bind address, e.g. your LAN address. Also reads `MINI_CLOUD_HOST` |
| `MINI_CLOUD_TRUSTED_SUBNETS` | loopback + RFC 1918 + ULA + link-local | CIDR blocks the internal listener accepts connections from, on requests and on WebSocket upgrades. The only thing guarding that listener — an empty value accepts any address |
| `MINI_CLOUD_PUBLIC_PORT` | `3001` | Public listener: tasks, instances, the fleet, variables |
| `MINI_CLOUD_PUBLIC_HOST` | `127.0.0.1` | Public bind address. Loopback by default — exposing this one should be deliberate |
| `MINI_CLOUD_DATABASE_URL` | `postgres://localhost:5432/mini_cloud` | Connection string |
| `MINI_CLOUD_CORS_ORIGINS` | `*` | Comma-separated browser origins allowed to call the **public** listener. `*` allows any; an empty value installs no CORS middleware at all |
| `MINI_CLOUD_JOB_TICK_MS` | `1000` | How often to check for due jobs. Must be at or below the shortest job interval |
| `MINI_CLOUD_MAINTENANCE_TICK_MS` | `5000` | Agent probe and stuck-instance sweep interval |
| `MINI_CLOUD_AGENT_OFFLINE_AFTER_MS` | `15000` | Silence after which an agent is marked offline |
| `MINI_CLOUD_LAUNCH_TIMEOUT_MS` | `15000` | How long an instance may sit at `initiated` |
| `MINI_CLOUD_START_TIMEOUT_MS` | `60000` | How long an instance may sit at `launched` without reporting a pid |
| `MINI_CLOUD_RETENTION_DAYS` | `365` | How long instance and event history is kept |
| `MINI_CLOUD_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `MINI_CLOUD_CONSOLE_URL` | `https://mini-cloud.qinnan.dev` | Console the startup link points at. Set it to your own copy, or to empty to print no link |

### Agent

| Variable | Default | Meaning |
| --- | --- | --- |
| `MINI_CLOUD_AGENT_ID` | this machine's hostname, lowercased with a trailing `.local` stripped | Unique per agent — two sharing an id would receive each other's commands. Needed only for a second agent on one machine, or when the hostname is `localhost` |
| `MINI_CLOUD_AGENT_NAME` | the agent id | Display name |
| `MINI_CLOUD_INTERNAL_URL` | `http://127.0.0.1:3000` | The control plane's internal listener. Not `MINI_CLOUD_SERVICE_URL` — that one names the public listener, for the CLI |
| `MINI_CLOUD_AGENT_PORT` | `3100` | Loopback port the reporter API listens on |
| `MINI_CLOUD_AGENT_DIR` | `~/.mini-cloud/agent` | Offline reports and default stdout/stderr files |
| `MINI_CLOUD_PING_FAILURE_THRESHOLD` | `3` | Consecutive failed probes before an instance is unhealthy |
| `MINI_CLOUD_PASSIVE_TOLERANCE_MS` | `2000` | Grace added to a passive check's period before a heartbeat counts as missed |

### Web console

Read at build time and inlined into the bundle, so changing either means rebuilding.
Set them in `packages/web/.env` (copy `.env.example`). Both are optional, and both are
*defaults*: a `?backend=` link and then whatever the browser stored each win over them.

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_MINI_CLOUD_API_URL` | *(unset — the console asks on first load)* | Base URL of the service the console calls |
| `VITE_MINI_CLOUD_TOKEN` | *(unset)* | Bearer token; the value of the service's `MINI_CLOUD_PUBLIC_TOKEN` |

With neither set, the console shows a setup screen that asks for the service address,
verifies it, and then asks for the token — which the public listener always wants. That
is what lets one build be pointed at anyone's service — including from a phone, if the
service is behind TLS. See [packages/web/README.md](./packages/web/README.md) for the
precedence rules and what a browser will and will not let the console reach.

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

Programs outside this repository install it from npm:

```bash
npm install @mini-cloud/reporter
```

## Releasing to npm

Two packages are published: `@mini-cloud/reporter`, which programs launched by
mini-cloud import, and `@mini-cloud/shared`, which it depends on. Everything else in
the workspace stays private.

A release is a tag, not a merge:

```bash
# 1. Bump both packages to the same version, in one commit on main.
npm version 1.0.1 --workspace @mini-cloud/shared --workspace @mini-cloud/reporter \
  --no-git-tag-version
git commit -am "chore: release 1.0.1"

# 2. Tag it. Pushing the tag is what publishes.
git tag v1.0.1
git push origin main --tags
```

`.github/workflows/publish.yml` then builds, runs the tests again against that exact
commit, checks the tag agrees with both `package.json` versions, and publishes
`shared` before `reporter` — in that order, because npm does not verify at publish
time that a dependency resolves, and the reverse order leaves a window where
`npm install @mini-cloud/reporter` fails.

Both packages move in lockstep, because `reporter` pins `shared` to an exact version.
Bump both or neither.

### Authentication

There is no `NPM_TOKEN` in this repository. Publishing uses npm Trusted Publishing
over GitHub's OIDC: GitHub mints a short-lived token, scoped to this repository and
to `publish.yml` specifically, and npm exchanges it for publish rights. Nothing
long-lived is stored, and provenance attestations are generated automatically.

The trusted publisher is configured per package on npmjs.com, under
**Package → Settings → Trusted publishing**, with:

| Field | Value |
| --- | --- |
| Organization or user | `Nan0416` |
| Repository | `mini-cloud` |
| Workflow filename | `publish.yml` |
| Allowed actions | `npm publish` |

**Renaming `publish.yml` breaks publishing** until both packages' trusted publisher
entries are updated to match the new filename.
