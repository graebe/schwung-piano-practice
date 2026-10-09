#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * Chrome's coverage of the editor bundles, mapped back to their sources.
 * From neon-ingvy-audio-plugins (scripts/e2e-coverage.mjs @4e15cc8), where the
 * same author released it under MIT before that repository moved to the GPL.
 *
 *   node scripts/e2e-coverage.mjs <coverage-dir> <web-dir> <out.info>
 *
 * WHY THIS EXISTS. node's own coverage (coverage.sh's JS half) sees what a
 * unit test imports -- the plain-JS libraries. Every .jsx component, and the
 * editors' App.jsx files with them, runs only in a browser, so until this they
 * were absent from the report rather than counted. The end-to-end suite runs
 * exactly that code, in Chrome, against the mock hosts; with NI_E2E_COVERAGE
 * set, tests/e2e/harness.mjs records V8's block coverage of each editor's
 * ui.js, and this reduces it to lcov for the sources the bundle was built
 * from, through the source map vite wrote beside it (build.sh's
 * NI_HARNESS_SOURCEMAP mode, which never touches the bundle a plugin ships).
 *
 * THE METHOD, and what it claims. V8 reports nested ranges of the generated
 * file with an execution count each; the innermost range around an offset
 * holds its count. Each source-map segment ties a generated offset to a source
 * line. A source line is INSTRUMENTED if any segment maps to it, and COVERED if
 * any of those segments sits in code that ran. Lines no segment maps to --
 * comments, blank lines, a lone brace -- are not counted either way, which is
 * the same rule llvm-cov applies to the C++.
 *
 * No dependency: the VLQ decoder is fifteen lines, and the licence audit is a
 * reason to keep the tree small (THIRD_PARTY_LICENSES.md).
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const [covDir, webDir, outFile] = process.argv.slice(2);
if (!covDir || !webDir || !outFile) {
  console.error('usage: e2e-coverage.mjs <coverage-dir> <web-dir> <out.info>');
  process.exit(2);
}

/* ------------------------------------------------------------ source map */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DIGIT = new Map([...B64].map((c, i) => [c, i]));

/** One segment's fields, VLQ-decoded (still relative, as the format has them). */
function vlq(text) {
  const out = [];
  let value = 0, shift = 0;
  for (const c of text) {
    const d = DIGIT.get(c);
    value += (d & 31) << shift;
    if (d & 32) { shift += 5; continue; }
    out.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0; shift = 0;
  }
  return out;
}

/** [{ genLine, genCol, src, line }] for every segment that names a source. */
function segments(map) {
  const segs = [];
  let src = 0, line = 0;
  map.mappings.split(';').forEach((row, genLine) => {
    let col = 0;
    for (const s of row.split(',')) {
      if (!s) continue;
      const f = vlq(s);
      col += f[0];
      if (f.length < 4) continue;
      src += f[1];
      line += f[2];
      segs.push({ genLine, genCol: col, src, line });
    }
  });
  return segs;
}

/* --------------------------------------------------------------- counts */

/**
 * The execution count at every offset of the generated file. V8's ranges nest,
 * so painting them outermost first leaves each offset with its innermost
 * range's count.
 */
function countsFor(source, functions) {
  const counts = new Int32Array(source.length).fill(-1);
  const ranges = functions.flatMap((f) => f.ranges)
    .sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  for (const r of ranges) counts.fill(r.count, r.startOffset, Math.min(r.endOffset, source.length));
  return counts;
}

/* ----------------------------------------------------------------- main */

/* source path -> Map(line -> hits), summed over every page of every test. */
const lines = new Map();
const maps = new Map();

const mapFor = (url) => {
  /* /plugins/<plugin>/ui/test/harness/assets/ui.js -> <web-dir>/<plugin>/... */
  const plugin = /\/plugins\/([^/]+)\/ui\/test\/harness\/assets\/ui\.js$/.exec(new URL(url).pathname)?.[1];
  if (!plugin) return null;
  if (!maps.has(plugin)) {
    const file = join(webDir, plugin, 'assets', 'ui.js.map');
    if (!existsSync(file)) throw new Error(`${file} is missing -- was the harness built with NI_HARNESS_SOURCEMAP?`);
    const map = JSON.parse(readFileSync(file, 'utf8'));
    const base = resolve(dirname(file), map.sourceRoot ?? '');
    maps.set(plugin, { segs: segments(map), sources: map.sources.map((s) => resolve(base, s)) });
  }
  return maps.get(plugin);
};

const files = existsSync(covDir) ? readdirSync(covDir).filter((f) => f.endsWith('.json')) : [];
if (files.length === 0) {
  console.error(`no coverage in ${covDir} -- run the e2e suite with NI_E2E_COVERAGE=1`);
  process.exit(1);
}

for (const f of files) {
  for (const entry of JSON.parse(readFileSync(join(covDir, f), 'utf8'))) {
    const m = mapFor(entry.url);
    if (!m) continue;
    const counts = countsFor(entry.source, entry.functions);
    /* Line starts of the generated file, in the same UTF-16 units V8 and the
     * source map both count in. */
    const starts = [0];
    for (let i = 0; i < entry.source.length; i++) if (entry.source.charCodeAt(i) === 10) starts.push(i + 1);

    for (const s of m.segs) {
      const at = (starts[s.genLine] ?? Infinity) + s.genCol;
      if (!(at < counts.length)) continue;
      const path = m.sources[s.src];
      if (!lines.has(path)) lines.set(path, new Map());
      const byLine = lines.get(path);
      const n = s.line + 1;
      byLine.set(n, Math.max(byLine.get(n) ?? 0, Math.max(0, counts[at])));
    }
  }
}

let out = '';
for (const [path, byLine] of [...lines].sort(([a], [b]) => a.localeCompare(b))) {
  out += `SF:${path}\n`;
  for (const [n, c] of [...byLine].sort(([a], [b]) => a - b)) out += `DA:${n},${c}\n`;
  const hit = [...byLine.values()].filter((c) => c > 0).length;
  out += `LH:${hit}\nLF:${byLine.size}\nend_of_record\n`;
}
writeFileSync(outFile, out);
console.log(`e2e coverage: ${files.length} page record(s), ${lines.size} source file(s) -> ${outFile}`);
