#!/usr/bin/env sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Torben Gräber
#
# Fetch the recordings samples/*.nisp are cut from, pinned, into the shared
# dataset cache (~/Library/Caches/neon-ingvy/samples, kept across worktrees).
# Only scripts/build-samples.sh needs them: the packs themselves are committed
# (Git LFS), so building and packaging the module never comes here.
#
#   salamander   Salamander Grand Piano V3, Alexander Holm, CC-BY 3.0,
#                sfzinstruments' SFZ edition, pinned by commit.
#                SALAMANDER_DIR may name an existing checkout of that commit.
#   vcsl-click   two claves from VCSL (Versilian Studios, CC0-1.0), by sha256.
#
# Prints the directory of each, as NAME=DIR lines, for build-samples.sh.
set -eu

CACHE=${NI_SAMPLES_CACHE:-$HOME/Library/Caches/neon-ingvy/samples}
mkdir -p "$CACHE"

SALAMANDER_URL=https://github.com/sfzinstruments/SalamanderGrandPiano.git
SALAMANDER_REV=3382bf9496bba2486f5ab0de55a264d1dfc38404
VCSL_REV=c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e

# A git checkout of $2 at $3 in $1, cloned if absent; refuses one at another rev.
pinned_checkout() {
  dir=$1 url=$2 rev=$3
  if [ ! -d "$dir/.git" ]; then
    git clone --quiet --no-checkout "$url" "$dir" >&2
    git -C "$dir" checkout --quiet "$rev"
  fi
  have=$(git -C "$dir" rev-parse HEAD)
  [ "$have" = "$rev" ] || { echo "fetch-samples: $dir is at $have, the packs were cut from $rev" >&2; exit 1; }
}

SALAMANDER=${SALAMANDER_DIR:-$CACHE/salamander}
pinned_checkout "$SALAMANDER" "$SALAMANDER_URL" "$SALAMANDER_REV"
echo "salamander=$SALAMANDER"

# URL path (encoded), sha256: a download that does not match is deleted.
CLICK=$CACHE/vcsl-click
mkdir -p "$CLICK"
while read -r path sum; do
  file=$CLICK/$(basename "$path")
  if [ ! -f "$file" ]; then
    curl -sfL -o "$file" "https://raw.githubusercontent.com/sgossner/VCSL/$VCSL_REV/$path"
  fi
  got=$(shasum -a 256 "$file" | cut -d' ' -f1)
  [ "$got" = "$sum" ] || { rm -f "$file"; echo "fetch-samples: $path has sha256 $got, want $sum" >&2; exit 1; }
done <<LIST
Idiophones/Struck%20Idiophones/Claves/Claves1_Hit_v3_rr1_Mid.wav 12285f65ed125f4140d1e8a86b2d6a08bf3283b7bf30c10d68290b8e8230a927
Idiophones/Struck%20Idiophones/Claves/Claves2_Hit_v3_rr1_Mid.wav 04954891896d00559d4b59ef468d9f1f51a5c42cb23de6f08af8e8eaaf764a8a
LIST
echo "vcsl-click=$CLICK"
