#!/bin/sh
#
# Installs the `mini-cloud` binary:
#
#   curl -fsSL https://mini-cloud.qinnan.dev/downloads/cli/install.sh | sh
#
# One directory per version, and a symlink on the PATH naming the current one:
#
#   ~/.local/share/mini-cloud/versions/<version>/mini-cloud
#   ~/.local/bin/mini-cloud -> the file above
#
# A daemon's unit names the symlink, so a restart after an update runs the new binary.
# `mini-cloud update` is this script again, pinned to the version it found. The three
# most recently installed versions are kept, so a version pinned by hand stays for as
# long as it is the one being used.
#
# POSIX sh: `| sh` is dash on Debian and Ubuntu.
#
#   MINI_CLOUD_VERSION      a published version to install instead of the latest
#   MINI_CLOUD_BIN_DIR      where the symlink goes (default: wherever the last install
#                           put it, else ~/.local/bin)
#   MINI_CLOUD_INSTALL_URL  where to download from (default the address above)
set -eu

BASE_URL="${MINI_CLOUD_INSTALL_URL:-https://mini-cloud.qinnan.dev/downloads/cli}"
DATA_DIR="$HOME/.local/share/mini-cloud"
KEEP_VERSIONS=3

# Where the last install put the symlink. `mini-cloud update` re-runs this script without
# the environment the first install had, so without this a custom MINI_CLOUD_BIN_DIR
# would be forgotten: the update would link a second launcher into ~/.local/bin and leave
# the one on the PATH pointing at the old version.
BIN_DIR_RECORD="$DATA_DIR/bin-dir"
if [ -n "${MINI_CLOUD_BIN_DIR:-}" ]; then
  BIN_DIR="$MINI_CLOUD_BIN_DIR"
elif [ -r "$BIN_DIR_RECORD" ]; then
  BIN_DIR="$(cat "$BIN_DIR_RECORD")"
else
  BIN_DIR="$HOME/.local/bin"
fi

say() { printf '%s\n' "$1"; }
fail() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v tar >/dev/null 2>&1 || fail "tar is required"

os="$(uname -s)"
arch="$(uname -m)"
# A shell under Rosetta reports x86_64 on Apple silicon, where the arm64 build is the one to run.
if [ "$os" = Darwin ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then
  arch=arm64
fi
case "$os/$arch" in
  Darwin/arm64) target=darwin-arm64 ;;
  Darwin/x86_64) fail "there is no mini-cloud build for Intel Macs" ;;
  Linux/x86_64 | Linux/amd64) target=linux-x64 ;;
  Linux/aarch64 | Linux/arm64) target=linux-arm64 ;;
  *) fail "there is no mini-cloud build for $os $arch" ;;
esac

version="${MINI_CLOUD_VERSION:-}"
version="${version#v}"
if [ -z "$version" ]; then
  # The release workflow writes it on one line, so sed is parser enough.
  version="$(curl -fsSL "$BASE_URL/version.json" | sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p')"
  [ -n "$version" ] || fail "could not read the latest version from $BASE_URL/version.json"
fi

archive="mini-cloud-$target.tar.gz"
release_url="$BASE_URL/v$version"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

say "Downloading mini-cloud $version ($target)"
curl -fsSL "$release_url/$archive" -o "$tmp/$archive" || fail "could not download $release_url/$archive"
curl -fsSL "$release_url/SHA256SUMS" -o "$tmp/SHA256SUMS" || fail "could not download $release_url/SHA256SUMS"

expected="$(awk -v name="$archive" '$2 == name { print $1 }' "$tmp/SHA256SUMS")"
[ -n "$expected" ] || fail "SHA256SUMS has no line for $archive"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$archive" | awk '{ print $1 }')"
else
  actual="$(shasum -a 256 "$tmp/$archive" | awk '{ print $1 }')"
fi
[ "$actual" = "$expected" ] || fail "$archive does not match SHA256SUMS (expected $expected, got $actual)"

tar -xzf "$tmp/$archive" -C "$tmp"
[ -f "$tmp/mini-cloud" ] || fail "$archive has no mini-cloud binary in it"
chmod 755 "$tmp/mini-cloud"
# Proves it runs on this machine before anything on the PATH points at it.
reported="$("$tmp/mini-cloud" --version)" || fail "the downloaded binary does not run on this machine"
[ "$reported" = "$version" ] || fail "the binary published as $version reports itself as $reported"

# Staged beside the destination and renamed over it, so reinstalling the version the
# symlink already points at cannot leave it dangling: the only gap is one rename, and
# neither it nor the `mv` before it can fail for want of space on another filesystem.
dest="$DATA_DIR/versions/$version"
staging="$DATA_DIR/versions/.$version.incoming"
rm -rf "$staging"
mkdir -p "$staging" "$BIN_DIR"
mv "$tmp/mini-cloud" "$staging/mini-cloud"
rm -rf "$dest"
mv "$staging" "$dest"

# A rename, so the command is never missing from the PATH mid-update.
ln -sf "$dest/mini-cloud" "$BIN_DIR/.mini-cloud.new"
mv -f "$BIN_DIR/.mini-cloud.new" "$BIN_DIR/mini-cloud"

printf '%s\n' "$BIN_DIR" > "$BIN_DIR_RECORD"

# By install time rather than by version order, so a version installed on purpose is one
# of the three kept. A running daemon holds the file it started from open, so pruning it
# is harmless.
ls -1t "$DATA_DIR/versions" | grep -vxF "$version" | tail -n +"$KEEP_VERSIONS" | while IFS= read -r old; do
  rm -rf "${DATA_DIR:?}/versions/$old" || true
done

say "Installed mini-cloud $version: $BIN_DIR/mini-cloud -> $dest/mini-cloud"

case ":$PATH:" in
  *":$BIN_DIR:"*)
    found="$(command -v mini-cloud 2>/dev/null || true)"
    if [ -n "$found" ] && [ "$found" != "$BIN_DIR/mini-cloud" ]; then
      say "Note: $found comes before it on your PATH, so \`mini-cloud\` still runs that one."
    fi
    ;;
  *)
    say "$BIN_DIR is not on your PATH. Add this to your shell profile:"
    say "  export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac
