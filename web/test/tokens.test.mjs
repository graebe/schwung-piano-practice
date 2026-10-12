// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * tokens.test.mjs -- the token guard, for the browser UI.
 *
 * A port of the plugin repository's ui-kit/test/tokens.test.mjs, with one
 * difference: there the token file was transcribed by hand and a test compared
 * it with the design system; here it is generated (scripts/gen-tokens.mjs),
 * so the comparison is "the committed file is what the generator writes".
 *
 *   1. tokens.gen.css is up to date with web/design/*.json
 *   2. the generator stops, naming the token, on a shape it does not know
 *   3. no colour is spelled anywhere under web/src but tokens.gen.css
 *   4. every var(--x) under web/src is defined
 *
 * The reason is the kit's, and it is not tidiness: when the design system
 * moves, the diff has to be against ONE file. A colour typed into a drawing
 * routine is a value that has silently stopped tracking the system.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, isStale, render, colour, px, em, shadowLayers, ALIASES, ROOT, SYSTEM_JSON, EXTENSION_JSON, TOKENS_CSS }
  from '../../scripts/gen-tokens.mjs';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const system = () => JSON.parse(readFileSync(SYSTEM_JSON, 'utf8'));
const extension = () => JSON.parse(readFileSync(EXTENSION_JSON, 'utf8'));

/* ----------------------------------------------------------- generator -- */

test('tokens.gen.css is what the generator writes (gen-tokens --check)', () => {
  assert.equal(isStale(), false, 'stale: run node scripts/gen-tokens.mjs');
  assert.equal(readFileSync(TOKENS_CSS, 'utf8'), generate());
});

test('every token of the system and of the app is a custom property', () => {
  const css = readFileSync(TOKENS_CSS, 'utf8');
  const s = system();
  const names = [
    ...s.color.tokens, ...extension().color.tokens, ...s.spacing.tokens, ...s.radius.tokens,
    ...s.size.tokens, ...s.stroke.tokens, ...s.shadow.tokens,
  ].map((t) => t.name);
  for (const n of names) assert.match(css, new RegExp(`--${n}: `), n);
  for (const st of s.type.groups.flatMap((g) => g.styles)) assert.match(css, new RegExp(`\\.t-${st.name} \\{`));
  for (const [alias, target] of ALIASES) assert.match(css, new RegExp(`--${alias}: var\\(--${target}\\);`));
  assert.match(css, /--knob: 48px;/, 'size states bare px');
  assert.match(css, /--uv-glow: #a259ff80;/, 'alpha kept');
  assert.match(css, /--glow-focus: 0 0 0 1px #efe3ff, 0 0 8px #a259ff80;/);
});

test('the generator stops on a shape it does not know, naming the token', () => {
  const stops = (mutate, pattern, ext = extension()) => {
    const s = system();
    mutate(s, ext);
    assert.throws(() => render(s, ext), pattern);
  };
  stops((s) => { s.color.tokens[0].value = 'rgb(1, 2, 3)'; }, /colour "bg-000"/);
  stops((s) => { s.color.tokens[0].value = { dusk: '#000000' }; }, /theme "dusk"/);
  stops((s) => { s.color.themes.push({ id: 'day' }); }, /2 colour themes/);
  stops((s) => { s.motion = {}; }, /family "motion"/);
  stops((s) => { s.spacing.tokens[0].value = '4'; }, /"space-1" is "4", not a length in px/);
  stops((s) => { s.spacing.tokens[0].value = '1rem'; }, /"space-1"/);
  stops((s) => { s.radius.tokens[0].extra = 1; }, /field "extra"/);
  stops((s) => { s.shadow.tokens[0].value = '0 0 10px var(--x)'; }, /colour "glow-led"/);
  stops((s) => { s.shadow.tokens[0].value = '10px #a259ff'; }, /layer/);
  stops((s) => { s.type.groups[0].styles[0].textTransform = 'uppercase'; }, /property "textTransform"/);
  stops((s) => { s.type.groups[0].styles[0].letterSpacing = '1px'; }, /not in em/);
  stops((s) => { s.type.groups[0].styles[0].fontWeight = 450; }, /weight 450/);
  stops((s) => { s.type.families.serif = 'Georgia'; }, /family "serif"/);
  stops((s) => { s.type.fonts = ['x']; }, /fonts to load/);
  stops((s) => { s.color.tokens.push({ ...s.color.tokens[0] }); }, /two tokens are called "bg-000"/);
  stops((s) => { s.color.tokens[0].name = 'Bg 000'; }, /not a name/);
  stops((s) => { delete s.meta.release; }, /meta.release/);
  stops((s) => { delete s.stroke; }, /no stroke family/);
  stops(() => {}, /reviewed against Ultraviolet 0\.9/, { ...extension(), release: '0.9' });
  stops(() => {}, /extends "Phosphor"/, { ...extension(), extends: 'Phosphor' });
  stops(() => {}, /may add colours only/, { ...extension(), spacing: {} });
  stops(() => {}, /two tokens are called "uv"/,
    { ...extension(), color: { tokens: [{ name: 'uv', value: '#ffffff' }] } });
  /* And reads without the extension. */
  assert.doesNotMatch(render(system(), null), /answer-/);
});

test('the value readers', () => {
  assert.equal(colour('#ABCDEF', 'x'), '#abcdef');
  assert.equal(colour(' #a259ff80 ', 'x'), '#a259ff80');
  assert.throws(() => colour('#abc', 'x'), /#rrggbb/);
  assert.equal(px('4px', 'x'), 4);
  assert.equal(px('48', 'x', true), 48);
  assert.equal(px('0', 'x'), 0, 'zero needs no unit');
  assert.equal(em(undefined, 'x'), 0);
  assert.equal(em('-.01em', 'x'), -0.01);
  assert.deepEqual(shadowLayers('0 0 0 1px #efe3ff', 'x'), [{ x: 0, y: 0, blur: 0, spread: 1, colour: '#efe3ff' }]);
});

/* -------------------------------------------------------------- guard -- */

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(css|jsx?|mjs)$/.test(name)) out.push(p);
  }
  return out;
}
const files = walk(SRC);

