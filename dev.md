# Development

Requirements: Node.js 22+ (`.nvmrc` pins it) and PostgreSQL 15+.

## Quick start

```bash
npm install
createdb mini_cloud                 # see the PostgreSQL cheatsheet below
npm run cli -- config init          # writes ~/.mini-cloud/config.json + secret.json
npm start                           # control plane, foreground
```

Then, in other terminals:

```bash
npm run start:agent                 # a worker agent on this machine
npm run start:web                   # the console on http://localhost:5173
```

`npm start` builds every package, applies pending migrations, and prints both listeners
plus a link that opens the console already pointed at itself. Ctrl-C stops it.

Without `config init` everything still runs, on a published default token (`1234`) that
the service warns about on every start. Fine on loopback; set a real one before you
change `public.host` or point a port forward at it.

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm start` | Build, then run the control plane |
| `npm run start:agent` | Build, then run a worker agent |
| `npm run start:web` | The console's dev server on :5173 (no build needed) |
| `npm run cli -- <args>` | Any CLI command, e.g. `npm run cli -- task list` |
| `npm run cli -- serve` | Run the control plane without rebuilding first |
| `npm run cli -- config show` | Print the settings in force, and where they came from |
| `npm run migrate` | Apply pending migrations and exit |
| `npm run build` | Build every package, in dependency order |
| `npm test` | Unit tests across all packages |
| `npm run lint` / `npm run format:fix` | ESLint / Prettier |
| `npm run clean` | Remove build output |
| `npm run build:sea:mac -w @mini-cloud/cli` | Build the single-file binary (or `build:sea:linux`) |

Flags need a `--` separator, or npm eats them: `npm start -- --config ~/other/config.json`.

`npm link -w @mini-cloud/cli` puts `mini-cloud` on your PATH so you can drop the
`npm run cli --` prefix.

## Running as a daemon

`mini-cloud serve` and `mini-cloud agent start` die with their terminal. To survive a
logout, a crash and a reboot, run either one — or both, on the same machine — under the
OS supervisor:

```bash
mini-cloud daemon start             # the control plane: install the service and start it
mini-cloud agent daemon start       # the agent, the same way
```

Both groups take the same verbs:

```bash
mini-cloud daemon status            # or: mini-cloud agent daemon status
mini-cloud daemon logs -f
mini-cloud daemon restart
mini-cloud daemon stop              # stays installed, starts again at login
mini-cloud daemon uninstall
```

| | Control plane | Agent |
| --- | --- | --- |
| launchd (macOS) | `~/Library/LaunchAgents/dev.qinnan.mini-cloud.plist` | `…/dev.qinnan.mini-cloud.agent.plist` |
| systemd `--user` (Linux) | `~/.config/systemd/user/mini-cloud.service` | `…/mini-cloud-agent.service` |
| Log on macOS | `~/.mini-cloud/service/service.log` | `~/.mini-cloud/agent/agent.log` |

Linux logs go to journald. What the supervisor adds is restart-on-crash and
start-at-login; `--no-enable` gives you the first without the second.

The unit runs the binary it was installed from. For one installed by `install.sh` that is
the `~/.local/bin/mini-cloud` symlink, so after `mini-cloud update` a `daemon restart`
runs the new version — `update` names each daemon still on the old one. A unit written
from a checkout or from an extracted tarball keeps running that; `daemon start` from the
installed binary rewrites it.

The unit holds no settings, so reconfiguring is editing `config.json` and restarting,
never reinstalling. `start --config <path>` bakes that path into the unit. What the unit
*does* copy from the shell you install from is the environment a supervisor would not
provide: `HOME` and `PATH` for the control plane, and for the agent every variable a
task inherits (`PATH`, `HOME`, `SHELL`, `USER`, `LOGNAME`, `LANG`, `LC_ALL`, `TMPDIR`,
`TZ`), so a task behaves the same under the daemon as in that terminal. They are captured
at install time: after changing your `PATH`, run `agent daemon start` again.

Tasks outlive the agent. `agent daemon stop`, `restart` and `uninstall` leave every task
it launched running (on Linux the unit uses `KillMode=process` for this). `mini-cloud
agent stop <agentId>` asks the agent to exit cleanly, which the supervisor respects: it
stays down until `agent daemon start`, or until the supervisor itself starts again — at
the next login on macOS; on Linux when the user manager next starts, which with linger on
means the next boot.

Neither daemon waits for what it needs. A control plane that starts before Postgres,
or an agent that starts before its control plane, exits and is restarted — every 10s
under launchd, every 5s under systemd — until the other side answers.

On Linux a user service starts at *login*; `daemon start` says so when the account does
not linger, and `sudo loginctl enable-linger $USER` makes it start with the machine. A
macOS LaunchAgent likewise waits for someone to log in, so a headless Mac worker needs
automatic login.

One of each per user account. A second agent on the same machine runs in the
foreground, from its own config file with a different `agent.id`, `agent.port` and
`agent.workDir` — two agents sharing a work directory replay each other's offline
reports.

Starting a second copy of either from the same config is refused with a sentence rather
than a stack trace, and the sentence names the daemon when that is what holds the port.
The control plane claims its ports before it touches the database and answers 503 until
its migrations are in, so a stray `serve` never applies migrations under a running
daemon.

## Configuration

Settings in `~/.mini-cloud/config.json`, the token in `~/.mini-cloud/secret.json` beside
it. `config init` writes both; `config show` prints what is in force. Flags beat the
file, the file beats the defaults, and settings have no flags — `--config <path>` selects
a different pair, which is how you run a second instance.

`MINI_CLOUD_LOG_LEVEL` (`debug`/`info`/`warn`/`error`) is the only environment variable
mini-cloud reads anywhere.

### config.json

| Setting | Default | Meaning |
| --- | --- | --- |
| `databaseUrl` | `postgres://localhost:5432/mini_cloud` | Connection string |
| `consoleUrl` | `https://mini-cloud.qinnan.dev` | Console the startup link points at; empty prints no link |
| `internal.host` / `.port` | `127.0.0.1` / `3000` | Agent API, pub/sub, WebSocket. Keep it on the LAN |
| `internal.trustedSubnets` | loopback + RFC 1918 + ULA + link-local | CIDRs the internal listener accepts. The only thing guarding it — `[]` accepts anything |
| `public.host` / `.port` | `127.0.0.1` / `3001` | Tasks, instances, the fleet, variables. The only one to port-forward |
| `public.corsOrigins` | `["*"]` | Browser origins allowed to call the public listener; `[]` installs no CORS at all |
| `scheduler.jobTickMs` | `1000` | Due-job check; must be at or below the shortest job interval |
| `scheduler.maintenanceTickMs` | `5000` | Agent probe and stuck-instance sweep |
| `scheduler.agentOfflineAfterMs` | `15000` | Silence before an agent is offline |
| `scheduler.launchTimeoutMs` | `15000` | How long an instance may sit at `initiated` |
| `scheduler.startTimeoutMs` | `60000` | How long at `launched` without reporting a pid |
| `scheduler.retentionDays` | `365` | How long instance and event history is kept |
| `scheduler.retentionTickMs` | `3600000` | How often that history is pruned |
| `metrics.rawRetentionDays` | `28` | How long 1-minute metrics live. Also bounds how far back percentiles can be answered and how late an agent may report |
| `metrics.rollupRetentionDays` | `400` | How long the hour and day rollups live |
| `metrics.queryLagMs` | `180000` | How far behind now reads stop, so every agent has reported the newest bucket |
| `metrics.ingestBatchRetentionMs` | `86400000` | How long a delivered batch is remembered, for recognising a retry |
| `metrics.retentionTickMs` | `3600000` | How often metric partitions are created and expired ones dropped |
| `cli.serviceUrl` / `.internalUrl` | `:3001` / `:3000` | Where the CLI points |
| `agent.id` | this machine's hostname | Unique per agent; two sharing an id receive each other's commands |
| `agent.name` | the agent id | Display name |
| `agent.internalUrl` | `http://127.0.0.1:3000` | The control plane's **internal** listener |
| `agent.port` | `3100` | Loopback port for the reporter API |
| `agent.workDir` | `~/.mini-cloud/agent` | Offline reports and default stdout/stderr |
| `agent.heartbeatIntervalMs` | `5000` | Three fit inside the offline window |
| `agent.healthCheckTickMs` | `5000` | How often instance health is checked |
| `agent.passiveToleranceMs` | `2000` | Grace before a passive heartbeat counts as missed |
| `agent.pingFailureThreshold` | `3` | Failed probes before an instance is unhealthy |
| `agent.metricsTickMs` | `60000` | How often the metrics spool is drained and reported |
| `agent.metricsSpoolDir` | `~/.mini-cloud/metrics` | Where launched programs write metrics for this agent to collect |
| `agent.hostMetrics` | `true` | Report this machine's own CPU, memory and disk |
| `agent.maxHistogramBuckets` | `100` | Distinct values one minute of one series keeps before they are rounded |

