# Planned changes

Agreed changes not yet implemented. Each entry states what is true today, what should
be true instead, and the decisions someone picking it up should not have to re-derive.
Delete an entry once it has shipped.

---

## 1. Print the console link at startup

Left over from runtime backend selection, which has otherwise shipped. It was written
as a nice-to-have inside that entry and deleted with it by mistake; nothing here is
implemented.

`server.ts:64` logs the listening address. Print a second line with a link that opens
the console already pointed at this service, so first-time setup is a click rather
than a copied hostname and a typed port:

```
Open the console: https://mini-cloud.qinnan.dev/?backend=http%3A%2F%2F127.0.0.1%3A3000
```

**Only when loopback reaches the service.** Bound to `127.0.0.1` or `0.0.0.0`, a
browser on the same machine reaches `http://127.0.0.1:3000` and the link works. Bound
to a specific LAN address it does not, and the LAN URL could not work from an HTTPS
console either — print nothing there rather than a link that fails. The bind address
is `config.host` (`stage-config.ts:46`), so the rule is local to the one place that
already knows it.

**`http`, and percent-encoded.** The service speaks plain HTTP; an `https://localhost`
link fails to connect. Encode the value — `encodeURIComponent` — so the query survives
a value with a path or credentials in it later. It costs readability in the terminal
and buys correctness.

**Make the console URL configuration, not a constant.** `MINI_CLOUD_CONSOLE_URL`,
defaulting to the hosted deployment, pointed at a self-hosted console by anyone who
serves their own, and empty to suppress the line entirely. A service that hardcodes
one maintainer's domain into everyone's startup banner is presumptuous even when, as
here, nothing is sent anywhere.

**No token in the link, ever.** After §2 the console still needs the secret, and it is
tempting to carry it here. Do not: the URL gets pasted into a browser, which puts it in
history, and the `Referer` on the first request hands it to the console origin's access
logs. §2 already rules this out.

### Files

- `packages/service/src/stage-config.ts` — `MINI_CLOUD_CONSOLE_URL`, defaulting to the hosted deployment, empty to suppress the line.
- `packages/service/src/server.ts:64` — the second log line, and the bind-address rule that decides whether to print it at all.
- `dev.md` — the new variable in the service table.

---

## 2. Exchange the shared token for a console session

**Today.** One static token for everything (`middleware/auth.ts`): the CLI sends it,
every agent sends it on its WebSocket upgrade (`facades/message-hub.ts:68-80`), and
the setup screen keeps it in `localStorage`. It never expires, the only way
to revoke it is to rotate `MINI_CLOUD_TOKEN` and restart every agent, and a script
that reads the console's storage gets the credential to the whole fleet.

**Change.** The setup screen sends the secret once to a login endpoint and receives a
session token scoped to that browser. The fleet secret never reaches storage.

### Decisions

**Opaque tokens, not JWTs.** Every request reaches Postgres already, so stateless
verification buys nothing and costs signing keys, expiry skew and the inability to
revoke before a token expires. Generate 32 random bytes, store `sha256(token)`, look
it up on each request. A signed fast path can be added later; JWT semantics are hard
to walk back.

**Postgres, not DynamoDB.** mini-cloud runs on machines the operator already owns and
`npm start` needs nothing but a local database. One table does not justify an AWS
dependency, credentials to manage and a second store to reason about. New migration:
`session(session_id, token_hash, created_at, expires_at, last_used_at, revoked_at,
label)` — `label` so the console can show "this browser, since Tuesday" and revoke one
session rather than all of them.

**Agents and the CLI keep the static token.** A daemon is not a browser; a long-lived
secret in a config file is the right credential for one, and rotating a session out
from under a Raspberry Pi at 3am solves no problem anyone has. The session layer is
console-only. It also opens the door to a separate console secret later, so revoking
browser access stops requiring a fleet restart.

