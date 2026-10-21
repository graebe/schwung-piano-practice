#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Torben Gräber
#
# Re-cut the committed sample packs from their pinned sources:
#
#   samples/piano.nisp   from samples/piano.manifest.toml (Salamander)
#   samples/click.nisp   from samples/click.manifest.toml (VCSL claves)
#
# Run it when a manifest or tools/nisp-build changes, then commit the packs
# and their reports together. The build is deterministic: the same sources
# and manifest give the same bytes, so an unchanged pack shows no diff.
# Every stage is timed into the shared build-timing log.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/timing.sh
. scripts/timing.sh

sources=$(sh scripts/fetch-samples.sh)
src() { printf '%s\n' "$sources" | sed -n "s/^$1=//p"; }

ni_time_stage nisp-build-tool -- cargo build --release --quiet --manifest-path tools/nisp-build/Cargo.toml || exit
TOOL=tools/nisp-build/target/release/nisp-build

pack() {
    "$TOOL" build "samples/$1.manifest.toml" --source "$2" --out "samples/$1.nisp" --report "samples/$1.report.txt"
}
ni_time_stage pack-piano -- pack piano "$(src salamander)" || exit
ni_time_stage pack-click -- pack click "$(src vcsl-click)" || exit
