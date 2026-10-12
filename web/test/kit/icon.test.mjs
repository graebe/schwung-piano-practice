// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
// From the neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/test/icon.test.mjs).
// Changed: the paths are this repository's -- web/design/icons, web/src/kit/lib/icons.js.
/*
 * The Icon is the design system's own fifteen glyphs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { iconBody, iconName, FILLED } from '../../src/kit/lib/icon-svg.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'design', 'icons');
const SET = ['play', 'pause', 'stop', 'record', 'loop', 'copy', 'paste',
             'export', 'export-all', 'import',
             'shuffle', 'reset', 'link', 'chevron', 'power'];

test('the design ships the fifteen glyphs the Icon names', () => {
  const names = readdirSync(DIR).filter((f) => f.endsWith('.svg')).map(iconName).sort();
  assert.deepEqual(names, [...SET].sort());
});

test('every glyph file reads to a body of plain shapes', () => {
  for (const name of SET) {
    const body = iconBody(readFileSync(join(DIR, `${name}.svg`), 'utf8'));
    assert.ok(body, `${name}.svg did not read`);
    assert.match(body, /^<(path|circle)/);
  }
});

test('play and record are the filled two', () => {
  assert.deepEqual([...FILLED].sort(), ['play', 'record']);
});

test('anything that is not a 16px glyph of plain shapes is refused', () => {
  assert.equal(iconBody('<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>'), null);
  assert.equal(iconBody('<svg viewBox="0 0 16 16"><script>x()</script></svg>'), null);
  assert.equal(iconBody('<svg viewBox="0 0 16 16"><path d="M0 0" style="fill:red"/></svg>'), null);
  assert.equal(iconBody(undefined), null);
});

test('the icons module globs the design files, not a copy of them', () => {
  const src = readFileSync(join(ROOT, 'src', 'kit', 'lib', 'icons.js'), 'utf8');
  const m = /import\.meta\.glob\('([^']+)'/.exec(src);
  assert.ok(m, 'no glob');
  const dir = join(ROOT, 'src', 'kit', 'lib', dirname(m[1]));
  assert.ok(existsSync(dir), `${m[1]} does not resolve`);
  assert.equal(dir, DIR);
});
