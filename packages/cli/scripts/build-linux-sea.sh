#!/usr/bin/env bash
#
# Build the Linux `mini-cloud` Single Executable Application.
#
# Produces an unsigned, self-contained binary at build/sea/mini-cloud — no Node, no
# npm install and no checkout needed on the machine it lands on. Linux binaries are
# not code-signed.
#
# Pipeline: migrations -> bundle -> blob -> copy node -> postject inject (ELF needs no
# Mach-O segment name). Build the workspace deps first:
#   npm run build
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" # packages/cli
# shellcheck source=./sea-prelude.sh
source scripts/sea-prelude.sh

sea_prelude

# 5. Inject the blob. No segment name, and nothing to sign afterwards.
npx postject "$OUT" NODE_SEA_BLOB "$BLOB" --sentinel-fuse "$FUSE"

rm -f "$BLOB"
echo "✓ Built $OUT (linux, unsigned) — $("$OUT" --version)"
