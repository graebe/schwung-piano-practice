#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
mkdir -p "$ROOT/build/tests"
cc -std=c11 -Wall -Wextra -Werror -I"$ROOT/src/vendor" \
  "$ROOT/tests/dsp/test_piano.c" "$ROOT/src/dsp/piano.c" \
  -lm -o "$ROOT/build/tests/test_piano"
"$ROOT/build/tests/test_piano"
