#!/usr/bin/env bash
#
# Build the macOS `mini-cloud` SEA, ad-hoc signed.
#
# Ad-hoc is enough to *run* — Apple Silicon refuses an entirely unsigned binary — but
# it is not a distribution signature. A tarball downloaded in a browser carries the
# quarantine attribute, and Gatekeeper will refuse an ad-hoc binary outright, so
# whoever downloads it has to run `xattr -d com.apple.quarantine` first. Use
# build-mac-sea-signed.sh for a build that does not ask that of anyone.
#
# Pipeline: migrations -> bundle -> blob -> copy node -> strip signature -> postject
# inject -> ad-hoc re-sign. Build the workspace deps first:
#   npm run build
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" # packages/cli
# shellcheck source=./sea-prelude.sh
source scripts/sea-prelude.sh

sea_prelude

# 5. macOS verifies the signature over the whole Mach-O, so Node's own has to come off
#    before the binary is modified.
codesign --remove-signature "$OUT"

# 6. Inject the blob. The Mach-O segment name is required on macOS.
npx postject "$OUT" NODE_SEA_BLOB "$BLOB" --sentinel-fuse "$FUSE" --macho-segment-name NODE_SEA

# 7. Re-sign ad-hoc, with the hardened runtime and the entitlements V8 needs to JIT.
codesign --force --sign - --identifier "$IDENTIFIER" --options runtime --entitlements sea/entitlements.plist "$OUT"
codesign --verify --verbose=2 "$OUT"

rm -f "$BLOB"
echo "✓ Built $OUT (macOS, ad-hoc — downloaders must clear the quarantine attribute) — $("$OUT" --version)"
