#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Torben Gräber
#
# The two test tiers. Everything runs here, on this machine; GitHub Actions only
# publishes a release.
#
#   scripts/test.sh quick   while developing, seconds: the design tokens are in
#                           step, the wasm piano builds, every node unit test
#                           (core, device, web libraries), the DSP crates'
#                           tests
#   scripts/test.sh full    before merging or releasing, minutes: quick, then
#                           the C conformance suites, the device build in
#                           Docker and the tarball's checks, the web build,
#                           the browser end to end in Chrome, and coverage
#                           against its floor
#
# Every stage is timed into the shared build-timing log (scripts/timing.sh).
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/timing.sh
. scripts/timing.sh

tier=${1:-quick}
case "$tier" in
    quick|full) ;;
    *) echo "usage: scripts/test.sh quick|full" >&2; exit 2 ;;
esac
NI_TIMING_PRESET=$tier
export NI_TIMING_PRESET

stage() {
    local name=$1
    shift
    printf '\n== %s\n' "$name"
    if ! ni_time_stage "$name" -- "$@"; then
        printf '\nFAILED: %s\n' "$name" >&2
        exit 1
    fi
}

stage tokens node scripts/gen-tokens.mjs --check
stage wasm sh scripts/build-wasm.sh
stage unit node --test --test-reporter=dot tests/*.test.mjs web/test/*.test.mjs web/test/kit/*.test.mjs
stage rust sh -c 'cd dsp && cargo test --workspace --no-default-features --quiet'

if [ "$tier" = full ]; then
    stage dsp-abi sh tests/dsp/run.sh
    stage device-build sh scripts/build.sh
    stage package sh tests/package/run.sh
    stage web-build npx vite build --config web/vite.config.js --logLevel warn
    # Raw coverage is one file per test, named after it: a renamed test would
    # leave its old file behind, pointing at a bundle that no longer exists.
    rm -rf build/coverage/e2e.lcov build/coverage/e2e-raw
    PP_E2E_COVERAGE=1 stage e2e npx playwright test --config web/e2e/playwright.config.mjs
    stage coverage bash scripts/coverage.sh
fi

printf '\n%s tier: all green\n' "$tier"
