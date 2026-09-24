#!/usr/bin/env sh
# The DSP conformance suite.
#
# tests/dsp/test_piano.c is deliberately NOT ported to Rust. It is the
# acceptance criterion for the port: 33 assertions written against the C, run
# unaltered through the Rust, across the same C ABI the Move actually calls.
# Rewriting them as #[test] would test the Rust through Rust and throw away
# exactly the evidence that makes a rewrite safe.
#
# While both engines exist, both are run.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
mkdir -p "$ROOT/build/tests"

case "$(uname -s)" in
  Darwin) EXT=dylib ;;
  *)      EXT=so ;;
esac

find_cargo() {
  if command -v cargo >/dev/null 2>&1; then echo cargo; return; fi
  for c in "$HOME"/.cargo/bin/cargo "$HOME"/.rustup/toolchains/*/bin/cargo; do
    [ -x "$c" ] && { echo "$c"; return; }
  done
}

# ---- the C engine, while it is still the one that ships --------------------
if [ -f "$ROOT/src/dsp/piano.c" ]; then
  cc -std=c11 -Wall -Wextra -Werror -I"$ROOT/src/vendor" \
    "$ROOT/tests/dsp/test_piano.c" "$ROOT/src/dsp/piano.c" \
    -lm -o "$ROOT/build/tests/test_piano_c"
  echo "# engine: C"
  "$ROOT/build/tests/test_piano_c"
fi

# ---- the Rust engine -------------------------------------------------------
CARGO=$(find_cargo)
if [ -z "${CARGO:-}" ]; then
  echo "# engine: Rust — SKIPPED, no cargo on PATH" >&2
  exit 0
fi

( cd "$ROOT/dsp" && "$CARGO" build --release --quiet )
cc -std=c11 -Wall -Wextra -Werror -I"$ROOT/src/vendor" \
  "$ROOT/tests/dsp/test_piano.c" "$ROOT/dsp/target/release/libpiano.$EXT" \
  -lm -o "$ROOT/build/tests/test_piano_rust"
echo "# engine: Rust"
"$ROOT/build/tests/test_piano_rust"
