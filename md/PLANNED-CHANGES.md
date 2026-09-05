# Planned changes

Agreed changes not yet implemented. Each entry states what is true today, what should
be true instead, and the decisions someone picking it up should not have to re-derive.
Delete an entry once it has shipped.

---

## 1. Exchange the shared token for a console session

**Today.** One static token, `MINI_CLOUD_PUBLIC_TOKEN`, shared by the console and the
CLI (`middleware/auth.ts`, `cli/src/client-factory.ts`). It never expires, and revoking
it means rotating one value and re-entering it everywhere it was typed. A script that
reads the console's `localStorage` gets it.

Agents are no longer in that blast radius: the internal listener authenticates nobody
and authorizes by source address (`middleware/subnet-filter.ts`, and the same check on
the upgrade in `facades/message-hub.ts`), so rotating the operator's token no longer
touches the fleet. What the token still guards is everything a person can do — creating
a task is arbitrary code on every machine that runs it.

**Change.** The setup screen sends the secret once to a login endpoint and receives a
session token scoped to that browser. The static secret never reaches storage.

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

**The CLI keeps the static token.** A script is not a browser; a long-lived secret in
the environment is the right credential for one, and rotating a session out from under
a cron job at 3am solves no problem anyone has. The session layer is console-only.

Agents need nothing from this entry — they hold no credential at all now. Whether they
should is §2's open question, and it is independent of this one.

**Start with one session token, not an access/refresh pair.** The usual reason to
split them is keeping the long-lived half in an httpOnly cookie. The console and the
service are cross-site (`https://…cloudfront.net` → `http://localhost:3001`),
so that cookie needs `SameSite=None; Secure` and dies to third-party cookie blocking
in Safari today and Chrome shortly. The refresh token would live in `localStorage`
beside the access token, which reduces the split's benefit to a shorter exposure
window — real, but not what pays for the machinery. A single token with a sliding
expiry and server-side revocation gets most of it, and the pair can be introduced
later without changing where the browser stores things.

**Login needs a rate limit and a constant-time compare.** `bearerTokenAuth` compares
with `!==` today, which is fine for a header on every request and not fine for an
endpoint whose whole job is checking a secret. There is no rate limiting anywhere in
the service yet, so this is the first of it.

**Never put the secret in a URL.** The shipped `?backend=` parameter carries the service URL only. Tokens in
query strings end up in history, logs and referrers.

### Open

- Is the setup secret `MINI_CLOUD_PUBLIC_TOKEN` itself, or a separate console password?
  The first is an exchange endpoint and nothing more. The second needs argon2id hashing
  and a way to set and change it — but no longer an answer to "what if it is unset",
  since the listener refuses to start without one. Worth it only if console access
  should be revocable without also re-configuring the CLI.
- Session lifetime and whether idle expiry slides. A home lab operator leaving a tab
  open for a month is the normal case, not an anomaly.

### Files

- `packages/service/migrations/002_*.sql` — the session table. Never edit `001`.
- `packages/service/src/data/` — `session-dao.ts` + `pg-session-dao.ts`, following the Input/Output convention.
- `packages/service/src/routes/` — `auth-endpoints.ts`: login, logout, and a "who am I / is this still valid" probe the console can call on load.
- `packages/service/src/middleware/auth.ts` — accept either the static token or a live session token; keep `/ping` and `/health` public, which the setup screen's probe depends on to tell a service that is down from one that is refusing it.
- `packages/service/src/middleware/` — new rate limiter for the login route.
- `packages/service/src/dependencies/dependency-factory.ts` — the login route and the rate limiter belong to the public listener only. Nothing from this entry goes near the internal one.
- `packages/web` — the setup screen posts the secret instead of storing it; storage holds the session token; a 401 anywhere sends the user back to the screen.
- `dev.md`, `README.md` — what the console stores, and how to revoke a session.

---

## 2. Give each caller a credential of its own

**Shipped from the original version of this entry.** `MINI_CLOUD_TOKEN` is gone. The
fleet-wide secret four kinds of caller shared no longer exists, and it went without the
transition this entry planned — there was no deprecation window, because the variable
was removed in the same `!` release that split the listeners.

What replaced it was not per-caller credentials but a split by *listener*:

| Caller | Today |
| --- | --- |
| Console | `MINI_CLOUD_PUBLIC_TOKEN`, stored in the browser |
| CLI | The same `MINI_CLOUD_PUBLIC_TOKEN`, from the environment or `--token` |
| Agent | Nothing. Admitted by source address (`MINI_CLOUD_TRUSTED_SUBNETS`) |

