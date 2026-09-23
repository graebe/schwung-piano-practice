#!/usr/bin/env sh
# Build dist/piano-practice-module.tar.gz. Pure JS — nothing to compile.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
STAGE="$ROOT/dist/piano-practice"

rm -rf "$STAGE" "$ROOT/dist/piano-practice-module.tar.gz"
mkdir -p "$STAGE/exercises"

cp "$ROOT/src/module.json" "$STAGE/module.json"
cp "$ROOT/src/ui.js" "$STAGE/ui.js"
for mod in layout notation staff_render chart scoring generator exercise_io padmap view controls settings_def guess; do
  cp "$ROOT/src/$mod.mjs" "$STAGE/$mod.mjs"
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
