# mini-cloud — engineering guidelines

The conventions this codebase follows, and why. Where a rule exists to prevent a
specific bug, the bug is named — a rule you can't justify is a rule that gets ignored.

## Structure

1. **One monorepo, seven packages.** `shared` (models, contracts, utilities), `service`
   (control plane), `client` (typed client), `agent` (worker), `reporter` (embedded in
   launched programs), `cli` (the binary), `web` (the browser console). A package
   exists when something needs to be installed separately — `reporter` is separate
   because user programs import it and should not pull in the service.
2. **Dependencies point one way**: `cli` → `service`/`agent`/`client` → `shared`, and
   `web` → `client` → `shared`. Nothing imports upward, and `shared` imports nothing
   of ours.
2b. **A package that two runtimes consume splits its entry point, not itself.**
   `client` has `index.ts` for Node and `browser.ts` for bundles; the second is the
   first minus `WsSubscriber`, which imports `ws`. Publishing a separate
   `client-browser` package, or reimplementing the transport in `web`, would both mean
   an endpoint has to be written twice — and the second copy is the one that drifts.
2c. **Every package declares its dev tooling, at the same range as the root.**
   `typescript` is `^5.7.3` everywhere, so npm resolves one copy and the whole repo
   compiles with one compiler. The bug this prevents is quiet: `npm i -D typescript`
   in one workspace takes `latest`, which is now the 7.x native port, and npm answers
   the conflict by nesting a second compiler under that package — where it silently
   wins over the root's for every build and editor session in that folder. Pin the
   range, then check that `find . -type d -path '*node_modules/typescript'` returns
   exactly one path.
3. **Layers within `service`**: `routes` parse and delegate, `services` answer
   requests, `facades` carry out work that no request waits on — dispatching a
   launch, the background ticks — `data` talks to Postgres, `utils` holds pure
   helpers. A route never touches a DAO. A facade never calls a service: it takes
   the DAOs it needs, so the dependency only ever points service → facade.

## Configuration

4. **One file reads `process.env`.** `stage-config.ts` in the service,
   `agent-config.ts` in the agent, `lib/config.ts` in the web console (which reads
   `import.meta.env` instead, but the rule is the same). Everything else receives
   configuration through its constructor, which is what makes components testable
   without setting environment variables.
4b. **`shared` never reads the environment unguarded.** Its `getenv` helpers check
   `typeof process` first, because `shared` is bundled into the browser by `web` and
   the log-level lookup in `logger.ts` runs in a static initialiser — unguarded, the
   console throws `process is not defined` at import time, a long way from the cause.
5. **Every setting has a default.** Importing a package must never throw for missing
   configuration. The only value with no default is `MINI_CLOUD_AGENT_ID`, where a
   wrong default is worse than none: two agents sharing an id would receive each
   other's commands.
5b. **Command-line overrides are resolved inside the config loader**, not applied by
   the caller afterwards. `loadAgentConfig({ agentId })` decides flag-over-environment
   precedence in one place — applying overrides after loading meant the loader
   validated a value the flag was about to replace, and `--id` never worked.

## Types

6. **All interface properties are `readonly`.**
7. **Never use `as`.** Validate at trust boundaries with the assertion helpers in
   `@mini-cloud/shared` so a malformed payload fails at the edge with a 400 instead of
   surfacing as a confusing `undefined` deep inside a handler. ESLint enforces this;
   the three sanctioned exceptions each carry an inline justification.
8. **Prefer explicit narrowing to truthiness.** `typeof x !== 'string'`, not `!x` —
   `0` and `''` are valid values.
9. **Named interfaces for structured returns.** No inline `Promise<{ a: string }>`.

## API contracts

10. **One Request and one Response interface per public service method**, both in
    `shared/src/api/`, both used by the service and every caller. Every public service
    method is an endpoint: an operation with no route is a private helper taking
    positional arguments, not a contract. Empty ones are written as `{}` on purpose:
    naming the contract gives it somewhere to grow, so an operation gaining a field is
    not a breaking signature change for callers. A method with no input still takes
    one, defaulted: `listTasks(_request: ListTasksRequest = {})`.
11. **Never return a bare array.** Wrap it: `{ tasks: [...] }`. An object can gain
    pagination later; an array cannot.
12. **The `Request` and `Response` suffixes are reserved** for those interfaces.
    Shared nested types (`LaunchResult`, `TaskAgent`) use neither.

## Data layer

13. **DAO interface plus implementation, in separate files**, named for the class:
    `task-dao.ts` declares `TaskDao`, `pg-task-dao.ts` implements `PgTaskDao`.
14. **DAOs define their own input types** — flat, matching columns, not the API shape.
    They *return* the shared domain model rather than a per-DAO copy of it: `Task` is
    the common vocabulary across all six packages, and duplicating it per DAO would
    add indirection without decoupling anything. This is a deliberate relaxation of
    the usual rule.
15. **Guards belong in the SQL, not around it.** A status update is one
    `UPDATE ... WHERE status_rank <= $new`, so a stale report cannot overwrite a newer
    one and no read-then-write race exists between concurrent agent reports.
16. **Multi-statement writes run in a transaction.** Deleting a task's versions and
    its dynamics row is one unit; a crash in between would otherwise leave schedule
    state pointing at a task that no longer exists.
16b. **Derive rather than denormalise, unless a measurement says otherwise.** The head
    version of a task is `MAX(version)`, not a pointer table — a second table would
    have to be kept consistent on every write to save a lookup nothing has measured
    as slow. `task_instance.status_rank` is the deliberate exception: it is
    denormalised because it makes the status guard a single atomic statement, which
    is correctness, not speed.