**Start with one session token, not an access/refresh pair.** The usual reason to
split them is keeping the long-lived half in an httpOnly cookie. The console and the
service are cross-site (`https://…cloudfront.net` → `http://localhost:3000`),
so that cookie needs `SameSite=None; Secure` and dies to third-party cookie blocking
in Safari today and Chrome shortly. The refresh token would live in `localStorage`
beside the access token, which reduces the split's benefit to a shorter exposure
window — real, but not what pays for the machinery. A single token with a sliding
expiry and server-side revocation gets most of it, and the pair can be introduced
later without changing where the browser stores things.

**Login needs a rate limit and a constant-time compare.** `auth.ts:33` compares with
`!==` today, which is fine for a header on every request and not fine for an endpoint
whose whole job is checking a secret. There is no rate limiting anywhere in the
service yet, so this is the first of it.

**Never put the secret in a URL.** The shipped `?backend=` parameter carries the service URL only. Tokens in
query strings end up in history, logs and referrers.

### Open

- Is the setup secret `MINI_CLOUD_TOKEN` itself, or a separate console password? The
  first is an exchange endpoint and nothing more. The second needs argon2id hashing, a
  way to set and change it, and answers to "what if it is unset" — worth it only if
  console access should be revocable independently of the fleet.
- Session lifetime and whether idle expiry slides. A home lab operator leaving a tab
  open for a month is the normal case, not an anomaly.

### Files

- `packages/service/migrations/002_*.sql` — the session table. Never edit `001`.
- `packages/service/src/data/` — `session-dao.ts` + `pg-session-dao.ts`, following the Input/Output convention.
- `packages/service/src/routes/` — `auth-endpoints.ts`: login, logout, and a "who am I / is this still valid" probe the console can call on load.
- `packages/service/src/middleware/auth.ts` — accept either the static token or a live session token; keep `/ping` public.
- `packages/service/src/middleware/` — new rate limiter for the login route.
- `packages/web` — the setup screen posts the secret instead of storing it; storage holds the session token; a 401 anywhere sends the user back to the screen.
- `dev.md`, `README.md` — what the console stores, and how to revoke a session.

---

## 3. Retire `MINI_CLOUD_TOKEN`

**Today.** One shared static secret authenticates everything: the console, the CLI,
and every agent's WebSocket upgrade (`middleware/auth.ts`,
`facades/message-hub.ts:68-80`, `packages/cli/src/client-factory.ts:21`,
`packages/agent/src/agent-config.ts:54`). It identifies nobody, expires never, and
revoking it means rotating one value and restarting the fleet.

**Change.** Replace it with credentials that are issued, labelled and revocable
individually. Not "remove long-lived tokens" — a cron job cannot log in — but "stop
having one secret that four different kinds of caller share".

### The four successors

| Caller | Replacement |
| --- | --- |
| Console | Session token from §2 |
| Agent | Per-agent token, issued at enrolment |
| CLI, interactive | `mini-cloud login`, session stored at `~/.mini-cloud/credentials` (0600) |
| CLI, scripted | A labelled API key with no expiry, revocable from the console |

So the store from §2 holds credential *kinds*, not only browser sessions. Design it
that way from the start; retrofitting a `kind` column across live rows is the kind of
migration worth avoiding.

### Why per-agent tokens are worth more than the auth cleanup

A credential bound to an agent id *proves* the id. The collision problem recorded
below — two processes claiming `laptop-1`, each receiving the other's commands, which
the shipped hostname default makes likelier — stops being possible: the
second process cannot complete the WebSocket upgrade without that agent's token.
Enrolment replaces the boot-session-id sketch entirely, and gives the console
something it cannot do today, which is deauthorize one machine.

Enrolment needs a flow: the console issues a token for a new agent id and shows it
once; the operator puts it in the agent's environment or config file. Whether an
unknown agent may self-enrol on first heartbeat, or must be pre-registered, is the
decision that sets how much this actually protects.

### Bootstrap

Something must authenticate the first login on a fresh install. Preference: generate a
one-time setup token on first start and print it to the log (k3s, Jupyter), honoured
once to establish the operator's credential. Unlike first-request-claims-the-instance
there is no window during which the service is open. Keep an environment variable for
unattended installs.

### Do not make the default heavier

