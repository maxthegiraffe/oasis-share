#!/bin/sh
# The Oasis on your Mac, from one line in Terminal (Max, 2026-11-23: "give people a line of code to install it & get
# them signed in with their email or phone"). Files that curl fetches never get the download tag that makes macOS
# block an app, so it just opens (the same way as Gigi Helper: grateful.gg/gigihelper/install.sh).
#   curl -fsSL https://grateful.gg/oasis/install.sh | sh
# It never asks for a password: /Applications if this account can write there, else ~/Applications.
set -e
VERSION="0.4.1"
BASE="https://axysrawypndwfzruqkdh.supabase.co/storage/v1/object/public/public/oasis"
case "$(uname -m)" in arm64) ARCH=arm64 ;; *) ARCH=x64 ;; esac
ZIP_URL="${OASIS_ZIP_URL:-$BASE/The-Oasis-$VERSION-$ARCH.zip}"
if [ -n "${OASIS_DEST:-}" ]; then DEST="$OASIS_DEST"; elif [ -w /Applications ]; then DEST=/Applications; else DEST="$HOME/Applications"; fi
APP="$DEST/The Oasis.app"

echo ""
echo "  Getting the Oasis onto your Mac..."
mkdir -p "$DEST"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$ZIP_URL" -o "$TMP/oasis.zip"
# an Oasis that is open closes first, politely, so a call in it can end on its own terms
if [ -z "${OASIS_DEST:-}" ] && pgrep -x "The Oasis" >/dev/null 2>&1; then
  osascript -e 'tell application "The Oasis" to quit' >/dev/null 2>&1 || true
  i=0; while pgrep -x "The Oasis" >/dev/null 2>&1 && [ $i -lt 10 ]; do sleep 1; i=$((i+1)); done
  pkill -x "The Oasis" 2>/dev/null || true
fi
rm -rf "$APP"
ditto -x -k "$TMP/oasis.zip" "$DEST"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
echo "  Done. Opening it now: sign in with your email or phone."
echo ""
if [ -n "${OASIS_NO_OPEN:-}" ]; then exit 0; fi
open -n "$APP" --args "oasis://ai/school"