An unknown key warns; a file that will not parse is fatal.

### secret.json

```json
{ "publicToken": "…" }
```

`0600`, and never read out of `config.json` — which is what keeps `config.json` safe to
paste into an issue.

### Web console

Build-time only, in `packages/web/.env` (copy `.env.example`). Both optional: a
`?backend=` link and then whatever the browser stored win over them.

| Variable | Meaning |
| --- | --- |
| `VITE_MINI_CLOUD_API_URL` | Base URL the console defaults to |
| `VITE_MINI_CLOUD_TOKEN` | Bearer token; the service's `publicToken` |

With neither set the console asks for an address and a token, verifies both, and only
then opens. A stored token is rechecked on every load.

## PostgreSQL cheatsheet

### The server

```bash
brew install postgresql@18
brew services start postgresql@18        # start now and at login
brew services stop postgresql@18
brew services restart postgresql@18
brew services list                       # is it running?
pg_isready                               # accepting connections?
```

A container works the same way:

```bash
docker run -d --name mini-cloud-pg \
  -e POSTGRES_USER=minicloud -e POSTGRES_PASSWORD=minicloud -e POSTGRES_DB=mini_cloud \
  -p 5432:5432 postgres:17-alpine
# then set databaseUrl to postgres://minicloud:minicloud@127.0.0.1:5432/mini_cloud
```

