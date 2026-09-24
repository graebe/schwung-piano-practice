#!/usr/bin/env sh
# Deploy to a Move over SSH. Stages beside the live directory and swaps, so a
# failed transfer cannot leave a half-installed module behind.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
VERSION=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$ROOT/src/module.json")
MOVE_HOST=${MOVE_HOST:-move.local}
MOVE_USER=${MOVE_USER:-ableton}
REMOTE_BASE="/data/UserData/schwung/modules/tools"
REMOTE="$REMOTE_BASE/piano-practice"
TOKEN=$$
REMOTE_STAGE="$REMOTE_BASE/.piano-practice.install.$TOKEN"
REMOTE_OLD="$REMOTE_BASE/.piano-practice.old.$TOKEN"
REMOTE_ARCHIVE="/tmp/piano-practice-$TOKEN.tar.gz"

test -f "$ROOT/dist/dsp.so"
test -f "$ROOT/dist/piano-practice-module.tar.gz" || "$ROOT/scripts/package.sh"

scp "$ROOT/dist/piano-practice-module.tar.gz" "$MOVE_USER@$MOVE_HOST:$REMOTE_ARCHIVE"
ssh "$MOVE_USER@$MOVE_HOST" sh -s -- \
  "$REMOTE" "$REMOTE_STAGE" "$REMOTE_OLD" "$REMOTE_ARCHIVE" <<'REMOTE_SCRIPT'
set -eu
remote=$1
stage=$2
old=$3
archive=$4

rollback() {
  status=$?
  trap - 0 1 2 15
  rm -rf "$stage" "$old"
  rm -f "$archive"
  exit "$status"
}
trap rollback 0 1 2 15

rm -rf "$stage" "$old"
mkdir -p "$stage"
tar -xzf "$archive" -C "$stage" --strip-components=1

# Keep the player's settings across an update.
if [ -f "$remote/settings.json" ]; then
  cp "$remote/settings.json" "$stage/settings.json"
fi
# And their progress history. Forgetting this would wipe every recorded round
# on the next install, silently, and nobody would notice until they went
# looking for a trend that was no longer there.
if [ -f "$remote/stats.json" ]; then
  cp "$remote/stats.json" "$stage/stats.json"
fi
# Keep any exercises they added by hand.
if [ -d "$remote/exercises" ]; then
  for f in "$remote/exercises/"*.json; do
    [ -e "$f" ] || continue
    base=$(basename "$f")
    [ -e "$stage/exercises/$base" ] || cp "$f" "$stage/exercises/$base"
  done
fi
chown -R ableton:users "$stage"

if [ -d "$remote" ]; then
  mv "$remote" "$old"
fi
mv "$stage" "$remote"
rm -rf "$old"
REMOTE_SCRIPT

echo "Installed Piano Practice $VERSION. Open it from Schwung Tools."
