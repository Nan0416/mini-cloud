# mini-cloud

A private cloud for machines you already own: schedule programs across them, watch
them run, and pass messages between them. Node 22, TypeScript, PostgreSQL.

## Shape

An npm-workspaces monorepo, seven packages under `packages/`:

| Package | What it is |
| --- | --- |
| `shared` | Domain models, API contracts, errors, utilities. Imports nothing of ours |
| `service` | Control plane: HTTP API, pub/sub hub (WebSocket), scheduler, Postgres |
| `client` | Typed client. `index.ts` for Node, `browser.ts` for bundles |
| `agent` | Runs on each worker machine; spawns and health-checks tasks |
| `reporter` | Imported by launched programs to report their own lifecycle |
| `cli` | The `mini-cloud` binary |
| `web` | The browser console (React, Tailwind, Radix) |

Dependencies point one way: `cli` → `service`/`agent`/`client` → `shared`, and
`web` → `client` → `shared`.

Inside `service`: `routes` parse and delegate → `services` answer requests →
`facades` do work no request waits on → `data` talks to Postgres.

Schema lives in `packages/service/migrations/` as numbered SQL files, applied on
startup. Never edit one that has shipped; add the next number.

## Running it

```bash
npm start                              # control plane on :3000 (builds + migrates first)
npm run start:agent -- --id laptop-1   # a worker agent, in another terminal
npm run start:web                      # the console on :5173, in a third
```

`start` and `start:agent` rebuild first; skip that with `npm run cli -- serve` or
`npm run cli -- agent start`. `start:web` needs no build — vite aliases `shared` and
`client` to their *source*, so HMR picks up edits there live. Flags need a `--`
separator: `npm start -- --port 4000`.

`npm test` skips the Postgres integration suite unless `MINI_CLOUD_TEST_DATABASE_URL`
points at a throwaway database.

## Conventions

**Read [md/GUIDELINES.md](./md/GUIDELINES.md) before writing code here.** It is the
authority on structure, configuration, types, API contracts, the data layer, errors,
logging, failure handling, testing and style — each rule with the reasoning behind it.

## More

- [README.md](./README.md) — what the product does and how the pieces fit
- [dev.md](./dev.md) — setup, every environment variable, everyday commands