### Databases

```bash
createdb mini_cloud                      # create
dropdb mini_cloud                        # delete, permanently
dropdb --if-exists mini_cloud && createdb mini_cloud   # start over
psql -l                                  # list every database
psql mini_cloud                          # open a shell on one
psql mini_cloud -c 'select count(*) from task'         # one query, no shell
```

### Inside psql

| Command | What it does |
| --- | --- |
| `\l` | List databases (`\l+` adds sizes) |
| `\c mini_cloud` | Connect to another database |
| `\dt` | List tables |
| `\d task` | Describe a table — columns, indexes, constraints |
| `\di` | List indexes |
| `\du` | List roles |
| `\x` | Toggle expanded output — essential for wide rows |
| `\timing` | Show how long each query took |
| `\e` | Edit the current query in $EDITOR |
| `\q` | Quit |

### This project's tables

```sql
select * from schema_migration;                         -- what has been applied
select task_id, name, type, enabled from task;
select * from task_instance order by created_at desc limit 20;
select * from task_event where instance_id = '…' order by created_at;
select agent_id, name, last_seen_at from agent;
select * from replacement_variable;
```

### Inspecting and fixing

```sql
-- Who is connected, and to what
select pid, usename, application_name, state, query
from pg_stat_activity where datname = 'mini_cloud';

-- Disconnect everything else (needed before dropdb complains)
select pg_terminate_backend(pid) from pg_stat_activity
where datname = 'mini_cloud' and pid <> pg_backend_pid();

-- How big is it
select pg_size_pretty(pg_database_size('mini_cloud'));

-- Biggest tables
select relname, pg_size_pretty(pg_total_relation_size(relid))
from pg_catalog.pg_statio_user_tables order by pg_total_relation_size(relid) desc;
```

### Backup and restore

```bash
pg_dump mini_cloud > mini_cloud.sql              # plain SQL
pg_dump -Fc mini_cloud > mini_cloud.dump         # compressed, for pg_restore
psql mini_cloud < mini_cloud.sql
pg_restore -d mini_cloud mini_cloud.dump
```

### Migrations

