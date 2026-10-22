#!/usr/bin/env sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Torben Gräber
# Build dist/piano-practice-module.tar.gz from the module's JS, dist/dsp.so
# (scripts/build-dsp.sh) and the page in dist/web (npm run web:build).
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
STAGE="$ROOT/dist/piano-practice"

rm -rf "$STAGE" "$ROOT/dist/piano-practice-module.tar.gz"
mkdir -p "$STAGE/exercises"

cp "$ROOT/src/module.json" "$STAGE/module.json"
cp "$ROOT/src/ui.js" "$STAGE/ui.js"

MODULES="layout notation staff_render chart scoring generator exercise_io levels padmap view controls settings_def guess led_paint chords stats choices chord_lessons catalog progress curriculum program ear_core ear_course read_course ear answer_pads info cues session view_model actions remote"

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
# libm is compiled into dsp.so and MIT requires its notice to travel with the
# binary. It did not, for three releases — the README claimed the notice rode
# along "in the vendored source", but libm is a cargo dependency, not vendored.
cp "$ROOT/THIRD_PARTY_LICENSES.md" "$STAGE/THIRD_PARTY_LICENSES.md"

# The recorded piano and claves, which dsp.so reads in create, with their
# licence texts. They are Git LFS objects: a checkout without the objects
# holds ~130-byte pointer files instead, and a module packaged from one would
# quietly play the synth. So a file that does not start like a pack stops the
# build here.
mkdir -p "$STAGE/samples/LICENSES"
for pack in piano click; do
  f="$ROOT/samples/$pack.nisp"
  [ "$(head -c 4 "$f" 2>/dev/null)" = NISP ] \
    || { echo "samples/$pack.nisp is not a pack (an LFS pointer? run: git lfs pull)" >&2; exit 1; }
  cp "$f" "$STAGE/samples/"
done
cp "$ROOT/samples/LICENSES/"*.txt "$STAGE/samples/LICENSES/"

# The page Schwung's web manager shows in its Tool tab (docs/schwung-web.md):
# web_ui.html beside module.json, everything it loads under assets/. Not the
# gallery, which is a review page. The fonts are OFL-1.1, whose texts travel
# with them.
WEB="$ROOT/dist/web"
[ -f "$WEB/web_ui.html" ] || { echo "no $WEB/web_ui.html — run npm run web:build" >&2; exit 1; }
cp "$WEB/web_ui.html" "$STAGE/web_ui.html"
mkdir -p "$STAGE/assets"
for f in "$WEB/assets/"*; do
  case "$(basename "$f")" in
    # The gallery is a review page; the packs are the browser build's own
    # copies, and the Move's page is a remote that plays nothing itself.
    gallery-*|*.nisp) ;;
    *) cp "$f" "$STAGE/assets/" ;;
  esac
done
cp "$ROOT/web/fonts/OFL.txt" "$ROOT/web/fonts/Bravura-OFL.txt" "$STAGE/assets/"

# COPYFILE_DISABLE stops macOS bsdtar writing AppleDouble "._*" resource
# forks into the archive; they unpack onto the Move as junk beside every file.
(cd "$ROOT/dist" && COPYFILE_DISABLE=1 tar -czf piano-practice-module.tar.gz piano-practice)
"$ROOT/scripts/verify-package.sh" "$ROOT/dist/piano-practice-module.tar.gz"
