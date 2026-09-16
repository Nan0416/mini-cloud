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

Point the service somewhere else with `databaseUrl` in `~/.mini-cloud/config.json` if
you use a different host, port, user or database name. Running a second copy — an
experiment you do not want touching your real tasks — is a second database and a second
configuration directory, rather than anything mini-cloud knows about:

```bash
createdb mini_cloud_scratch
mkdir -p ~/mini-cloud-scratch          # config.json + secret.json live here
npm start -- --config ~/mini-cloud-scratch/config.json
```

If you would rather not run a daemon on your machine, a container works the same way:

```bash
docker run -d --name mini-cloud-pg \
  -e POSTGRES_USER=minicloud -e POSTGRES_PASSWORD=minicloud -e POSTGRES_DB=mini_cloud \
  -p 5432:5432 postgres:17-alpine
# then set databaseUrl in ~/.mini-cloud/config.json to
#   postgres://minicloud:minicloud@127.0.0.1:5432/mini_cloud
```

## Build and run

```bash
npm install
npm run cli -- config init
npm start
```

`npm start` works without that middle line — the public listener falls back to the token
`1234` — and then says so on every start:

```
WARN [DependencyFactory] No publicToken in ~/.mini-cloud/secret.json, so the public
listener is running on the default token "1234" — which is also what to paste into the
console. It is published in this project, so anyone who knows mini-cloud can drive this
service and launch programs on your machines. Run `mini-cloud config init` to generate
one of your own before exposing this listener.
```

Take that warning literally. The default is a placeholder, not a secret: it is written
down in `packages/service/src/config.ts`, so it authenticates nobody who has seen this
repository. What makes it survivable is the other default beside it — the public listener
binds to `127.0.0.1`, so nothing off this machine can present the token in the first
place. Set a real one before you change `public.host` or point a port forward at it, and
treat the two as a single step.

`config init` writes a generated token to `~/.mini-cloud/secret.json`, which every start
reads — so unlike an exported variable it survives a new shell, and a daemon started by
launchd or systemd reads exactly the same file. The console stores the token you give it,
so rotating it logs every browser out.

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
| Authentication | none — the source address is the credential | `publicToken`, always demanded; `1234` until you set one |
| Source check | `internal.trustedSubnets` | none |
| CORS | none at all | `public.corsOrigins` |

The point is that they get exposed differently. The internal one carries agent reports
and the WebSocket the fleet takes its commands from, so it stays on the LAN; the public
one is the only one a port forward should ever point at. They share one scheduler, one
database and one object graph — the split decides what is *reachable* from where, not
what exists, so a bug in a public route can still touch everything.

An agent presents no credential at all. What admits it is where it is connecting from,
so `internal.trustedSubnets` is not a second line of defence on the internal listener
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
$ curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $(jq -r .publicToken ~/.mini-cloud/secret.json)" localhost:3001/tasks
200
```

That console is a static page which talks to whatever address the link names — nothing
is sent anywhere else, and the link never carries a token. It is printed only when a
browser on this machine could follow it, so binding `public.host` to one LAN
interface prints no link: loopback would not reach the service, and the interface's own
`http://` address is one an HTTPS page may not call. `consoleUrl` points it
at your own console, or set it empty for no link at all.

In another terminal, start a worker agent:

```bash
npm run start:agent
```

## Running it as a daemon

`mini-cloud serve` dies with the terminal that started it. To keep the control plane up
across a logout and a reboot, install it as a service:

```bash
mini-cloud daemon start          # install and start
mini-cloud daemon status
mini-cloud daemon logs -f
mini-cloud daemon stop           # stays installed, starts again at login
mini-cloud daemon uninstall
```

launchd on macOS (`~/Library/LaunchAgents/dev.qinnan.mini-cloud.plist`), systemd
`--user` on Linux (`~/.config/systemd/user/mini-cloud.service`). Both run the same
`mini-cloud serve` the terminal does; what they add is restart-on-crash and start-at-login.
`--no-enable` starts it now without the second of those.

**The unit carries no settings.** A login service reads no profile, but it does not need
one: `serve` reads `~/.mini-cloud/config.json` at every start, whoever started it. The
unit holds `HOME` (which is how that file is found) and `PATH`, and nothing else — so
reconfiguring is editing the file and restarting, not reinstalling the service.

**Postgres is not waited for.** Neither a LaunchAgent nor a systemd *user* unit can
order itself after a system service, so a control plane that starts before its database
crashes and is restarted — every 5s under systemd, immediately under launchd — until
Postgres answers. That is recoverable rather than fatal, but it does mean a few failures
in the log after a reboot.

