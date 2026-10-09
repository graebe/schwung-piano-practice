// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * spdx.test.mjs — every source file says what it is licensed under, and whose.
 *
 * The licence changed once already (MIT up to 1.8.1, GPL-3.0-or-later since),
 * and a file without a header is the one a reader cannot place. So every file
 * this repository writes carries the SPDX line and the copyright line in its
 * first lines, and a new file without them fails here rather than in review.
 *
 * Not ours, so not held to it: src/vendor (Schwung's header), and data files
 * that cannot carry a comment (JSON).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SPDX = 'SPDX-License-Identifier: GPL-3.0-or-later';
const OWNER = 'Copyright (C) 2026 Torben Gräber';

const ROOTS = ['src', 'tests', 'tools', 'scripts', 'dsp', 'web', '.github'];
const SKIP_DIRS = new Set(['node_modules', 'target', 'vendor', 'exercises', 'fixtures', 'dist', 'pkg']);
const SOURCE = /\.(m?js|jsx|rs|c|h|sh|css|yml)$|^Dockerfile$/;
/* Code copied in from elsewhere keeps its own header, which names its source. */
const FOREIGN = /\/kit\//;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* walk(path);
    } else if (SOURCE.test(name)) {
      yield path;
    }
  }
}

function sources() {
  const out = [join(ROOT, 'Dockerfile')];
  for (const r of ROOTS) if (existsSync(join(ROOT, r))) out.push(...walk(join(ROOT, r)));
  return out;
}

test('every source file carries the SPDX and copyright lines', () => {
  const missing = [];
  for (const path of sources()) {
    const rel = relative(ROOT, path);
    if (FOREIGN.test('/' + rel)) continue;
    const head = readFileSync(path, 'utf8').split('\n').slice(0, 4).join('\n');
    if (!head.includes(SPDX) || !head.includes(OWNER)) missing.push(rel);
  }
  assert.deepEqual(missing, [], 'files without the licence header');
});

test('the walk actually finds the sources', () => {
  const rels = sources().map((p) => relative(ROOT, p));
  for (const must of ['src/ui.js', 'dsp/piano/src/lib.rs', 'scripts/build.sh', 'Dockerfile']) {
    assert.ok(rels.includes(must), `${must} not walked`);
  }
});
