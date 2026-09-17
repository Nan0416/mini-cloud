# infra — the hosted console and the downloads

One CDK stack, `MiniCloudConsole`, that serves the browser console as a static site at
a domain you own, and the `mini-cloud` binaries under `/downloads/` on the same domain.
Nothing else in mini-cloud needs AWS: the control plane, the agents and the CLI run on
machines you already have. This exists so that someone who wants to *look* at the
console does not have to clone the repo and run Vite first, and so that `install.sh` and
`mini-cloud update` have somewhere cheap to download from.

The hosted copy is a static client. It stores nothing, and it knows nothing until the
visitor tells it where their own mini-cloud is.

## Why this lives outside `packages/`

It imports nothing of ours and is not part of `npm run build`. As a workspace member it
would pull `aws-cdk-lib` into every install and into the build graph for everyone,
including people who will never deploy anything. The cost of keeping it out is this
directory's own `package.json` and a second `npm install`.

That also means the root `npm run lint` and `npm run format:lint` do not reach it —
`npm run typecheck` and `npm run format:lint` **in this directory** do.

## What the stack creates

| Resource | Notes |
| --- | --- |
| S3 bucket | The console. Private. All public access blocked, no website endpoint. Reached only through the distribution |
| CloudFront distribution | `index.html` as the root object, HTTP redirected to HTTPS, compression on, HTTP/2 and /3 |
| Downloads bucket | The binaries, under `downloads/cli/`. Private, retained when the stack is destroyed, served at `/downloads/*` |
| IAM role `mini-cloud-cli-release` | What `release-cli.yml` assumes over GitHub's OIDC to write to the downloads bucket |
| Origin Access Control | How CloudFront reaches the bucket, so the bucket is never a public origin |
| Response headers policy | HSTS, `nosniff`, `no-referrer`, `frame-ancestors 'none'` — and deliberately nothing about mixed content |
| ACM certificate | DNS-validated against the hosted zone |
| Route 53 A + AAAA aliases | Pointing at the distribution |
| Two bucket deployments | `packages/web/dist`, split so the two halves get opposite cache headers |

Everything is in **`us-east-1`**, because CloudFront accepts a certificate from no
other region. The alternative — a certificate stack in `us-east-1` and everything else
somewhere else — buys a cross-region reference and nothing this project needs.

## Before the first deploy

1. **Configure it.** Copy `.env.example` to `.env` and fill in the five values. That
   file is gitignored: an account id and a hosted zone id identify one person's AWS
   estate, so neither belongs in the source.

   ```bash
   cp .env.example .env
   ```

2. **Have a hosted zone.** This stack *imports* one by id; it does not create it. DNS
   for the domain has to already be served by Route 53 in the same account, or the
   certificate never validates and the alias records point from a zone nobody asks.

   A zone delegated to the console alone works and is what this deployment uses — then
   `MINI_CLOUD_ZONE_NAME` and `MINI_CLOUD_CONSOLE_DOMAIN` are the same name and the
   aliases sit at the zone apex, which is fine because they are alias records and not
   CNAMEs.

   ```bash
   aws route53 list-hosted-zones            # ids print as /hostedzone/Z…; use the Z… part
   ```

   **Check the delegation resolves before deploying.** If the parent zone does not point
   at this zone's nameservers, ACM validation never completes and `cdk deploy` sits for
   half an hour before failing — a five-second check against a public resolver saves it:

   ```bash
   dig +short NS mini-cloud.qinnan.dev @8.8.8.8    # must list this zone's nameservers
   ```

3. **Have GitHub's OIDC provider in the account.** The stack imports
   `token.actions.githubusercontent.com` rather than creating it, because an account
   holds one per issuer and this one already had it. In an account without one, create
   it once:

   ```bash
   aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com --client-id-list sts.amazonaws.com
   ```

4. **Bootstrap the account**, once per account and region:

   ```bash
   npx cdk bootstrap aws://$(grep MINI_CLOUD_AWS_ACCOUNT .env | cut -d= -f2)/us-east-1
   ```

5. **Build the console.** The stack uploads `packages/web/dist`, and synth fails with a
   message saying so if it is not there:

   ```bash
   npm run build -w @mini-cloud/web       # from the repository root
   ```

## Deploying

```bash
npm install                # in this directory, once
npm run typecheck
npm run diff               # what would change
npm run deploy
```

**The first deploy waits.** ACM issues the certificate only after its validation record
resolves, so `cdk deploy` sits on the certificate for a few minutes while Route 53
propagates. That is normal and only happens once.

Rebuild the console and `npm run deploy` again to publish a new version. The
distribution id and the site URL are stack outputs.

