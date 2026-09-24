# Todo

Work that is wanted but not yet done, small enough that it needs a line rather than an
argument. Anything that needs its reasoning written down — a decision someone picking it
up should not have to re-derive — belongs in [PLANNED-CHANGES.md](./PLANNED-CHANGES.md)
instead. Delete a line once it has shipped.

---

## Control plane

- [ ] **A built-in agent, so one machine runs one process.** `serve` would start an agent
      in the same process — registered like any other, so the console, `agent list` and
      `task launch --agent` still see it — but reached directly rather than over the hub: a
      local agent is not a WebSocket subscriber, and a launch on the machine already
      running the service should not need one. `AgentCommander` is the seam, and it wants
      both halves of what the hub gives it today, since it publishes a command to the
      agent's topic *and* reads the subscriber count back as "is it online".
      Two things the design has to respect. `service` cannot import `agent` without
      reversing the one-way dependency the packages are built on, so the CLI composes the
      two and hands the service a local dispatcher. And the control plane's daemon unit is
      written for a process that launches nothing: `launchesTasks: false` in
      `cli/src/service/units.ts` is what withholds `AbandonProcessGroup` and
      `KillMode=process` and leaves it `ProcessType=Background`, so tasks under it would be
      throttled, and killed by a `daemon restart`. Still to settle: what the built-in
      agent's id is, and whether it is on by default.

- [ ] **A version endpoint, and an agent that reports its own.** The console shows what
      it is talking to: the control plane's version beside the service it is connected
      to, and each agent's version in the fleet table, so a machine left behind by an
      update is visible rather than deduced from behaviour. Two halves. The service
      answers its own version on the public listener — `/version` beside `/ping` and
      `/health`, which the console already polls — read from the version the release
      stamps into `packages/cli/package.json`, not from a second constant that will
      drift. And the agent sends its version when it registers and on each heartbeat,
      which the service stores on the agent row and returns with every other agent field,
      so `agent list` and the console read it the same way. Worth settling first: whether
      a version mismatch is only displayed or is also said out loud, given that the
      console breaking against an older service is exactly what the metrics graph did.

## macOS distribution

- [ ] **An organization Apple Developer account, if signing is ever wanted.** Not a
      matter of wiring up the certificate we already have: macOS takes a background
      item's `Developer Name` from the code signature's organization, so a *personal*
      Developer ID makes the login-item entry read "Nan Qin" rather than the product
      name. `sfltool dumpbtm` shows the rule plainly — a signed item carries its
      organization ("Docker Inc"), an unsigned one carries null and displays by
      executable name. An `.app` bundle does not help; it changes `Name`, not
      `Developer Name`. An org account (D-U-N-S number required) is the only thing that
      makes a signature show the product's name, which is why shipping ad-hoc is the
      right call until then. `build-mac-sea-signed.sh` is kept working for the day that
      changes.
- [ ] **Ship the binary in a `.pkg` or `.dmg` so a notarization ticket could be
      stapled.** Only relevant if signing ever happens: a *bare* Mach-O cannot be
      stapled, so even a notarized one leaves Gatekeeper checking online and a first run
      on an offline machine still fails. agent-connector's `build-pkg.mjs` is the
      reference.

## Operations

- [ ] **Refuse a second agent under the same id.** The reporter port only stops a second
      agent started from the same config. One with its own `agent.port` and the default
      id — the hostname — connects, subscribes to the same agent topic, and the two run
      each other's launch and terminate commands. The check belongs in the service, as a
      refusal of a second live subscriber on an agent's topic, and has to let an agent
      reconnect before the hub has swept its dead connection.
- [ ] **Rotate the daemons' log files on macOS.** The launchd plists capture output to
      `~/.mini-cloud/service/service.log` and `~/.mini-cloud/agent/agent.log`, and
      nothing truncates either, so a long-running daemon grows one file forever.
      systemd has journald and needs nothing. Either a size-rotating writer in
      `shared`'s logger, or hand the files to `newsyslog`.
