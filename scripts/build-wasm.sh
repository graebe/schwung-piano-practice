#!/usr/bin/env sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Torben Gräber
# Build the browser's piano: piano-wasm for wasm32-unknown-unknown, copied to
# build/wasm/piano.wasm. The same piano-engine the Move runs, so a lesson in
# the browser sounds like the instrument on the device.
#
# Needs the wasm32-unknown-unknown target already installed (rustup target add
# wasm32-unknown-unknown). This script does not install toolchains.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
TARGET=wasm32-unknown-unknown

command -v cargo >/dev/null 2>&1 \
  || { echo "build-wasm: no cargo on PATH" >&2; exit 1; }
if command -v rustup >/dev/null 2>&1; then
  rustup target list --installed | grep -qx "$TARGET" \
    || { echo "build-wasm: the $TARGET target is not installed (rustup target add $TARGET)" >&2; exit 1; }
fi

( cd "$ROOT/dsp" && cargo build --release --quiet --target "$TARGET" -p piano-wasm )

BUILT=${CARGO_TARGET_DIR:-$ROOT/dsp/target}/$TARGET/release/piano_wasm.wasm
test -f "$BUILT" || { echo "build-wasm: cargo produced no $BUILT" >&2; exit 1; }
mkdir -p "$ROOT/build/wasm"
cp "$BUILT" "$ROOT/build/wasm/piano.wasm"
echo "wasm: build/wasm/piano.wasm, $(wc -c < "$ROOT/build/wasm/piano.wasm" | tr -d ' ') bytes"