Plain SQL in `packages/service/migrations/`, named `<sequence>_<name>.sql`, applied in
ascending order, each in its own transaction, tracked in `schema_migration`. `serve`
applies pending ones at startup; `--skip-migrations` opts out.

Add one by creating the next number. **Never edit a migration that has shipped** — it has
already run everywhere. Two files sharing a sequence is refused rather than ordered
arbitrarily, which is the merge collision where two branches each add an `002_`.

The binary compiles them in, so a released binary carries the schema it was built with.

## Two listeners

One process, two ports, split by who calls.

| | Internal `:3000` | Public `:3001` |
| --- | --- | --- |
| Serves | `/agent-api/*`, `/pubsub/*`, `/ws`, `/ping`, `/health` | `/tasks*`, `/instances*`, `/agents*`, `/variables`, `/metrics/*`, `/pubsub/*`, `/ping`, `/health` |
| Called by | agents, LAN programs | the console, the CLI |
| Authentication | none — the source address is the credential | `publicToken`, always |
| Source check | `internal.trustedSubnets` | none |
| CORS | none at all | `public.corsOrigins` |

The internal one carries agent reports and the socket the fleet takes commands from, so
it stays on the LAN; the public one is the only one a port forward should point at. Ask
for a path on the wrong one and the 404 names the right one.

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:3001/ping      # 200, no token needed
curl -s -o /dev/null -w '%{http_code}\n' localhost:3001/tasks     # 401
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $(jq -r .publicToken ~/.mini-cloud/secret.json)" \
  localhost:3001/tasks                                            # 200
```

## Reporting from your own programs

```ts
import { TaskReporter } from '@mini-cloud/reporter';

const reporter = TaskReporter.fromEnvironment(); // undefined when not run by mini-cloud
await reporter?.start();
await reporter?.log('success', 'finished importing 1,240 rows');

process.on('SIGINT', async () => {
  await reporter?.reportTermination();
  process.exit(0);
});
```

`fromEnvironment()` returns undefined when the program was not launched by an agent,
which makes it safe to leave in something you also run by hand. No method throws, and a
report that cannot be delivered is buffered to disk and replayed.

Outside this repository: `npm install @mini-cloud/reporter`.

## Recording metrics

```ts
import { MetricLogger } from '@mini-cloud/reporter';

// The namespace is required: it is the top of a metric's identity, and a shared
// default would quietly merge unrelated programs into one.
const metrics = MetricLogger.fromEnvironment('MyApp') ?? MetricLogger.toConsole('MyApp');

metrics.putDimensions({ Operation: 'Ingest' });
metrics.putMetric('Latency', 42, 'Milliseconds');
metrics.setProperty('requestId', requestId); // searchable, but not a series
await metrics.flush();

process.on('SIGTERM', async () => {
  await metrics.close(); // writes the last partial minute
  process.exit(0);
});
```

Metrics are written in the [AWS embedded metric format][emf], so what a program emits
here is what CloudWatch Logs would ingest unchanged. The API is deliberately the one
`aws-embedded-metrics` uses, so swapping in the real library later is a change of
import rather than a change of instrumentation.

[emf]: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html

A **dimension** is part of a metric's identity — every distinct set is its own series —
so keep them low-cardinality and use `setProperty` for anything like a request id. Like
`TaskReporter`, no method throws: a document the format would reject is dropped with a
warning naming the reason.

**A metric is stamped with when it was recorded, not when it was flushed.** An
observation belonging to a later minute closes the open document first, so one document
never spans two minutes and nothing is filed under the minute you happened to flush in.
An open document is also written out about a second after its minute ends, so a program
that records once and goes quiet does not sit on it — that timer is unref'd and never
keeps a process alive. `setTimestamp()` turns both off and puts you in charge.

Sub-minute accuracy is a different matter: the format allows one timestamp per
document, so a document holding several observations carries the time of its first. If
you need per-second precision, flush per observation.

`close()` writes whatever is still open and stops the timer; call it from a shutdown
handler, or the last partial minute depends on the timer firing before the process
exits.

Each flush appends one JSON document to an hourly file under `agent.metricsSpoolDir`.
The local agent tails those files, folds a minute's observations into one datum per
series, and posts once a minute. Going through disk is what lets a metric survive the
agent restarting, or the program exiting between flushes.

Reading them back, on the public listener:

```bash
TOKEN=$(jq -r .publicToken ~/.mini-cloud/secret.json)
curl -s -H "Authorization: Bearer $TOKEN" localhost:3001/metrics/namespaces
curl -s -H "Authorization: Bearer $TOKEN" 'localhost:3001/metrics/names?namespace=MyApp'
curl -s -H "Authorization: Bearer $TOKEN" 'localhost:3001/metrics/dimensions?namespace=MyApp&metricName=Latency'
curl -s -H "Authorization: Bearer $TOKEN" \
  "localhost:3001/metrics/data?namespace=MyApp&metricName=Latency&statistic=p99&periodMs=60000&from=$(( ($(date +%s) - 3600) * 1000 ))&dimension=Operation:Ingest"
