#!/usr/bin/env sh
# Cross-compile the piano to aarch64. Run inside the Docker image (see
# build.sh) unless a Rust aarch64-unknown-linux-gnu toolchain is already here.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
TARGET=aarch64-unknown-linux-gnu
STRIP=${STRIP:-${CROSS_PREFIX:-aarch64-linux-gnu-}strip}

# The Move's loader is the wrong place to find out about any of this, so each
# of these refuses the build instead.
#
#   GLIBC_MAX  the device is glibc 2.35 and the build image is 2.36. A symbol
#              from above the ceiling links here and fails to load there.
#   SIZE_MAX   a dependency that quietly drags in the world should fail the
#              build, not triple everyone's download. The C was ~72KB.
GLIBC_MAX=2.35
SIZE_MAX=$((512 * 1024))

mkdir -p "$ROOT/dist"
( cd "$ROOT/dsp" && cargo build --release --target "$TARGET" )

BUILT=${CARGO_TARGET_DIR:-$ROOT/dsp/target}/$TARGET/release/libpiano.so
test -f "$BUILT" || { echo "cargo produced no $BUILT" >&2; exit 1; }
cp "$BUILT" "$ROOT/dist/dsp.so"
"$STRIP" --strip-unneeded "$ROOT/dist/dsp.so" 2>/dev/null || true

file "$ROOT/dist/dsp.so"

fail() {
  rm -f "$ROOT/dist/dsp.so"
  echo "$1" >&2
  exit 1
}

file "$ROOT/dist/dsp.so" | grep -q 'ARM aarch64' \
  || fail "Refusing a build that is not ARM aarch64 — it would not load on the Move."

# Highest GLIBC_x.y the object references, compared as versions.
NEED=$(strings "$ROOT/dist/dsp.so" | sed -n 's/^GLIBC_\([0-9][0-9.]*\)$/\1/p' \
        | sort -t. -k1,1n -k2,2n | tail -1)
if [ -n "$NEED" ]; then
  HIGHEST=$(printf '%s\n%s\n' "$NEED" "$GLIBC_MAX" | sort -t. -k1,1n -k2,2n | tail -1)
  [ "$HIGHEST" = "$GLIBC_MAX" ] \
    || fail "Needs glibc $NEED but the Move has $GLIBC_MAX — it would not load there."
  echo "glibc: needs $NEED, ceiling $GLIBC_MAX"
fi

SIZE=$(wc -c < "$ROOT/dist/dsp.so")
[ "$SIZE" -le "$SIZE_MAX" ] \
  || fail "dsp.so is $SIZE bytes, over the $SIZE_MAX ceiling."
echo "size: $SIZE bytes (ceiling $SIZE_MAX)"
