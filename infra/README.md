# infra — the hosted console

One CDK stack, `MiniCloudConsole`, that serves the browser console as a static site at
a domain you own. Nothing else in mini-cloud needs AWS: the control plane, the agents
and the CLI run on machines you already have, and this exists only so that someone who
wants to *look* at the console does not have to clone the repo and run Vite first.

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
| S3 bucket | Private. All public access blocked, no website endpoint. Reached only through the distribution |
| CloudFront distribution | `index.html` as the root object, HTTP redirected to HTTPS, compression on, HTTP/2 and /3 |
| Origin Access Control | How CloudFront reaches the bucket, so the bucket is never a public origin |
| Response headers policy | HSTS, `nosniff`, `no-referrer`, `frame-ancestors 'none'` — and deliberately nothing about mixed content |
| ACM certificate | DNS-validated against the hosted zone |
| Route 53 A + AAAA aliases | Pointing at the distribution |
| Two bucket deployments | `packages/web/dist`, split so the two halves get opposite cache headers |

Everything is in **`us-east-1`**, because CloudFront accepts a certificate from no
other region. The alternative — a certificate stack in `us-east-1` and everything else
somewhere else — buys a cross-region reference and nothing this project needs.

## Before the first deploy

1. **Configure it.** Copy `.env.example` to `.env` and fill in the four values. That
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

3. **Bootstrap the account**, once per account and region:

   ```bash
   npx cdk bootstrap aws://$(grep MINI_CLOUD_AWS_ACCOUNT .env | cut -d= -f2)/us-east-1
   ```

4. **Build the console.** The stack uploads `packages/web/dist`, and synth fails with a
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

A hosted console can only talk to a mini-cloud running on **the same machine as the
browser** — `http://localhost:3000` or `http://127.0.0.1:3000`. A LAN address like
`http://192.168.1.50:3000` is blocked outright from an HTTPS page and no response
header changes that, and Safari may refuse loopback as well. Anyone who needs more
should serve the console from the same box as their service; the bundle is static and
`packages/web/README.md` says how.

## Cost

Inside CloudFront's free tier at this traffic. ACM certificates are free. A Route 53
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
