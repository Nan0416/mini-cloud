# Todo

Work that is wanted but not yet done, small enough that it needs a line rather than an
argument. Anything that needs its reasoning written down — a decision someone picking it
up should not have to re-derive — belongs in [PLANNED-CHANGES.md](./PLANNED-CHANGES.md)
instead. Delete a line once it has shipped.

---

## Distribution

- [ ] **Publish the CLI binaries to an S3 bucket.** They go to GitHub Release assets
      today, which is fine for `curl -L` from a browser session but makes an
      unauthenticated `install.sh` awkward and gives no CDN. `infra/` already has the
      CDK app and the pattern (private bucket, CloudFront, OAC) from the hosted console,
      so this is a second distribution rather than new machinery.
- [ ] **Self-update for the CLI** — `mini-cloud update`, checking a `version.json`
      manifest published beside the binaries. Depends on the bucket above: the point of
      the manifest is that it is cheap to poll, which a GitHub Release API call is not.
      agent-connector has a working version of both, including the stable-launcher
      symlink trick that lets a running daemon pick up a new binary on its next start.

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
- [ ] **A `curl | bash` installer.** Quarantine is applied by the *browser*, not by the
      file, so a `curl` download of an ad-hoc binary already runs unimpeded — the
      release notes lead with that. An install script would make it one line, put the
      binary on the PATH, and is the same thing agent-connector's `install.sh` does. It
      pairs with the S3 bucket above but does not depend on it; a GitHub Release URL
      works today.
- [ ] **Ship the binary in a `.pkg` or `.dmg` so a notarization ticket could be
      stapled.** Only relevant if signing ever happens: a *bare* Mach-O cannot be
      stapled, so even a notarized one leaves Gatekeeper checking online and a first run
      on an offline machine still fails. agent-connector's `build-pkg.mjs` is the
      reference.

## Operations

- [ ] **Run the agent as a daemon too.** `mini-cloud daemon` supervises the control
      plane only, but a worker machine is the one you are *least* likely to have a shell
      open on — an agent that dies with its terminal, or does not come back after a
      reboot, takes that machine out of the fleet silently. The machinery is ready:
      `ServiceManager` takes the argv already resolved, so this is a second label, a
      second unit name and a command group, not a second implementation. Decide the
      surface first — `mini-cloud agent daemon start`, or a `--target` on the existing
      group — since one control plane and one agent can share a machine and the units
      must not collide.
- [ ] **Refuse to start a second control plane on the same ports.** There is no check
      today. `assertDistinctListeners` only catches `internal` and `public` colliding
      *within one config*; nothing looks for another process. Running `mini-cloud serve`
      while the daemon is up gets you this, and it is bad in three separate ways:
      migrations run **first**, so the second process touches the database before it
      finds out it cannot start; the failure is an unhandled `error` event, so the
      operator gets a raw Node stack trace rather than a sentence; and nothing mentions
      the daemon, which is the actual answer. A preflight `connect()` to each configured
      port, before the pool is opened, would turn it into "a mini-cloud is already
      listening on 127.0.0.1:3000 — `mini-cloud daemon status`".

- [ ] **Rotate the daemon's log file on macOS.** The launchd plist captures stdout to
      `~/.mini-cloud/service/service.log` and nothing truncates it, so a long-running
      control plane grows one file forever. systemd has journald and needs nothing.
      Either a size-rotating writer in `shared`'s logger, or hand the file to
      `newsyslog`.
