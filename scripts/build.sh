#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
COMPILER=${CC:-${CROSS_PREFIX:-aarch64-linux-gnu-}gcc}

if command -v "$COMPILER" >/dev/null 2>&1; then
  "$ROOT/scripts/build-dsp.sh"
elif command -v docker >/dev/null 2>&1; then
  docker build -q -t piano-practice-build "$ROOT" >/dev/null
  docker run --rm --user "$(id -u):$(id -g)" -v "$ROOT:/build" \
    piano-practice-build ./scripts/build-dsp.sh
else
  echo "Need Docker or an aarch64-linux-gnu-gcc cross-compiler." >&2
  exit 1
fi

"$ROOT/scripts/package.sh"