**Today's gap, therefore.** One secret is still shared between the console and the CLI,
identifies nobody, and expires never — §1 covers the console half of that. And an agent
is admitted without being identified: the subnet check proves a connection came from
the home network, not which agent is on the other end of it.

**Change.** Credentials that are issued, labelled and revocable individually. Not
"remove long-lived tokens" — a cron job cannot log in — but "stop having one secret two
kinds of caller share, and stop admitting a fleet member without knowing which one it
is".

### The successors

| Caller | Replacement |
| --- | --- |
| Console | Session token from §1 |
| CLI, interactive | `mini-cloud login`, session stored at `~/.mini-cloud/credentials` (0600) |
| CLI, scripted | A labelled API key with no expiry, revocable from the console |
| Agent | Per-agent token — **not agreed**, see below |

So the store from §1 holds credential *kinds*, not only browser sessions. Design it
that way from the start; retrofitting a `kind` column across live rows is the kind of
migration worth avoiding.

### Open: are per-agent tokens still wanted?

This was settled when every agent already carried a secret, and adding a *per-agent*
one cost nothing extra to distribute. It is a real decision now that agents carry
none.

**For.** A credential bound to an agent id *proves* the id. The collision problem
recorded below — two processes claiming `laptop-1`, each receiving the other's
commands, which the hostname default makes likelier — stops being possible: the second
process cannot complete the WebSocket upgrade without that agent's token. It also gives
the console something it cannot do today, which is deauthorize one machine without
re-addressing the whole subnet.

**Against.** Address-only is the arrangement that just shipped, and it is deliberate:
a home fleet is machines the operator owns on a network they control, and a secret
distributed to every one of them bought identity nobody was checking. Per-agent tokens
put that distribution problem back, plus an enrolment flow, plus a revocation UI, to
defend against an attacker who is already inside the LAN — which is the same attacker
the subnet check has already decided to trust.

**What actually turns on it.** The threat is a *second process on a trusted machine*
claiming an id that belongs to another: a stale agent left running after a rename, a
container that inherited a hostname, a housemate's laptop. The subnet check cannot see
any of those. If that risk is real enough to act on, the cheap fallback below detects
it after the fact without any distribution problem; per-agent tokens prevent it.

Deciding "no" is a legitimate outcome, and it makes the collision sketch below the
plan rather than the fallback. Deciding "yes" needs an enrolment flow: the console
issues a token for a new agent id and shows it once; the operator puts it in the
agent's environment. Whether an unknown agent may self-enrol on first heartbeat, or
must be pre-registered, is what sets how much it actually protects.

### Bootstrap

Something must authenticate the first login on a fresh install. Preference: generate a
one-time setup token on first start and print it to the log (k3s, Jupyter), honoured
once to establish the operator's credential. Unlike first-request-claims-the-instance
there is no window during which the service is open. Keep an environment variable for
unattended installs.

Half of this is already in place: `MINI_CLOUD_PUBLIC_TOKEN` is required at startup, so
a fresh install has a credential before it accepts a request. The remaining question is
whether it stays the operator's password or becomes the one-time secret exchanged for
one.

### The default is already heavier — that argument is spent

This entry used to argue for keeping authentication optional, with an explicit
`MINI_CLOUD_AUTH=none` opt-out, because unset meant no authentication and `npm start`
needed no setup. That is no longer the starting position: the public listener refuses
to start without `MINI_CLOUD_PUBLIC_TOKEN`, so the first five minutes already cost a
generated secret and a paste into the console.

Two things survive from it, and are worth holding on to:

- **Importing must not require configuration.** `config` resolves in a module-level
  initialiser and the CLI imports it for every command, so the token is read as
  optional and enforced where a listener is built. Reading it as required made
  `mini-cloud --help` die on a missing variable. Whatever §1 and §2 add, they add it at
  the same place.
- **The tests need no environment.** The suite runs with nothing set, and should keep
  doing so. A session layer that cannot be constructed without a secret would end that.

### Path

The removal already happened, in the `!` release that split the listeners. There is no
transition to design: nothing reads `MINI_CLOUD_TOKEN` any more, in the service, the
CLI or the agent.

### Files

Everything in §1, plus:

- `packages/service/src/facades/message-hub.ts` (`buildVerifyClient`) — if agents get credentials, the upgrade check resolves one instead of only matching an address; this is where id binding would be enforced.
- `packages/agent/src/agent-config.ts`, `packages/agent/src/agent.ts` — the agent holds no token at all today. Restoring one means the config field, the client and subscriber wiring, and what the agent does when it is rejected (stop, rather than reconnect forever).
- `packages/cli/src/cli.ts`, `packages/cli/src/client-factory.ts` (`resolveToken`) — `login`/`logout`, the credentials file, `--token` kept for CI.
- `packages/web` — issuing, labelling, listing and revoking credentials needs a page.
- `dev.md`, `README.md`, `packages/web/README.md` — done for the variable rename; they will need the session and credential story when it lands.