```

A query names the **exact** dimension set it wants, as repeated `dimension=Name:Value`
parameters — a subset would sum across sets that each already counted the same
observation. `/metrics/dimensions` lists the sets available.

`/metrics/namespaces` and `/metrics/names` are paged: `limit` (default 100, maximum
1000) and `after`, which takes the previous response's `nextCursor`. The cursor is the
last name returned rather than an offset, so a metric first reported while you are
paging cannot shift a later page back onto entries you have already read. `nextCursor`
is absent on the last page.

```bash
curl -s -H "Authorization: Bearer $TOKEN" 'localhost:3001/metrics/names?namespace=MyApp&limit=50'
curl -s -H "Authorization: Bearer $TOKEN" 'localhost:3001/metrics/names?namespace=MyApp&limit=50&after=Latency'
```

Four things are worth knowing about what comes back:

- **Reads stop `metrics.queryLagMs` behind now.** Agents report independently, so the
  newest minute would otherwise hold only whichever machines reported first — a
  datapoint that dips and silently corrects itself. The response's `from` and `to` are
  the window actually read, after that and after flooring both ends to the period.
- **One read returns at most 1440 datapoints**, a day by the minute. A finer period over
  a longer range is refused, and the message names the smallest period that fits.
- **Data that arrives late still counts.** Rollups are updated as data lands rather than
  on a schedule, so an agent that was offline backfills into the hour and day it belongs
  to. Buckets older than `metrics.rawRetentionDays`, or more than two hours ahead, are
  refused and named in the response.
- **Percentiles need the distribution**, which only the 1-minute rows keep, so they are
  exact inside `metrics.rawRetentionDays` and refused beyond it rather than approximated
  from an average of percentiles.

Agents also report their own machine's CPU, memory and disk under `MiniCloud/Agent`, so
there is something to look at before anything is instrumented. Turn it off with
`agent.hostMetrics`.

The console's metrics page keeps its whole graph in the address, as
`/metrics?graph=<base64url of JSON>`, so a link shows exactly what its sender saw. The
JSON is a `MetricGraph` (`packages/shared/src/models/metric-graph.ts`): up to eight
queries, each an exact dimension set and a statistic, over a relative or absolute range.
`parseMetricGraph` checks it, and names the field that is wrong. To build a link by hand:

```bash
echo -n '{"version":1,"range":{"kind":"relative","durationMs":86400000},"queries":[{"id":"m1","namespace":"MyApp","metricName":"Latency","dimensions":{"Operation":"Ingest"},"statistic":"p99"}]}' \
  | base64 | tr '+/' '-_' | tr -d '=\n'
```

## Building the binary

```bash
npm run build                                # the bundle reads each package's dist
npm run build:sea:mac -w @mini-cloud/cli     # or build:sea:linux
# -> packages/cli/build/sea/mini-cloud
```

That first line is not optional — building against a stale `dist/` silently ships old
code. `build:sea:mac:signed` produces a Developer-ID-signed, notarized binary; see
[md/TODO.md](./md/TODO.md) for why releases do not use it.

## Releasing

Two tags, each naming what it ships.

```bash
# npm: @mini-cloud/shared + @mini-cloud/reporter
npm version 1.0.1 --workspace @mini-cloud/shared --workspace @mini-cloud/reporter --no-git-tag-version
git commit -am "chore: release 1.0.1"
git tag sdk-v1.0.1 && git push origin main --tags