On Linux, a user service starts at *login*, not at boot. `sudo loginctl enable-linger
$USER` is what makes it start with the machine.

Windows has no implementation: `daemon start` says so, and `mini-cloud serve` in a
terminal works everywhere.

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
and the token together on first load. Paste the `publicToken` from `secret.json`; the
browser stores it, so this is a first-run step rather than a per-session one. Baking
both into the bundle instead is `VITE_MINI_CLOUD_API_URL` and `VITE_MINI_CLOUD_TOKEN`,
below.

Every load then checks the stored token against the service before the console opens,
and anything short of an authenticated answer shows the setup screen again with the
address already filled in — a rotated token, a wrong address, a service that is not
running. The console never renders against a token it has not just seen work, because
one that did left every panel to meet the same 401 on its own while the offline banner
stayed quiet: `/ping` needs no token, so reachability looked fine throughout.

That listener allows **any** browser origin by default, which is what makes those two
commands work with no CORS setup — and it is wider than it sounds: the browser makes
the request, so binding to loopback does not stop a page you happen to be visiting from
reaching the listener. The token is what stops that page getting an answer; narrowing
the origins closes it a step earlier, and is worth doing before you leave the service
running:

```bash
"public": { "corsOrigins": ["http://localhost:5173"] }    // only the console's origin
```

The internal listener installs no CORS middleware at all, whatever this is set to. A
page can still send it a request; without the response header the browser will not let
that page read the answer, which is the difference that matters for agent traffic —
that listener has no token to fall back on.

Setting `public.corsOrigins` replaces the default rather than adding to it, so
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
| `npm run cli -- daemon start` | Run the control plane under launchd or systemd instead of in this terminal |
| `npm run build:sea -w @mini-cloud/cli` | Build the self-contained `mini-cloud` binary into `packages/cli/build/sea/` |
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
npm run cli -- instance list --status running
npm start -- --config ~/.mini-cloud/scratch.json
```

There are no flags for addresses, ports, the database or the token. Every one of those
is a setting, and a setting lives in exactly one place: `~/.mini-cloud/config.json`, or
`secret.json` beside it. `--config <path>` points at a different pair — it picks up the
`secret.json` in the same directory — which is how you run a second instance.

The `--` matters. Without it npm consumes the flags itself, so `npm start --port 4000`
reaches the service as a bare `4000` and fails.

## Configuration

Every value has a default, the token included — and that one is the
only default that is a placeholder rather than a sensible choice. The control plane
warns about it on every start.

### Service

Settings live in `~/.mini-cloud/config.json`, read at startup. `mini-cloud config init`
writes a starter file with every value at its default, and `mini-cloud config show`
prints what is in force. Flags win over the file; the file wins over the defaults.

```json
{
  "databaseUrl": "postgres://localhost:5432/mini_cloud",
  "consoleUrl": "https://mini-cloud.qinnan.dev",
  "internal": { "host": "127.0.0.1", "port": 3000, "trustedSubnets": ["127.0.0.0/8", "10.0.0.0/8", "..."] },
  "public": { "host": "127.0.0.1", "port": 3001, "corsOrigins": ["*"] },
  "scheduler": { "jobTickMs": 1000, "maintenanceTickMs": 5000, "agentOfflineAfterMs": 15000 },
  "cli": { "serviceUrl": "http://127.0.0.1:3001", "internalUrl": "http://127.0.0.1:3000" }
}
```

| Setting | Default | Meaning |
| --- | --- | --- |
| `databaseUrl` | `postgres://localhost:5432/mini_cloud` | Connection string |
| `consoleUrl` | `https://mini-cloud.qinnan.dev` | Console the startup link points at. Empty prints no link |
| `internal.host` | `127.0.0.1` | Internal bind address, e.g. your LAN address |
| `internal.port` | `3000` | Internal listener: agent API, pub/sub, WebSocket |
| `internal.trustedSubnets` | loopback + RFC 1918 + ULA + link-local | CIDR blocks the internal listener accepts, on requests and on WebSocket upgrades. The only thing guarding that listener — `[]` accepts any address |
| `public.host` | `127.0.0.1` | Public bind address. Loopback by default — exposing this one should be deliberate |
| `public.port` | `3001` | Public listener: tasks, instances, the fleet, variables |
| `public.corsOrigins` | `["*"]` | Browser origins allowed to call the **public** listener. `["*"]` allows any; `[]` installs no CORS middleware at all |
| `scheduler.jobTickMs` | `1000` | How often to check for due jobs. Must be at or below the shortest job interval |
| `scheduler.maintenanceTickMs` | `5000` | Agent probe and stuck-instance sweep interval |
| `scheduler.agentOfflineAfterMs` | `15000` | Silence after which an agent is marked offline |
| `scheduler.launchTimeoutMs` | `15000` | How long an instance may sit at `initiated` |
| `scheduler.startTimeoutMs` | `60000` | How long an instance may sit at `launched` without reporting a pid |
| `scheduler.retentionDays` | `365` | How long instance and event history is kept |
| `cli.serviceUrl` | `http://127.0.0.1:3001` | Where `mini-cloud task list` and friends point. `--service` overrides |
| `cli.internalUrl` | `http://127.0.0.1:3000` | Where `mini-cloud pubsub` opens its socket. `--hub` overrides |

