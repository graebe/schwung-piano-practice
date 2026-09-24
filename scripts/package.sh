#!/usr/bin/env sh
# Build dist/piano-practice-module.tar.gz. Pure JS — nothing to compile.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
STAGE="$ROOT/dist/piano-practice"

rm -rf "$STAGE" "$ROOT/dist/piano-practice-module.tar.gz"
mkdir -p "$STAGE/exercises"

cp "$ROOT/src/module.json" "$STAGE/module.json"
cp "$ROOT/src/ui.js" "$STAGE/ui.js"

MODULES="layout notation staff_render chart scoring generator exercise_io padmap view controls settings_def guess led_paint chords"

# Cache-bust the sibling modules.
#
# QuickJS caches modules by resolved path for the LIFE OF THE RUNTIME, and
# shadow_ui is a long-lived process. The host mangles only ui.js's name
# ("ui.js#N") to force it to reload, so every sibling keeps its canonical path
# and stays cached from whichever version of this module was opened first.
#
# Add an export to a sibling, reinstall, and the fresh ui.js links against the
# STALE cached copy: "SyntaxError: Could not find export 'triadOn'". The tool
# then fails to load with no visible error, because eval_buf dumps to stderr
# and shadow_ui's stderr is /dev/null. That cost an evening to find.
#
# So each build stamps its own filenames. New build, new paths, cache cannot
# serve anything stale — and no hand-maintained version suffixes to forget.
BUILD_ID=$(cat "$ROOT/src/ui.js" $(for m in $MODULES; do echo "$ROOT/src/$m.mjs"; done) \
  | cksum | cut -d' ' -f1)

for mod in $MODULES; do
  cp "$ROOT/src/$mod.mjs" "$STAGE/$mod-$BUILD_ID.mjs"
done

for f in "$STAGE/ui.js" "$STAGE"/*.mjs; do
  for mod in $MODULES; do
    sed -i.bak "s#'\./$mod\.mjs'#'./$mod-$BUILD_ID.mjs'#g" "$f"
  done
  rm -f "$f.bak"
done
cp "$ROOT/dist/dsp.so" "$STAGE/dsp.so"
cp "$ROOT/src/help.json" "$STAGE/help.json"
cp "$ROOT/src/exercises/"*.json "$STAGE/exercises/"
cp "$ROOT/README.md" "$STAGE/README.md"
cp "$ROOT/LICENSE" "$STAGE/LICENSE"

# COPYFILE_DISABLE stops macOS bsdtar writing AppleDouble "._*" resource
# forks into the archive; they unpack onto the Move as junk beside every file.
(cd "$ROOT/dist" && COPYFILE_DISABLE=1 tar -czf piano-practice-module.tar.gz piano-practice)
"$ROOT/scripts/verify-package.sh" "$ROOT/dist/piano-practice-module.tar.gz"
