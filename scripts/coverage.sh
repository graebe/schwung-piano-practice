#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Torben Gräber
#
# Coverage of everything this repository is responsible for, in one report:
#
#   js     node's own coverage of the unit tests (core, device, web libraries)
#   rust   cargo-llvm-cov of the DSP crates
#   e2e    Chrome's coverage of the web app under Playwright, mapped back to its
#          sources (web/e2e; run by the full tier with PP_E2E_COVERAGE=1)
#
# Writes build/coverage/{js,rust}.lcov, coverage.json (machine), summary.txt
# (human) and html/index.html, and fails below the floor in
# tests/coverage.floors.json. An e2e.lcov already in build/coverage is merged.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/timing.sh
. scripts/timing.sh

OUT=build/coverage
mkdir -p "$OUT"

if ! cargo llvm-cov --version >/dev/null 2>&1; then
    echo "cargo-llvm-cov not found -- it carries the Rust half." >&2
    echo "  cargo install cargo-llvm-cov && rustup component add llvm-tools-preview" >&2
    exit 1
fi

ni_time_stage coverage-js -- node --test --experimental-test-coverage \
    --test-reporter=dot --test-reporter-destination=stdout \
    --test-reporter=lcov --test-reporter-destination="$OUT/js.lcov" \
    tests/*.test.mjs web/test/*.test.mjs web/test/kit/*.test.mjs || exit

# The crates' own tests, then the C conformance suite against the same
# instrumented build: schwung-plugin is reached only through the C ABI.
rust_coverage() {
    cd dsp
    eval "$(cargo llvm-cov show-env --sh 2>/dev/null)"
    export CARGO_TARGET_DIR=$CARGO_LLVM_COV_TARGET_DIR
    cargo llvm-cov clean --workspace
    cargo test --workspace --no-default-features --release --quiet
    sh ../tests/dsp/run.sh
    cargo llvm-cov report --release --lcov --output-path ../build/coverage/rust.lcov
}
ni_time_stage coverage-rust -- rust_coverage || exit

lcovs=("$OUT/js.lcov" "$OUT/rust.lcov")
[ -f "$OUT/e2e.lcov" ] && lcovs+=("$OUT/e2e.lcov")
COVERAGE_ENFORCE=1 ni_time_stage coverage-report -- node scripts/coverage-report.mjs "${lcovs[@]}"