An unknown key is warned about rather than refused, so a typo says so instead of
silently reading as a default. A file that exists and will not parse is fatal: falling
back to defaults there would look exactly like the settings being ignored.

### The token

`~/.mini-cloud/secret.json`, `0600`, and never read out of `config.json`:

```json
{ "publicToken": "…" }
```

Kept apart so `config.json` stays safe to paste into an issue. Absent means the
published default — see [Build and run](#build-and-run).

`MINI_CLOUD_LOG_LEVEL` (`debug`, `info`, `warn`, `error`) is the one environment
variable mini-cloud still reads anywhere. It is resolved in a static initialiser, before
any file could be loaded, and the test suite depends on it. Everything else — the
service's, the CLI's and the agent's — is in the two files.

### Agent

The `agent` section of the same `~/.mini-cloud/config.json`, on the worker machine.

| Setting | Default | Meaning |
| --- | --- | --- |
| `agent.id` | this machine's hostname, lowercased with a trailing `.local` stripped | Unique per agent — two sharing an id would receive each other's commands. Needed only for a second agent on one machine, or when the hostname is `localhost` |
| `agent.name` | the agent id | Display name |
| `agent.internalUrl` | `http://127.0.0.1:3000` | The control plane's **internal** listener, which is the only one that serves an agent |
| `agent.port` | `3100` | Loopback port the reporter API listens on |
| `agent.workDir` | `~/.mini-cloud/agent` | Offline reports and default stdout/stderr files |
| `agent.heartbeatIntervalMs` | `5000` | Three of these fit inside the service's offline window |
| `agent.healthCheckTickMs` | `5000` | How often instance health is checked |
| `agent.passiveToleranceMs` | `2000` | Grace added to a passive check's period before a heartbeat counts as missed |
| `agent.pingFailureThreshold` | `3` | Consecutive failed probes before an instance is unhealthy |

### Web console

Read at build time and inlined into the bundle, so changing either means rebuilding.
Set them in `packages/web/.env` (copy `.env.example`). Both are optional, and both are
*defaults*: a `?backend=` link and then whatever the browser stored each win over them.

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_MINI_CLOUD_API_URL` | *(unset — the console asks on first load)* | Base URL of the service the console calls |
| `VITE_MINI_CLOUD_TOKEN` | *(unset)* | Bearer token; the `publicToken` from the service's `secret.json` |

With neither set, the console shows a setup screen that asks for the service address
and the token, then verifies both before it opens. The token field is always there
rather than appearing once a service has refused: the public listener has no
unauthenticated mode, so a token is not something some services happen to want — it is
the second half of the address. That is what lets one build be pointed at anyone's
service — including from a phone, if the service is behind TLS. See [packages/web/README.md](./packages/web/README.md) for the
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

## Building the binary

`mini-cloud` also ships as a single executable — a copy of Node with the whole CLI
injected into it, so the machine it lands on needs no Node, no `npm install` and no
checkout. Build one locally with:

```bash
npm run build                                # the bundle reads the packages' compiled dist
npm run build:sea:mac -w @mini-cloud/cli     # or build:sea:linux
# -> packages/cli/build/sea/mini-cloud
```

Three build scripts, because what differs between them is what happens *after* the
bundle — how the blob is injected, and what signature goes back on. The identical part
before that lives in `scripts/sea-prelude.sh`, which each of them sources.

| Script | npm script | |
| --- | --- | --- |
| `build-linux-sea.sh` | `build:sea:linux` | ELF: no segment name, nothing signed |
| `build-mac-sea-unsigned.sh` | `build:sea:mac` | Ad-hoc signed — runs locally, but Gatekeeper refuses it once a browser has quarantined it |
| `build-mac-sea-signed.sh` | `build:sea:mac:signed` | Developer ID + notarization. The build for anything anyone else downloads |

That first line is not optional. The bundle resolves `@mini-cloud/*` from each package's
`dist/`, so building the binary against a stale or absent one silently ships old code.

The pipeline is `scripts/build-sea.sh`: compile the migrations in, bundle everything to
one CommonJS file with tsup, turn that into a SEA blob, copy the running `node`, inject
the blob with postject, and on macOS re-sign (Node's own signature has to come off
before the Mach-O is modified and an ad-hoc one go back on, because Apple Silicon will
not run an unsigned binary).

**The migrations travel inside it.** `defaultMigrationsDir()` resolves out of
`__dirname`, which inside a binary names a path that does not exist — so the build
generates a module from `packages/service/migrations/*.sql` and the bundler swaps it for
the empty `embedded-migrations.ts` placeholder. Nothing else changes: `npm start` and the
tests still read the real directory, and adding a migration is still just dropping a
`.sql` file in. Compiling them in rather than shipping a directory beside the binary is
also what pins the schema to the executable that was built with it.

Releases are a `cli-v*` tag, built for macOS and Linux on both architectures and attached
to a GitHub Release by `.github/workflows/release-cli.yml`:

```bash
git tag cli-v1.0.1
git push origin cli-v1.0.1
```

A separate tag from the `sdk-v*` npm release on purpose — a CLI fix is not a reason to
republish a library, and a library release is not a reason to rebuild four binaries. The
workflow also takes a `workflow_dispatch`, which builds and verifies every platform
without publishing anything, for changing the pipeline without pushing a tag.

CI currently builds the **unsigned** macOS binary, so a tarball downloaded in a browser
is quarantined and the release notes tell people to clear it with `xattr -d
com.apple.quarantine`. That is a papercut worth removing — the signed script works
locally against a Developer ID certificate already in the keychain, and wiring it into CI
needs four repository secrets (the exported certificate and its password, plus
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`).

Note what signing alone does *not* fix: a bare Mach-O cannot be stapled, so the
notarization ticket is checked online and a first run still needs the network. Shipping
the binary inside a `.pkg` or `.dmg` is what would allow stapling. Both that and
publishing to S3 behind a CDN are in [md/TODO.md](./md/TODO.md).

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
git tag sdk-v1.0.1
git push origin main --tags
```

Both release tags carry what they ship: `sdk-v*` for the npm packages, `cli-v*` for the
binaries. A bare `v1.0.1` now triggers nothing at all — which is the point, since with
two release paths on one repository an unprefixed tag could only be ambiguous.

`.github/workflows/release-sdk.yml` then builds, runs the tests again against that exact
commit, checks the tag agrees with both `package.json` versions, and publishes
`shared` before `reporter` — in that order, because npm does not verify at publish
time that a dependency resolves, and the reverse order leaves a window where
`npm install @mini-cloud/reporter` fails.

Both packages move in lockstep, because `reporter` pins `shared` to an exact version.
Bump both or neither.

### Authentication

There is no `NPM_TOKEN` in this repository. Publishing uses npm Trusted Publishing
over GitHub's OIDC: GitHub mints a short-lived token, scoped to this repository and
to `release-sdk.yml` specifically, and npm exchanges it for publish rights. Nothing
long-lived is stored, and provenance attestations are generated automatically.

Two GitHub-side things it depends on. Actions are pinned to a commit SHA, not a
floating tag, because a workflow holding `id-token: write` mints a real publish
credential — `.github/dependabot.yml` is what keeps those pins from rotting. And the
publish job runs in the `npm-publish` environment, so a required reviewer there holds an
irreversible publish until someone approves it.

The trusted publisher is configured per package on npmjs.com, under
**Package → Settings → Trusted publishing**, with:

| Field | Value |
| --- | --- |
| Organization or user | `Nan0416` |
| Repository | `mini-cloud` |
| Workflow filename | `release-sdk.yml` |
| Environment | *(optional)* `npm-publish` |
| Allowed actions | `npm publish` |

Setting **Environment** is optional and narrows things further: npm then refuses a
token minted by any job in this repository that is not running in `npm-publish`. Set it
*after* a release has succeeded with the environment in place — configuring it on npm
before the workflow has ever produced that claim fails the next publish rather than the
next-but-one.

**Renaming this workflow breaks publishing** until both packages' trusted publisher
entries are updated to match the new filename. It was `publish.yml` before it was
renamed to `release-sdk.yml`, so if a release fails at the publish step with an
authentication error, that rename is the first thing to check.
