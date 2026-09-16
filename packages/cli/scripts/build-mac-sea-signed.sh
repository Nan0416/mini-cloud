#!/usr/bin/env bash
#
# Build, Developer-ID-sign and notarize the macOS `mini-cloud` SEA.
#
# This is the build for anything anyone else downloads. The ad-hoc build is refused by
# Gatekeeper once a browser has quarantined it, which is exactly how a GitHub Release
# asset arrives — so the unsigned path costs every downloader an `xattr -d` they have
# to be told about, and this one costs them nothing.
#
# Signing identity:
#   $MINI_CLOUD_SIGN_IDENTITY, else the first "Developer ID Application" identity in
#   the keychain.
# Notary credentials (unless --no-notarize):
#   $APPLE_ID / $APPLE_APP_SPECIFIC_PASSWORD / $APPLE_TEAM_ID.
#
# Flags:
#   --no-notarize   sign only, skip the Apple notary submission.
#
# A bare Mach-O cannot be stapled, so the notarization ticket is recorded by hash and
# Gatekeeper checks it online — which means a first run still needs the network. Putting
# the binary in a .pkg or .dmg is what would allow stapling; see md/TODO.md.
#
# Build the workspace deps first:  npm run build
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" # packages/cli
# shellcheck source=./sea-prelude.sh
source scripts/sea-prelude.sh

NOTARIZE=1
[ "${1:-}" = "--no-notarize" ] && NOTARIZE=0

# Resolved before anything is built, so a missing certificate fails in a second rather
# than after a full bundle.
SIGN_IDENTITY="${MINI_CLOUD_SIGN_IDENTITY:-}"
if [ -z "$SIGN_IDENTITY" ]; then
  SIGN_IDENTITY="$(security find-identity -v -p codesigning | grep 'Developer ID Application' | head -1 | sed -E 's/.*"(.*)"/\1/')"
fi
[ -n "$SIGN_IDENTITY" ] || {
  echo "error: no Developer ID Application identity found in the keychain." >&2
  echo "       Set MINI_CLOUD_SIGN_IDENTITY, or use build-mac-sea-unsigned.sh for a local build." >&2
  exit 1
}

sea_prelude

# 5-6. Strip Node's signature, inject the blob.
codesign --remove-signature "$OUT"
npx postject "$OUT" NODE_SEA_BLOB "$BLOB" --sentinel-fuse "$FUSE" --macho-segment-name NODE_SEA

# 7. Developer ID sign: hardened runtime, the JIT entitlements V8 needs, and a secure
#    timestamp (notarization rejects a signature without one).
codesign --force --sign "$SIGN_IDENTITY" --identifier "$IDENTIFIER" --options runtime --entitlements sea/entitlements.plist --timestamp "$OUT"
codesign --verify --strict --verbose=2 "$OUT"
echo "✓ Signed $OUT as: $SIGN_IDENTITY"

if [ "$NOTARIZE" -eq 1 ]; then
  for var in APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID; do
    [ -n "${!var:-}" ] || {
      echo "error: $var is not set. Pass --no-notarize to sign without submitting." >&2
      exit 1
    }
  done

  # notarytool takes an archive, not a bare executable.
  ZIP="$(mktemp -d)/mini-cloud.zip"
  ditto -c -k "$OUT" "$ZIP"
  echo "Submitting to Apple's notary service (this can take a few minutes)…"
  xcrun notarytool submit "$ZIP" --apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
  echo "✓ Notarized — the ticket is online-only, because a bare binary cannot be stapled"
else
  echo "  (skipped notarization: --no-notarize)"
fi

rm -f "$BLOB"
echo "✓ Built $OUT — $("$OUT" --version)"
