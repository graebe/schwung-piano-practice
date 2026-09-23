#!/usr/bin/env sh
# Assert the tarball carries everything the module imports at runtime.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
ARCHIVE=${1:-$ROOT/dist/piano-practice-module.tar.gz}
test -f "$ARCHIVE"

LIST=$(tar -tzf "$ARCHIVE")
for entry in \
  piano-practice/module.json \
  piano-practice/ui.js \
  piano-practice/layout.mjs \
  piano-practice/notation.mjs \
  piano-practice/staff_render.mjs \
  piano-practice/chart.mjs \
  piano-practice/scoring.mjs \
  piano-practice/generator.mjs \
  piano-practice/exercise_io.mjs \
  piano-practice/padmap.mjs \
  piano-practice/view.mjs \
  piano-practice/controls.mjs \
  piano-practice/settings_def.mjs \
  piano-practice/guess.mjs \
  piano-practice/dsp.so \
  piano-practice/help.json \
  piano-practice/exercises/index.json \
  piano-practice/LICENSE
do
  echo "$LIST" | grep -qx "$entry" || { echo "missing from package: $entry" >&2; exit 1; }
done

# Every relative import in ui.js must be in the archive.
for mod in $(sed -n "s/.*from '\.\/\([a-z_]*\.mjs\)'.*/\1/p" "$ROOT/src/ui.js"); do
  echo "$LIST" | grep -qx "piano-practice/$mod" || { echo "ui.js imports $mod, not packaged" >&2; exit 1; }
done

# Every exercise the manifest names must be in the archive.
for file in $(sed -n 's/.*"file": *"\([^"]*\)".*/\1/p' "$ROOT/src/exercises/index.json"); do
  echo "$LIST" | grep -qx "piano-practice/exercises/$file" || { echo "manifest names $file, not packaged" >&2; exit 1; }
done

# macOS AppleDouble forks must never ship.
if echo "$LIST" | grep -q '/\._'; then
  echo "AppleDouble junk in package (set COPYFILE_DISABLE=1):" >&2
  echo "$LIST" | grep '/\._' >&2
  exit 1
fi

echo "package ok: $(echo "$LIST" | wc -l | tr -d ' ') entries"
