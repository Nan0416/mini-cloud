# @mini-cloud/web

The mini-cloud web console: tasks, instances, agents, replacement variables and the
pub/sub hub, in a browser.

```bash
# terminal 1 — the control plane, told which origin the console will call from
MINI_CLOUD_CORS_ORIGINS=http://localhost:5173 npm run serve

# terminal 2 — the console
npm run web
```

Then open http://localhost:5173.

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

Because the console is served from its own origin, the service has to be told to
allow it: set `MINI_CLOUD_CORS_ORIGINS` to a comma-separated list of origins (or `*`).
Unset, no CORS middleware is installed at all and the browser is refused — which is
the right default for a control plane whose only other callers are the CLI and the
agents.

Development deliberately has **no Vite proxy**, so the request is cross-origin in
development exactly as it is in production. A missing `MINI_CLOUD_CORS_ORIGINS` then
fails on your machine rather than only after you deploy.

## Configuration

Copy `.env.example` to `.env` to change either of these. Vite inlines them at build
time, so a change means a rebuild.

| Variable | Default | What it does |
| --- | --- | --- |
| `VITE_MINI_CLOUD_API_URL` | `http://127.0.0.1:3000` | Base URL of the service |
| `VITE_MINI_CLOUD_TOKEN` | unset | Sent as `Authorization: Bearer`, for a service running with `MINI_CLOUD_TOKEN` |

There is no login screen: a home-lab control plane on loopback is normally run without
a token, and when there is one the console takes it from the environment rather than
asking. If the service demands a token the console does not have, the banner at the
top of every page says so instead of failing one panel at a time.

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
Raspberry Pi — as long as its origin is in `MINI_CLOUD_CORS_ORIGINS`.
