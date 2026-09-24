#!/usr/bin/env sh
# C against Rust: the same score through both engines, samples compared.
#
# Not bit-exact, and cannot be: the C is built -ffast-math and libm's sinf and
# powf are not the platform's. The tolerance is tight enough that a wrong decay
# constant, a dropped partial or a different stealing order fails it, and loose
# enough to survive legitimate last-bit float divergence.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
OUT="$ROOT/build/ab"
mkdir -p "$OUT"

if [ ! -f "$ROOT/src/dsp/piano.c" ]; then
  echo "ab: skipped — the C engine is gone, so there is nothing to compare against"
  exit 0
fi

CARGO=${CARGO:-cargo}
command -v "$CARGO" >/dev/null 2>&1 || CARGO="$HOME/.rustup/toolchains/$(rustc -vV 2>/dev/null | sed -n 's/^host: //p')/bin/cargo"
command -v "$CARGO" >/dev/null 2>&1 || {
  echo "ab: skipped — no cargo on PATH"
  exit 0
}

case "$(uname -s)" in
  Darwin) EXT=dylib ;;
  *)      EXT=so ;;
esac

# Both engines as host shared libraries.
cc -std=c11 -O2 -ffast-math -fPIC -shared -I"$ROOT/src/vendor" \
  "$ROOT/src/dsp/piano.c" -lm -o "$OUT/libpiano_c.$EXT"
( cd "$ROOT/dsp" && "$CARGO" build --release --quiet )
cp "$ROOT/dsp/target/release/libpiano.$EXT" "$OUT/libpiano_rust.$EXT"

cc -std=c11 -O2 -Wall -Wextra -I"$ROOT/src/vendor" \
  "$ROOT/tests/dsp/ab.c" -o "$OUT/ab"

"$OUT/ab" "$OUT/libpiano_c.$EXT"    "$OUT/c.raw"
"$OUT/ab" "$OUT/libpiano_rust.$EXT" "$OUT/rust.raw"

node "$ROOT/tests/dsp/ab_compare.mjs" "$OUT/c.raw" "$OUT/rust.raw"
