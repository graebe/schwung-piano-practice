// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/* After the suite: Chrome's coverage of every test, as lcov for the report. */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export default function teardown() {
  execFileSync('node', ['scripts/e2e-coverage.mjs', 'build/coverage/e2e-raw', 'dist/web', 'build/coverage/e2e.lcov'],
    { cwd: ROOT, stdio: 'inherit' });
}
