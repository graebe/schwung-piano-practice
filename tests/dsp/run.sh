#!/usr/bin/env sh
# The DSP conformance suite.
#
# tests/dsp/test_piano.c is C on purpose, and stays C. It is the only thing in
# the repo that exercises the engine the way the Move does: through the plugin
# v2 C ABI, from a caller that knows nothing about Rust. Rewriting it as
# #[test] would test the Rust through Rust and lose exactly that.
#
# It is also the port's evidence. These 33 assertions were written against the
# C engine and now run unaltered against the Rust one, which is what made
# deleting the C defensible rather than hopeful.
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

CARGO=$(find_cargo)
if [ -z "${CARGO:-}" ]; then
  echo "# DSP tests SKIPPED — no cargo on PATH" >&2
  exit 0
fi

( cd "$ROOT/dsp" && "$CARGO" build --release --quiet )
cc -std=c11 -Wall -Wextra -Werror -I"$ROOT/src/vendor" \
  "$ROOT/tests/dsp/test_piano.c" "$ROOT/dsp/target/release/libpiano.$EXT" \
  -lm -o "$ROOT/build/tests/test_piano"
"$ROOT/build/tests/test_piano"