After the first deploy, give the release workflow the two secrets it reads, from the
`ReleaseRoleArn` and `DownloadsBucketName` outputs — [dev.md](../dev.md#releasing) has
the commands. Binaries are never deployed from here; a `cli-v*` tag publishes them.

## Downloads

`/downloads/*` is a second behavior on the console's distribution, pointed at its own
bucket. It lives in this stack rather than a second one because the behavior has to be
on this distribution, and a separate stack would reference the distribution while this
one referenced its bucket — a cycle.

**403 and 404 mean different things here, and that is what keeps both halves working.**
CloudFront's custom error responses apply to the whole distribution — there is nowhere
to put one on a single behavior — so the rule that sends the console's deep links to
`index.html` covers `/downloads/*` too. It maps **403 only**, and the two buckets
answer differently on purpose:

- **The console bucket grants no LIST**, so S3 will not confirm a key's absence and
  answers 403 for `/tasks`. That is what the mapping catches, and react-router takes it
  from there.
- **The downloads bucket grants LIST**, so a file that is not there answers 404 — a code
  nothing maps, so it reaches the viewer as a 404 and `curl -f` fails on it rather than
  writing this page to disk with a 200.

Granting the console bucket LIST, or taking it from the downloads bucket, breaks one of
those two. CDK warns about LIST because on a *default* behavior it lets a request for
`/` list the bucket; no request reaches the downloads bucket at its root, and the
warning is acknowledged in the stack.

**The release workflow sets the caching.** A version's directory is uploaded with
`immutable`, and `install.sh` and `version.json` at the top with `no-cache`, which the
`CachingOptimized` policy honours by revalidating — so a release needs no invalidation.

**The bucket is retained.** Unlike the console's bucket, whose contents are `vite build`
output, a release rebuilt from its tag is not the same bytes as the one whose checksums
people already have. `cdk destroy` leaves it; delete it by hand if you mean to.

**The role can do one thing**: `s3:PutObject` under `downloads/cli/`, for a session
started by a `cli-v*` tag of `MINI_CLOUD_GITHUB_REPOSITORY`. A branch, a pull request or
another repository cannot assume it.

## Do not add these headers

This is the one thing in the stack that would break the product silently.

A hosted console at `https://…` calls a mini-cloud at `http://localhost:3000`. That is
mixed content, permitted only because loopback is treated as potentially trustworthy.
**`upgrade-insecure-requests` and `block-all-mixed-content` each destroy that**, one by
rewriting the request to `https://` and one by blocking it — and the page still loads
perfectly, so nothing looks wrong until every request fails.

The CSP names `frame-ancestors` and nothing else for the same reason: directives left
unset stay unrestricted, so `connect-src` remains open. A `default-src` would close it
by implication. The console's whole job is calling a service at an origin no policy
written here can predict.

HSTS is fine. It governs how a browser reaches *this* origin and says nothing about
where the page's own requests go.

## Caching

Two bucket deployments, because `Cache-Control` is set per deployment:

- `assets/*` — content-hashed by Vite, so `max-age=31536000, immutable`. The name
  changes whenever the bytes do, and these never need invalidating.
- `index.html` — `no-cache`, so a deploy is visible on the next reload, with the
  invalidation limited to that one path.

Both set `prune: false`, which is not an optimisation. Pruning deletes whatever is in
the bucket and not in *that* deployment's source, so the assets deployment would delete
`index.html` and the index deployment would delete every asset. It also leaves the
previous build's hashed assets in place, which is what a visitor still holding the old
`index.html` needs during a rollout.

## What it can and cannot reach

**A service behind TLS, anywhere.** Given a real certificate and a domain, the hosted
console reaches it from any browser on any device — including a phone, which is the
point of having a hosted copy at all. The only requirement on the service is
`MINI_CLOUD_CORS_ORIGINS=https://mini-cloud.qinnan.dev`. Nothing in this stack needs to
change for it.

**A service on plain HTTP, only on the machine running the browser.** An HTTPS page may
call `http://localhost:3000` or `http://127.0.0.1:3000` because loopback is treated as
potentially trustworthy — but not in Safari, which has never implemented that exemption
(WebKit bug 171934, open since 2017), so no iOS browser can use this path. Chrome 142+
also gates it behind a Local Network Access permission prompt. A LAN address such as
`http://192.168.1.50:3000` is blocked outright and no response header changes that.

Anyone stuck on the second path should serve the console from the same box as their
service instead; the bundle is static and `packages/web/README.md` says how.

## Cost

Inside CloudFront's free tier at this traffic. Each release adds about 110 MB to the
downloads bucket, a few cents a month once there are a dozen. ACM certificates are free. A Route 53
hosted zone is about $0.50/month, which you are paying already if the zone exists.

## Status

**Deployed**, at <https://mini-cloud.qinnan.dev>.

The stack is finished; the bundle it serves is not. `packages/web/src/lib/config.ts`
still resolves the service URL at *build* time and falls back to
`http://127.0.0.1:3000`, so the hosted copy is hardwired to that address, with no way
for a visitor to change it and no prompt telling them to. It therefore works for someone
running mini-cloud on `127.0.0.1:3000`, and shows an offline banner to everyone else.

§1 of [../md/PLANNED-CHANGES.md](../md/PLANNED-CHANGES.md) — runtime backend selection —
is what makes this deployment usable by anyone but its author. Until it lands, do not
link the site from the product README: there is nothing a stranger can do with it.
