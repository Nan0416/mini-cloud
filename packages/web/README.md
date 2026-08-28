# @mini-cloud/web

The mini-cloud web console: tasks, instances, agents, replacement variables and the
pub/sub hub, in a browser.

```bash
npm start      # terminal 1 — the control plane
npm run web    # terminal 2 — the console
```

Then open http://localhost:5173. Nothing to configure.

## How it talks to the service

Directly, through the same `MiniCloudClient` the CLI and the agent use. There is no
proxy layer between the browser and the control plane, and no second copy of the
client: an endpoint is written once in `@mini-cloud/client` and every caller compiles
against it.

The import is `@mini-cloud/client`'s **browser entry point** (`src/browser.ts`), which
is the package's HTTP surface without `WsSubscriber` — that one module imports `ws`,
a Node package a browser bundle cannot resolve. A browser that needs to subscribe
should use the platform `WebSocket` against `/ws`; the subscriber exists for the
reconnect and replay logic Node callers need.

The console is served from its own origin, so the service answers it under CORS. It
allows **any** origin by default, which is what makes the two commands above work
with no setup — and is wider than a loopback bind makes it sound: the browser sends
the request, so a page you visit can reach the service and read the answer, and an
unauthenticated control plane will launch a command for it. Narrow it with
`MINI_CLOUD_CORS_ORIGINS=http://localhost:5173`, or require a token with
`MINI_CLOUD_TOKEN`. Setting the origins variable replaces the default rather than
adding to it; setting it empty installs no CORS middleware at all.

Development deliberately has **no Vite proxy**, so the request is cross-origin in
development exactly as it is in production and nothing about the request path
changes between them.

## Which service it talks to

Decided at runtime, not at build time, so one bundle can serve anyone. In order:

1. **`?backend=`** in the URL, percent-encoded. Makes a link shareable and a bookmark
   self-configuring.
2. **What this browser stored**, from the last time someone connected.
3. **`VITE_MINI_CLOUD_API_URL`**, if the bundle was built with one.
4. **The setup screen**, when none of the above answered.

The screen verifies before it accepts: `/ping` proves the service is reachable without
needing a token, then an authenticated call decides whether to ask for one — a 401 is
the only way to discover that a service wants a token at all. Catching a typo there is
the point, because a wrong address stored instead surfaces minutes later as an offline
banner and reads like a broken service.

The chosen service shows in the top bar; clicking it switches, which discards the
cached data belonging to the one being left. "Stay connected" chooses `localStorage`
over `sessionStorage` — a token in either is readable by any script on this origin, so
on a shared machine leave it off and it ends with the tab.

### Configuration

Copy `.env.example` to `.env`. Vite inlines these at build time, so a change means a
rebuild. Both are optional.

| Variable | Default | What it does |
| --- | --- | --- |
| `VITE_MINI_CLOUD_API_URL` | unset — the console asks | Base URL of the service, when a bundle is built for one |
| `VITE_MINI_CLOUD_TOKEN` | unset | Sent as `Authorization: Bearer`, for a service running with `MINI_CLOUD_TOKEN` |

### What a browser will let it reach

| The service is at | Works from a console served over HTTPS |
| --- | --- |
| `https://…` with a real certificate | **Anywhere, on any device including a phone.** Needs `MINI_CLOUD_CORS_ORIGINS` to include the console's origin |
| `http://localhost` or `http://127.0.0.1` | Only on the machine running the browser. Chrome asks permission first (Chrome 142+); **Safari refuses entirely**, so no iOS browser can |
| `http://192.168.x.x` or any LAN address | **Never.** Blocked as mixed content, and no response header changes it |

The last row is why serving this bundle from the same machine as the service is still
the simplest answer for a LAN-only setup: over plain HTTP, none of these limits apply.

## Stack

Vite, React 19, TypeScript, Tailwind CSS v4, Radix UI primitives styled in the
shadcn/ui idiom (vendored into `src/components/ui`, not installed), TanStack Query,
React Router.

Dark mode is a `dark` class on `<html>`, chosen by the toggle in the top bar and
persisted to `localStorage`. A small script in `index.html` applies it before first
paint, because reading the preference in React means a white flash on every load.
Every colour is a CSS custom property defined twice in `src/index.css`, so the two
themes stay in step by construction.

## Layout

```
src/
  lib/        config, the HTTP client, formatting, routes — no React
  hooks/      one file per domain, wrapping the client in TanStack Query
  components/
    ui/       the vendored primitives: button, dialog, table, …
    common/   cross-domain pieces: DataTable, KeyValueGrid, status badges
    task/     task table, form, launch and target-agent dialogs
    instance/ instance table, event log
    agent/    agent table
    layout/   shell, sidebar, top bar, theme toggle
  pages/      one file per route
```

`@mini-cloud/shared` and `@mini-cloud/client` resolve to **source**, not to their
`dist` folders: those builds are CommonJS, which a browser bundle cannot consume
without an interop shim, and source means a contract change shows up as a type error
immediately rather than after a rebuild. Both aliases are declared in
`vite.config.ts` and `tsconfig.json`, and the two files have to stay in step.

`src/lib/api.ts` is the whole client layer — it constructs one `MiniCloudClient` from
the resolved config. Errors come back as the `AppError` subclasses from
`@mini-cloud/shared`, so `ErrorState` branches on `NotFoundError`,
`UnauthenticatedError` and `ServiceUnreachableError` rather than on status numbers.

## Freshness

Everything polls — lists every 10s, detail views every 4s — and the refresh button in
the top bar drops every cache at once. The service does not publish task lifecycle
events to the hub today, so there is nothing for the browser to subscribe to; when it
does, the polling intervals are the thing to replace.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev -w @mini-cloud/web` | Dev server on :5173 (or `npm run web` from the repo root) |
| `npm run build -w @mini-cloud/web` | Typecheck, then build to `dist/` |
| `npm run typecheck -w @mini-cloud/web` | Types only |
| `npm run preview -w @mini-cloud/web` | Serve the built bundle |

`dist/` is a folder of static files. Serve it from anything — `npx serve`, nginx, a
Raspberry Pi, S3 and CloudFront — as long as its origin is in `MINI_CLOUD_CORS_ORIGINS`.
Build it without `VITE_MINI_CLOUD_API_URL` and every visitor is asked where their own
service is, which is what makes one deployment usable by more than one person.