# binaries: macOS arm64 + Linux x64/arm64, to the downloads bucket and a GitHub Release
git tag cli-v1.0.1 && git push origin cli-v1.0.1
```

The published version is whatever `package.json` says — `npm publish` reads it, and the
tag neither sets nor derives it. The tag triggers the run and is checked against both
manifests, so a disagreement fails the job instead of publishing a version nobody asked
for. (`cli-v*` is the other way round: that version *is* taken from the tag.)

`release-sdk.yml` builds, re-runs the tests against that exact commit, checks the tag
agrees with both `package.json` versions and with reporter's pin on shared, and
publishes `shared` before `reporter` —
npm does not verify a dependency resolves at publish time, so the reverse order leaves a
window where `npm install @mini-cloud/reporter` fails. Both packages move in lockstep,
because `reporter` pins `shared` exactly.

Authentication is npm Trusted Publishing over OIDC — no `NPM_TOKEN`. The binding is to
this repository **and this filename**, so renaming `release-sdk.yml` breaks publishing
until both packages' trusted publisher entries on npmjs.com match.

`release-cli.yml` builds, checks each binary runs and reports the tag's version, then
publishes to <https://mini-cloud.qinnan.dev/downloads/cli/>:

```
install.sh  version.json                  the latest release: revalidated on every request
v1.0.1/     install.sh  SHA256SUMS         one directory per release, never rewritten
            mini-cloud-{darwin-arm64,linux-x64,linux-arm64}.tar.gz
```

`version.json` is what `mini-cloud update` and `install.sh` read to find the latest
release, and is written last. A prerelease tag (`cli-v1.1.0-rc.1`) gets its directory
and a GitHub prerelease, and leaves `version.json` alone — install it with
`MINI_CLOUD_VERSION=1.1.0-rc.1`.

Two things the job refuses, both before anything is published. A tag that is not
`cli-v<major>.<minor>.<patch>[-prerelease]`, because that string becomes the manifest
every installed CLI polls and one the updater cannot parse breaks `update` everywhere
until a good tag replaces it. And a version whose directory already holds objects: it is
served as `immutable`, so rewriting it leaves caches and machines holding a year-old copy
of files this run replaced. **Retagging a partly-published release does not work — give
the fix a new version.**

It reaches AWS over OIDC too, through a role only this repository's `cli-v*` tags can
assume. It needs two repository secrets, both outputs of the `MiniCloudConsole` stack:

```bash
out() { aws cloudformation describe-stacks --stack-name MiniCloudConsole --region us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
gh secret set AWS_RELEASE_ROLE_ARN --body "$(out ReleaseRoleArn)"
gh secret set DOWNLOADS_BUCKET --body "$(out DownloadsBucketName)"
```

Secrets rather than variables because the repository is public, its workflow logs are
too, and the role ARN carries the account id.

## Deploying the hosted console

The copy at <https://mini-cloud.qinnan.dev> — and the downloads bucket behind
`/downloads/` — is a CDK stack in [`infra/`](./infra/README.md), deployed by hand from
this machine. A redeploy uploads whatever is in `packages/web/dist`, so build first:

```bash
aws sso login --profile mini-cloud           # when the SSO session has expired
export AWS_PROFILE=mini-cloud

npm run build -w @mini-cloud/web             # from the repository root
cd infra
npm install                                  # once, or after its package.json changes
npm run diff                                 # optional: what would change
npm run deploy
```

The profile must be for the account named in `infra/.env`, and CDK uses SSO profiles
as they are. `npm run deploy -- --profile mini-cloud` works too, instead of exporting.

The deploy invalidates `/index.html` itself, and everything under `assets/` is
content-hashed, so a reload shows the new console. To flush the whole cache anyway:

```bash
DIST_ID=$(aws cloudformation describe-stacks --stack-name MiniCloudConsole --region us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" --output text)
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*'
```

Anything in `packages/web/.env` is compiled into the bundle, so a
`VITE_MINI_CLOUD_TOKEN` there would ship to every visitor. Keep that file empty or
absent when building for this. First-time setup — `.env`, the hosted zone, bootstrapping
— is in [infra/README.md](./infra/README.md).