Unset means no authentication today, and the service binds `127.0.0.1`
(`stage-config.ts:46`), so `npm start`, the CLI and the tests need no setup at all.
Mandatory auth costs every one of those a login step. Keep an explicit opt-out —
`MINI_CLOUD_AUTH=none`, warned about loudly at startup — rather than inferring it from
the bind address, which would be magic that fails silently the day someone changes
`MINI_CLOUD_HOST`.

### Path

Accept both during a transition: a configured `MINI_CLOUD_TOKEN` keeps working and
logs a deprecation line naming what replaces it for that caller. Remove it in a later
release, as a `!` commit — it is a breaking change for anyone running agents.

### Files

Everything in §2, plus:

- `packages/agent/src/agent-config.ts:54`, `packages/agent/src/agent.ts` — per-agent token, and what the agent does when it is rejected (stop, rather than reconnect forever).
- `packages/service/src/facades/message-hub.ts:68-80` — the upgrade check resolves a credential instead of comparing a string; this is where id binding is enforced.
- `packages/cli/src/cli.ts:40`, `packages/cli/src/client-factory.ts:21` — `login`/`logout`, the credentials file, `--token` kept for CI.
- `packages/web` — issuing, labelling, listing and revoking credentials needs a page.
- `dev.md:78,139,169`, `README.md:133`, `packages/web/README.md:32,47` — every documented mention of the shared token.

---

## 4. Publish a hosted console at `mini-cloud.qinnan.dev` (CDK: S3 + CloudFront + ACM)

Runtime backend selection has shipped, so the bundle no longer bakes in a service URL
and one deployment is usable by anyone.

**Status.** Deployed and serving at <https://mini-cloud.qinnan.dev>: `infra/`, one stack
in `us-east-1`, imported hosted zone, deployed by hand.

**The live site still serves the bundle from before runtime backend selection**, so it
is hardwired to `http://127.0.0.1:3000` with no setup screen until someone rebuilds and
runs `npm run deploy` in `infra/`. Do that before writing the doc links below, and not
before authentication ships — a console anyone can point at their own service is worth
announcing, and one that stores a fleet-wide static token to do it is not.

**Why.** Convenience only. Someone who wants to look at the console should not have to
clone the repo, install a toolchain and run vite first. Self-hosting stays the primary
path: the hosted copy is a static client that stores nothing and knows nothing until
the visitor tells it where their service is.

### What the stack creates

- A private S3 bucket — block all public access, no website endpoint. CloudFront
  reaches it through Origin Access Control, so the bucket is never a public origin.
- A CloudFront distribution: `index.html` as the default root object, HTTP redirected
  to HTTPS, compression on.
- An ACM certificate for `mini-cloud.qinnan.dev`. **CloudFront only accepts
  certificates from `us-east-1`**, whatever region the rest of the stack is in. The
  simplest answer is to put the whole stack in `us-east-1`; the alternative is a
  second stack and cross-region references, which is machinery for nothing here.
- DNS. Settled: `mini-cloud.qinnan.dev` is its own Route 53 zone, delegated from
  `qinnan.dev`, so CDK owns the whole flow — the zone is imported by id, the certificate
  is DNS-validated against it, and A/AAAA aliases at the zone apex point at the
  distribution. The zone id and account id are read from `infra/.env`, never committed.
- A bucket deployment of `packages/web/dist`, with an invalidation.

### Decisions

**Serve at the domain root.** No Vite `base`, no router `basename` — today's defaults
are already correct for a root-hosted site, and a subpath would put the same value in
two files that must be kept in step (`vite.config.ts` and `app.tsx:49`).

**Map 403 *and* 404 to `/index.html` with status 200.** react-router owns the paths, so
a deep link must reach the bundle. With OAC over a private bucket a missing key comes
back as **403, not 404** — mapping only 404 is the bug everyone hits once.

**Two cache policies, set at upload time.** `index.html` gets `no-cache`, so a deploy
is visible on the next reload; `/assets/*` is content-hashed by Vite and gets
`max-age=31536000, immutable`. That means two bucket deployments (cache-control is set
per deployment) and an invalidation limited to `/index.html`.

