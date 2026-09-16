#!/usr/bin/env bash
#
# The part of the SEA build that is identical on every platform: compile the
# migrations in, bundle to one CommonJS file, turn that into a SEA blob, and copy the
# running `node` to become the binary.
#
# Sourced by build-linux-sea.sh and build-mac-sea-*.sh rather than repeated in each.
# What differs between them starts after this — how the blob is injected, and what
# signature goes back on — and that is the part each script shows in full.
#
# Sets: BUILD_DIR, BLOB, OUT, FUSE, IDENTIFIER.

BUILD_DIR="build/sea"
BLOB="$BUILD_DIR/mini-cloud.blob"
# Final binary name. Defaults to `mini-cloud`; overridable so a build can produce a
# differently-named command without a second checkout.
OUT="$BUILD_DIR/${MINI_CLOUD_BIN_NAME:-mini-cloud}"
# The sentinel Node's loader scans the executable for to find the injected blob. A
# fixed constant, identical across every Node version.
FUSE="NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
IDENTIFIER="dev.qinnan.mini-cloud"

sea_prelude() {
  rm -rf "$BUILD_DIR"

  # 1. Compile the SQL in. Must run before the bundle: tsup aliases the placeholder
  #    module to what this writes. A binary has no files beside it, so a schema left
  #    on disk would be a schema the binary cannot reach.
  node scripts/generate-embedded-migrations.mjs

  # 2. Bundle every package and dependency into one CommonJS file. Reads each
  #    package's compiled dist, so `npm run build` has to have happened first.
  npx tsup --config tsup.sea.config.ts

  # 3. Turn the bundle into a SEA blob.
  node --experimental-sea-config sea/sea-config.json

  # 4. Copy the Node running this script; that copy becomes the binary.
  mkdir -p "$BUILD_DIR"
  cp "$(command -v node)" "$OUT"
  chmod 755 "$OUT"
}