---

## 3. Publish a hosted console at `mini-cloud.qinnan.dev` (CDK: S3 + CloudFront + ACM)

Runtime backend selection has shipped, so the bundle no longer bakes in a service URL
and one deployment is usable by anyone.

**Status.** Deployed and serving at <https://mini-cloud.qinnan.dev>: `infra/`, one stack
in `us-east-1`, imported hosted zone, deployed by hand.

The site serves the current bundle, so a visitor is asked which service to talk to
rather than being wired to `http://127.0.0.1:3001`. Redeploy with a rebuild and
`npm run deploy` in `infra/`.

**Reaching a local service from it works, once the visitor allows it.** Verified in
Chrome against the live site: the fetch to the service's public listener is refused with
`blocked by CORS policy: Permission was denied for this request to access the
'loopback' address space` until Local Network Access is granted, and succeeds
immediately afterwards. Nothing on the service side is involved either way.

One wrinkle that follows: the `?backend=` link connects straight away, so Chrome raises
that permission prompt against a background poll rather than against the click on the
setup screen's verify button, which is where the prompt was meant to be provoked. It is
still attached to a page the visitor has just opened deliberately, so it is not
context-free — but if it reads as abrupt, the fix is to route a query-parameter
connection through the same confirm step rather than straight into the console.

What is left is the doc links below, and they wait on §1: a console anyone can point at
their own service is worth announcing, and one that asks them to keep a static token
that never expires in browser storage to do it is not. It is no longer fleet-wide —
agents do not use it — but it is still every operation a person can perform, held in a
browser on an origin shared with every other visitor.

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
rewrites or kills the console's requests to `http://localhost:3001` — the only backend
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
`http://localhost:3001` or `http://127.0.0.1:3001`, the public listener's port. A LAN
address never works from an HTTPS page, Chrome asks the user's permission before
allowing even loopback, and **Safari refuses it outright**, so no iOS browser can use
that path at all. Anyone stuck there should serve the console from the same box as
their service instead — the bundle is static and `packages/web/README.md` already says
how.

### The stakes this raises

Smaller than when this was written, because the public listener now requires a token:
a page the visitor happens to be on can still *reach* the service under the `*` CORS
default (`DEFAULT_CORS_ORIGINS` in `stage-config.ts`), but it gets a 401 rather than a
launch. What it can still do unauthenticated is `/ping` and `/health`, which is enough
to discover that a mini-cloud is running on this machine and nothing more.

The remaining exposure is the token itself sitting in `localStorage` on the console's
origin. It is origin-scoped, so an unrelated page cannot read it — but the hosted
console is one origin shared by everyone who uses it, and anything that gets script
execution there gets every visitor's token. That is the argument for §1 landing before
the site is advertised, and for the hosted console telling people to narrow
`MINI_CLOUD_CORS_ORIGINS` to its origin in the meantime.

There is also a trust obligation: visitors point a page served from a domain we control
at a service that runs programs on their machines. Keep the deployment reproducible
from a tag, publish what the site does, and ship no analytics, no third-party scripts
and no baked credentials.

### Cost

Inside CloudFront's free tier at this traffic. ACM certificates are free. A Route 53
hosted zone is about $0.50/month, only if DNS moves there.

### Files

- ~~`infra/` — CDK app, stack, `cdk.json`, `package.json`, a README covering bootstrap and the DNS choice.~~ Done.
- `packages/web/README.md`, `dev.md`, `README.md` — link the hosted console, and state next to the link which services it can reach, so nobody discovers that as a bug. Not yet: the live site serves a stale bundle, and announcing it before §1 means telling people to keep a never-expiring token in browser storage, on an origin shared with every other visitor.

---

## Recorded, not agreed

### Detect two agents claiming one id

Identity is self-asserted today and nothing validates it. The service cannot tell two
processes apart, because the heartbeat carries only `{agentId, name}` — a restart and
an impostor look identical.

**Now the live gap, not a superseded one.** The subnet check admits a connection from
the home network without saying which agent is on the other end, so nothing about the
listener split narrowed this. Two processes claiming `laptop-1` still look like one
agent restarting.

If §2 grows per-agent tokens, this is superseded: a token bound to an id proves the id
at the upgrade, which beats detecting a collision after the fact. If §2 decides against
them — a live option, see its open question — this sketch is the plan: the agent
generates a session id at boot and sends it with each heartbeat, and the service
rejects, or at least logs loudly, when it changes while `last_seen_at` is still inside
the offline window. It costs one column and no distributed secret.