/* #rgb/#rrggbb/#rrggbbaa and the functional notations. Not `#` in a URL or an
 * id: those are followed by a letter run that is not hex-only, which the word
 * boundary and the length class exclude. */
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/;
/* And a colour's shape in a canvas: three 0..255 channels in brackets, one of
 * them past 9 (the kit's guard found amber spelled that way once). */
const TRIPLE = /\[\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\]/g;
const colourTriple = (line) => {
  for (const m of line.matchAll(TRIPLE)) {
    const c = [m[1], m[2], m[3]].map(Number);
    if (c.every((v) => v <= 255) && c.some((v) => v > 9)) return m[0];
  }
  return null;
};
/* Comments explain the tokens constantly and must not trip the guard. */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the guard walks the whole UI', () => {
  const rels = files.map((f) => relative(ROOT, f));
  for (const must of ['web/src/styles/tokens.gen.css', 'web/src/kit/components.css', 'web/src/music/music.css',
                      'web/src/music/GrandStaff.jsx', 'web/src/kit/lib/field.js'])
    assert.ok(rels.includes(must), `${must} not walked`);
});

test('no colour is spelled under web/src but in tokens.gen.css', () => {
  const offences = [];
  for (const file of files) {
    if (basename(file) === 'tokens.gen.css') continue;
    stripComments(readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
      const m = line.match(COLOUR)?.[0] ?? colourTriple(line);
      if (m) offences.push(`${relative(ROOT, file)}:${i + 1}  ${m}  --  ${line.trim().slice(0, 72)}`);
    });
  }
  assert.deepEqual(offences, [], `colour literals outside tokens.gen.css:\n  ${offences.join('\n  ')}`);
});

test('the guard would catch one', () => {
  for (const bad of ['color: #fff;', 'fill: rgba(0,0,0,.5)', 'oklch(70% 0.1 300)', 'const amber = [255, 176, 0];'])
    assert.ok(COLOUR.test(bad) || colourTriple(bad), bad);
  for (const ok of ['url(#staff-lane-1)', 'const at = [0, 1, 2];', 'href="#gallery"'])
    assert.ok(!COLOUR.test(ok) && !colourTriple(ok), ok);
});

test('every var() under web/src is defined', () => {
  /* Defined: a custom property any stylesheet or component declares. The
   * guard above already forbids a colour anywhere else, so a property
   * declared outside tokens.gen.css can only hold a length or a var() back
   * into the system -- never a second palette. */
  const defined = new Set();
  for (const file of files)
    for (const m of stripComments(readFileSync(file, 'utf8')).matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
  const missing = new Set();
  for (const file of files)
    for (const m of stripComments(readFileSync(file, 'utf8')).matchAll(/var\(\s*(--[\w-]+)/g))
      if (!defined.has(m[1])) missing.add(`${relative(ROOT, file)}: ${m[1]}`);
  assert.deepEqual([...missing], [], `undefined tokens:\n  ${[...missing].join('\n  ')}`);
});

test('the colours a canvas reads back are plain #rrggbb', () => {
  /* field.js reads --bg-000, --bg-dot and --uv-deep through readRgb, which
   * takes six hex digits and nothing else. */
  const css = readFileSync(TOKENS_CSS, 'utf8');
  for (const name of ['bg-000', 'bg-dot', 'uv-deep'])
    assert.match(css, new RegExp(`--${name}: #[0-9a-f]{6};`), name);
});