**Never send `upgrade-insecure-requests` or `block-all-mixed-content`.** Either one
rewrites or kills the console's requests to `http://localhost:3000` — the only backend
a hosted copy can reach over plain HTTP. This is the one header that would silently break
the entire product on the hosted domain. If a CSP is added, `connect-src` must stay
open for the same reason.

HSTS is fine: it applies to the console's own origin and says nothing about requests
to a different one. Pair it with `X-Content-Type-Options: nosniff`, a `Referrer-Policy`
and `frame-ancestors 'none'`.

**Bake no `VITE_MINI_CLOUD_API_URL`.** Its absence is what makes every visitor see the
setup prompt. Baking a URL would point strangers at a service that is not theirs.

**Put the CDK app in `infra/`, outside `packages/`.** It imports nothing of ours and is
not part of `npm run build`; as a workspace member it would pull `aws-cdk-lib` into
every install and into the build graph. The cost is its own `package.json` and a
second `npm ci` in CI, which is the cheaper half of that trade.

**Deploy by hand, for now.** `npm run deploy` in `infra/`, from a machine with
credentials. A release that ships a few times a year does not yet justify an OIDC
provider, a deploy role and a workflow to maintain, and the stack is the same either
way. When it is worth automating, the pattern is established: `.github/workflows/pr.yml`
already requests `id-token: write`, so the workflow assumes a deploy role over OIDC —
never access keys — builds `packages/web` and runs `cdk deploy`.

### Say what it can and cannot do, on the page

Two paths, and the page leads with the one that works everywhere. The shipped setup
screen already carries this copy; keep the two in step.

A service behind TLS at a real domain is reachable from any browser and any device,
including a phone, and needs only `MINI_CLOUD_CORS_ORIGINS` set to this origin.

A service on plain HTTP has to be on the same machine as the browser —
`http://localhost:3000` or `http://127.0.0.1:3000`. A LAN address never works from an
HTTPS page, Chrome asks the user's permission before allowing even loopback, and
**Safari refuses it outright**, so no iOS browser can use that path at all. Anyone
stuck there should serve the console from the same box as their service instead — the
bundle is static and `packages/web/README.md:109` already says how.

### The stakes this raises

A public page that can reach `localhost` makes the CORS default worth revisiting:
`MINI_CLOUD_CORS_ORIGINS` defaults to `*` (`stage-config.ts:52`), so *any* page a user
visits can already drive their service, and their service launches processes on their
machine. Authentication (§2, §3) is the real mitigation — a session token in
`localStorage` is origin-scoped, so an unrelated page cannot use it — and until that
ships, the hosted console should tell people to narrow the variable to its origin.

There is also a trust obligation: visitors point a page served from a domain we control
at a service that runs programs on their machines. Keep the deployment reproducible
from a tag, publish what the site does, and ship no analytics, no third-party scripts
and no baked credentials.

### Cost

Inside CloudFront's free tier at this traffic. ACM certificates are free. A Route 53
hosted zone is about $0.50/month, only if DNS moves there.

### Files

- ~~`infra/` — CDK app, stack, `cdk.json`, `package.json`, a README covering bootstrap and the DNS choice.~~ Done.
- `packages/web/README.md`, `dev.md`, `README.md` — link the hosted console, and state next to the link which services it can reach, so nobody discovers that as a bug. Not yet: the live site serves a stale bundle, and announcing it before §2 means telling people to keep a fleet-wide token in browser storage.

---

## Recorded, not agreed

### Detect two agents claiming one id

Identity is self-asserted today and nothing validates it. The service cannot tell two
processes apart, because the heartbeat carries only `{agentId, name}` — a restart and
an impostor look identical.

**Superseded by §3 if that ships.** A per-agent token bound to an agent id proves the
id at the WebSocket upgrade, which is a stronger guarantee than detecting a collision
after the fact. Keep the sketch only as the cheap fallback if §3 is deferred: the
agent generates a session id at boot and sends it with each heartbeat, and the service
rejects — or at least logs loudly — when it changes while `last_seen_at` is still
inside the offline window.
