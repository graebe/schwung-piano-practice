#!/usr/bin/env sh
# Cross-compile the built-in piano to aarch64. Run inside the Docker image
# (see build.sh) unless a cross-compiler is already on PATH.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
CC_BIN=${CC:-${CROSS_PREFIX:-aarch64-linux-gnu-}gcc}

mkdir -p "$ROOT/dist"
"$CC_BIN" -std=c11 -O2 -ffast-math -Wall -Wextra -Werror -fPIC -shared \
  -I"$ROOT/src/vendor" \
  "$ROOT/src/dsp/piano.c" \
  -lm \
  -o "$ROOT/dist/dsp.so"

file "$ROOT/dist/dsp.so"
if ! file "$ROOT/dist/dsp.so" | grep -q 'ARM aarch64'; then
  rm -f "$ROOT/dist/dsp.so"
  echo "Refusing a build that is not ARM aarch64 — it would not load on the Move." >&2
  exit 1
fi
