#!/usr/bin/env sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Torben Gräber
# Assert the tarball carries everything the module imports at runtime.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
ARCHIVE=${1:-$ROOT/dist/piano-practice-module.tar.gz}
test -f "$ARCHIVE"

LIST=$(tar -tzf "$ARCHIVE")
for entry in \
  piano-practice/module.json \
  piano-practice/ui.js \
  piano-practice/dsp.so \
  piano-practice/help.json \
  piano-practice/exercises/index.json \
  piano-practice/LICENSE \
  piano-practice/web_ui.html \
  piano-practice/assets/THIRD_PARTY_LICENSES.txt \
  piano-practice/assets/OFL.txt \
  piano-practice/assets/Bravura-OFL.txt \
  piano-practice/samples/piano.nisp \
  piano-practice/samples/click.nisp \
  piano-practice/samples/LICENSES/CC-BY-3.0.txt \
  piano-practice/samples/LICENSES/CC0-1.0.txt
do
  echo "$LIST" | grep -qx "$entry" || { echo "missing from package: $entry" >&2; exit 1; }
done

# The siblings are stamped per build, so check by count rather than by name.
# The expected count is READ OUT OF package.sh rather than written here: it was
# a literal 16, and adding a seventeenth module failed this check with a number
# that said nothing about which file was missing.
WANT=$(sed -n -e 's/^MODULES="\(.*\)"$/\1/p' -e 's/^PATHMAP="\(.*\)"$/\1/p' -e 's/^HOMESCREEN="\(.*\)"$/\1/p' \
  "$ROOT/scripts/package.sh" | wc -w | tr -d ' ')
MJS=$(echo "$LIST" | grep -c '/[A-Za-z0-9_]*-[0-9][0-9]*\.mjs$' || true)
[ "$MJS" -eq "$WANT" ] || { echo "package.sh names $WANT modules, the tarball has $MJS" >&2; exit 1; }

# Every relative import, from any packaged file, must resolve to a packaged
# file — and must carry this build's stamp. An unstamped sibling would be
# served from QuickJS's runtime-lifetime module cache by whatever version of
# this module was opened first, and link against stale exports.
TMPD=$(mktemp -d)
tar -xzf "$ARCHIVE" -C "$TMPD"
MODDIR="$TMPD/piano-practice"
for f in "$MODDIR/ui.js" "$MODDIR"/*.mjs "$MODDIR"/pathmap/*.mjs "$MODDIR"/home/*.mjs; do
  for imp in $(sed -n "s/.*from '\.\/\([A-Za-z0-9_/-]*\.mjs\)'.*/\1/p" "$f"); do
    if [ ! -f "$(dirname "$f")/$imp" ]; then
      echo "$(basename "$f") imports $imp, which is not in the package" >&2
      rm -rf "$TMPD"; exit 1
    fi
    case "$imp" in
      *-[0-9]*.mjs) ;;
      *) echo "$(basename "$f") imports unstamped $imp — it would be served from a stale cache" >&2
         rm -rf "$TMPD"; exit 1 ;;
    esac
  done
done
# The packs are packs, not the LFS pointers a checkout without its objects
# holds, and the web build's copies stay out (the page on the Move plays
# nothing; dsp.so reads samples/).
for pack in piano click; do
  if [ "$(head -c 4 "$MODDIR/samples/$pack.nisp")" != NISP ]; then
    echo "samples/$pack.nisp in the package is not a pack" >&2
    rm -rf "$TMPD"; exit 1
  fi
done
rm -rf "$TMPD"
if echo "$LIST" | grep -q '/assets/.*\.nisp$'; then
  echo "the web build's packs are in the package" >&2; exit 1
fi

# Every file the page loads must be in the archive, relative to the page —
# except the manager's own bridge, which the manager serves.
for ref in $(grep -oE '(src|href)="[^"]*"' "$ROOT/dist/web/web_ui.html" | sed 's/^[a-z]*="\(.*\)"$/\1/'); do
  case "$ref" in
    /static/schwung-remote-api.js|data:*) ;;
    ./*) echo "$LIST" | grep -qx "piano-practice/${ref#./}" || { echo "web_ui.html loads $ref, not packaged" >&2; exit 1; } ;;
    *) echo "web_ui.html loads $ref: not relative, so not served from the module" >&2; exit 1 ;;
  esac
done
if echo "$LIST" | grep -q '/assets/gallery-'; then
  echo "the gallery page's assets are in the package" >&2; exit 1
fi

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