17. **Migrations are append-only.** `<sequence>_<name>.sql`, applied in ascending
    sequence order, each in its own transaction together with its bookkeeping row so
    a failure can never record a migration that did not fully apply. Never edit one
    that has shipped. The runner parses the sequence as a number and rejects
    unparseable or duplicated ones, because the two ways to get this silently wrong —
    `readdirSync` order varying by filesystem, and `.sort()` putting `10_` before
    `2_` — both produce a schema that differs between machines rather than an error.

## Errors

18. **Throw a specific `AppError` subclass**, never a bare `Error`, for anything a
    caller could plausibly cause. The global handler maps them to status codes; a bare
    `Error` means a bug and always surfaces as a 500 with the detail logged, not
    returned.
18b. **"There was no service to ask" is not "the service failed."** A transport
    failure raises `ServiceUnreachableError`, never `InternalServiceError`. Folding
    them together left every caller unable to tell a control plane that is down from
    one that is up and broken, which are opposite things to do next about.
19. **Error messages say what to do next.** "Instance has not reported a pid yet, so
    it cannot be terminated. Wait for it to reach `running`." — not "invalid state".

## Logging

20. **Log at decision points**, not just failures: which branch was taken and why,
    state transitions, before and after anything crossing the network.
21. **Loggers are named after their class** (`LoggerFactory.getLogger('TaskService')`),
    which is what makes output greppable when the scheduler, hub and API all write at once.
22. **Periodic work logs at `debug`.** A five-second timer at `info` drowns everything else.

## Failure handling

23. **A background loop never lets one failure kill the loop.** Catch, log, continue —
    and only advance state after success, so a failed job tick retries its window
    instead of silently skipping the launches inside it.
24. **The agent survives the service being unreachable.** A failed report is logged and
    dropped, never thrown: the running process is the source of truth and the service
    catches up on the next report.
25. **The reporter never throws.** A monitoring library that can crash the program it
    monitors is worse than no monitoring. Undeliverable reports are buffered to disk.

## Testing

26. **Extract the logic worth testing into a pure function.** `job-window.ts` is
    separate from `scheduler.ts` precisely so scheduling arithmetic can be tested
    without timers or a database.
27. **A test name states the property, not the mechanics.** "fires exactly once per
    occurrence across contiguous windows", not "test shouldLaunchInWindow".

## CLI

28. **Commander owns the grammar; mini-cloud owns the meaning.** Command routing,
    required options, repeatable flags and help text are commander's job. What counts
    as a valid interval, timestamp or `KEY=VALUE` pair lives in `args.ts` and is
    passed to commander as a parse callback, so a bad value is rejected before any
    command body runs.
29. **Never hand-maintain help text.** It drifts from the flags it documents. Every
    description comes from the `.description()` and `.option()` calls themselves.
30. **`--version` is reserved** by commander for the program's own version. A command
    needing a version argument takes it positionally — `task get <taskId> [version]`
    — rather than shadowing the flag and silently printing `1.0.0`.
31. **An npm script that forwards arguments must end in the real binary**, never in
    another `npm run`. npm appends the caller's arguments to the end of the script
    string, so `"start": "npm run build && npm run serve"` turns
    `npm start -- --port 4000` into `npm run serve --port 4000`, where npm eats
    `--port` as its own flag and the command receives a bare `4000`. Chaining to
    `node packages/cli/bin/mini-cloud.js serve` puts the arguments where they belong.

## Web console

31b. **The console calls the service directly, through `MiniCloudClient`.** There is
    no proxy tier and no second client. It compiles against the same
    `Request`/`Response` interfaces in `shared` that the service implements, so a
    contract change is a build failure rather than a runtime 400.
31c. **CORS is installed before authentication.** A browser sends its preflight
    `OPTIONS` with no `Authorization` header, so auth-first ordering rejects every
    preflight with a 401 and the real request is never sent — which surfaces as an
    unexplained CORS error rather than as an authentication failure.
31d. **No dev proxy.** The console talks cross-origin in development exactly as in
    production, so nothing about the request path differs between them and a CORS
    problem cannot hide behind a rewrite that only exists on one of them.
31d2. **The permissive defaults announce themselves at startup.** CORS defaults to
    any origin and authentication to none, because a home-lab control plane that
    needs configuration before its own console works is a worse first five minutes.
    Both log a `warn` on every start for the same reason: a service any page can
    drive should say so where the operator is already looking, not only in a document
    they have to go and find.
31e. **Every colour is a token**, defined twice in `index.css` — once for light and
    once for dark. Adding the dark theme then means redefining a dozen variables
    rather than auditing every component for a hard-coded hex, and a component
    physically cannot be right in one theme and wrong in the other.
31f. **Seed state on mount, not in an effect.** A component that must reseed when
    something opens or loads is mounted only then — a keyed remount, or a body
    rendered only while a dialog is open. `useEffect(() => setState(...))` causes a
    cascading render and, worse, silently overwrites what the user has half-typed the
    next time a poll lands.
31g. **`disabled` on a `Button asChild` wrapping a `Link` does nothing.** The prop is
    forwarded onto the `<a>`, which ignores it, and the link still navigates. Render a
    real `<button>` for the disabled case.
31h. **`shared` and `client` are aliased to source**, in `vite.config.ts` and
    `tsconfig.json` together. Their published builds are CommonJS and cannot go into a
    browser bundle without an interop shim; source also means a model change shows up
    as a type error immediately rather than after a rebuild. `client` aliases to
    `browser.ts`, not to the package root.

## Style

32. **Always brace `if` bodies.**
33. **`import type` at the top of the file.** Never inline `import('pkg').Type`.
34. **Comments explain why.** The code already says what it does; a comment earns its
    place by recording the reasoning that is not recoverable from reading it.
