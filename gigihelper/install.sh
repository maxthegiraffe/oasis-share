#!/bin/sh
# Gigi Helper, installed from Terminal (Max, 2026-11-05: students must never hit Apple's "can't be opened" box).
# Files that curl fetches never get the download tag that makes macOS block an app, so she just opens.
#   curl -fsSL https://grateful.gg/gigihelper/install.sh | sh -s GIGI-XXXX-XXXX
set -e
CODE="${1:-}"
ZIP_URL="https://grateful.gg/gigihelper/Gigi-Helper.zip"
DEST="$HOME/Applications"
APP="$DEST/Gigi Helper.app"

echo ""
echo "  Hi, it's Gigi. Getting myself onto your Mac..."
mkdir -p "$DEST"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$ZIP_URL" -o "$TMP/gigi.zip"
pkill -x GigiHelper 2>/dev/null || true
rm -rf "$APP"
ditto -x -k "$TMP/gigi.zip" "$DEST"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
echo "  Done. Opening now. You can close this window."
echo ""
if [ -n "${GIGI_NO_OPEN:-}" ]; then exit 0; fi
if [ -n "$CODE" ]; then open -n "$APP" --args --code "$CODE"; else open "$APP"; fi
