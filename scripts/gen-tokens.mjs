#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * The browser UI's design tokens, generated from the design system's own file.
 *
 *   node scripts/gen-tokens.mjs           write it if it is stale
 *   node scripts/gen-tokens.mjs --check   say whether it is stale, exit 1 if so
 *
 * WHAT IT READS:
 *
 *   web/design/ultraviolet-tokens.json   Ultraviolet's tokens.json, vendored
 *                                        byte for byte (web/design/SOURCE.md
 *                                        names the commit): every colour,
 *                                        space, radius, size, stroke, shadow
 *                                        and text style, with its usage note
 *   web/design/practice-tokens.json      this app's additions, in the same
 *                                        shape: colours the system has no
 *                                        token for, and nothing else
 *
 * WHAT IT WRITES:
 *
 *   web/src/styles/tokens.gen.css        custom properties on :root, the
 *                                        text-style classes, and the aliases
 *                                        the copied ui-kit spells
 *
 * Committed, so a build needs nothing but Vite, and held to this program:
 * web/test/tokens.test.mjs runs --check, and fails while any other stylesheet
 * or component under web/src spells a colour of its own. Re-vendor the
 * design, run this, commit both. Same rules as the plugin repository's
 * scripts/gen-tokens.mjs, which writes the native editors' header from the
 * same file.
 *
 * NOTHING IS GUESSED. A shape this does not know -- a colour that is neither
 * #rrggbb nor #rrggbbaa, a length that is not px, a family, a token field or a
 * text-style property it has no rule for, a second theme -- stops it with the
 * token's name rather than writing something plausible.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SYSTEM_JSON = join(ROOT, 'web', 'design', 'ultraviolet-tokens.json');
export const EXTENSION_JSON = join(ROOT, 'web', 'design', 'practice-tokens.json');
export const TOKENS_CSS = join(ROOT, 'web', 'src', 'styles', 'tokens.gen.css');

const fail = (msg) => { throw new Error(`gen-tokens: ${msg}`); };

/*
 * THE KIT'S SPELLINGS. The Solid ui-kit (web/src/kit, copied from the plugin
 * repository) was written against a hand-kept tokens.css with short names of
 * its own. Each is listed here once, with the system token it means, and is
 * emitted as var() of that token -- an alias, never a second value. The list
 * is every custom property the kit's CSS and components use that tokens.json
 * does not name (web/test/tokens.test.mjs fails on one that is missing).
 */
export const ALIASES = [
  ['s1', 'space-1'],
  ['s2', 'space-2'],
  ['s3', 'space-3'],
  ['s4', 'space-4'],
  ['s6', 'space-6'],
  ['s8', 'space-8'],
  ['hair', 'stroke-hair'],
  ['radius', 'radius-0'],
];

/* The families tokens.json may carry, and the shape of each length family's
 * values: `bare` lets a family state px as plain numbers, which only `size`
 * does ("Control sizes, in px"). */
const LENGTH_FAMILIES = [
  { key: 'spacing', title: 'spacing', bare: false },
  { key: 'radius', title: 'radius', bare: false },
  { key: 'size', title: 'size', bare: true },
  { key: 'stroke', title: 'stroke', bare: false },
];
const SYSTEM_KEYS = new Set(['name', 'version', 'meta', 'color', 'type', 'shadow',
  ...LENGTH_FAMILIES.map((f) => f.key)]);
const TOKEN_KEYS = new Set(['name', 'value', 'usage']);
const STYLE_KEYS = new Set(['name', 'fontSize', 'lineHeight', 'fontWeight', 'letterSpacing', 'sample', 'usage']);

/* ------------------------------------------------------------ values -- */

const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

function checkToken(t, family) {
  if (!t || typeof t !== 'object') fail(`a ${family} token is not an object`);
  if (typeof t.name !== 'string' || !NAME.test(t.name))
    fail(`${family} token ${JSON.stringify(t.name)} is not a name a custom property can carry`);
  for (const k of Object.keys(t))
    if (!TOKEN_KEYS.has(k)) fail(`${family} token "${t.name}" has a field "${k}" this generator does not know`);
}

/** #rrggbb or #rrggbbaa, lower-cased; anything else stops the generator. */
export function colour(value, name) {
  const m = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(String(value).trim());
  if (!m) fail(`colour "${name}" is ${JSON.stringify(value)}, not #rrggbb or #rrggbbaa`);
  return `#${m[1].toLowerCase()}`;
}

/** A px length ("4px", or "48" where the family allows bare px) -> a number. */
export function px(value, name, bare = false) {
  const m = /^(-?[0-9]*\.?[0-9]+)(px)?$/.exec(String(value).trim());
  if (!m || (!m[2] && !bare && Number(m[1]) !== 0))
    fail(`"${name}" is ${JSON.stringify(value)}, not a length in px`);
  return Number(m[1]);
}

/** An em length ("0.08em", "-.01em") -> a number of ems; absent is 0. */
export function em(value, name) {
  if (value === undefined) return 0;
  const m = /^(-?[0-9]*\.?[0-9]+)em$/.exec(String(value).trim());
  if (!m) fail(`letter-spacing of "${name}" is ${JSON.stringify(value)}, not in em`);
  return Number(m[1]);
}

const len = (n) => (n === 0 ? '0' : `${n}px`);

/*
 * The CSS shadow list the system writes -- "0 0 10px #a259ff, 0 0 2px #efe3ff"
 * -- as layers. Split on the commas between layers only: a colour here is
 * always hex, so there is no rgba() comma to survive, and one that is not hex
 * stops the generator in colour().
 */
export function shadowLayers(value, name) {
  return String(value).split(',').map((layer) => {
    const parts = layer.trim().split(/\s+/);
    const c = colour(parts.pop(), name);
    const lengths = parts.map((p) => px(p, name));
    if (lengths.length < 2 || lengths.length > 4)
      fail(`shadow "${name}" has a layer "${layer.trim()}" this cannot read`);
    const [x, y, blur = 0, spread = 0] = lengths;
    return { x, y, blur, spread, colour: c };
  });
}

/* ------------------------------------------------------------- prose -- */

/* A usage note as a CSS comment, wrapped, with nothing that could end it. */
function comment(text, indent = '  ', width = 78) {
  const words = String(text).replace(/\*\//g, '* /').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && indent.length + 3 + line.length + 1 + w.length > width) {
      lines.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);
  if (lines.length === 1 && indent.length + lines[0].length + 6 <= width) return `${indent}/* ${lines[0]} */`;
  return [`${indent}/*`, ...lines.map((l) => `${indent} * ${l}`), `${indent} */`].join('\n');
}

/* ------------------------------------------------------------ render -- */

/** The colour tokens of one source, validated, in the default theme. */
function colours(block, themeId, where) {
  if (!block || !Array.isArray(block.tokens)) fail(`${where} has no colour tokens`);
  return block.tokens.map((t) => {
    checkToken(t, 'colour');
    let v = t.value;
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v))
        if (k !== themeId) fail(`colour "${t.name}" has a value for theme "${k}", which is not declared`);
      v = v[themeId];
    }
    return { name: t.name, value: colour(v, t.name), usage: t.usage };
  });
}

export function render(system, extension) {
  const out = [];
  const emit = (s = '') => out.push(s);
  const defined = new Map();
  const define = (name, value, usage) => {
    if (defined.has(name)) fail(`two tokens are called "${name}"`);
    defined.set(name, value);
    if (usage) emit(comment(usage));
    emit(`  --${name}: ${value};`);
  };

  for (const key of Object.keys(system))
    if (!SYSTEM_KEYS.has(key)) fail(`tokens.json has a family "${key}" this generator does not know`);
  const release = system.meta?.release;
  if (!release) fail('tokens.json has no meta.release');

  /* One theme: a page has one :root, and choosing between themes would be a
   * decision this file has no rule for. */
  const themes = system.color?.themes ?? [];
  if (themes.length !== 1) fail(`tokens.json declares ${themes.length} colour themes; tokens.gen.css has one :root`);
  const theme = themes[0].id;

  emit('/* SPDX-License-Identifier: GPL-3.0-or-later */');
  emit('/* Copyright (C) 2026 Torben Gräber */');
  emit();
  emit('/*');
  emit(` * ${system.name} ${release} -- GENERATED, DO NOT EDIT.`);
  emit(' *');
  emit(' * scripts/gen-tokens.mjs wrote this from web/design/ultraviolet-tokens.json');
  emit(' * (the design system\'s tokens.json, vendored) and web/design/practice-tokens.json');
  emit(' * (this app\'s additions). After re-vendoring the design, run');
  emit(' *');
  emit(' *     node scripts/gen-tokens.mjs');
  emit(' *');
  emit(' * and commit what it writes. web/test/tokens.test.mjs fails while this file');
  emit(' * differs from what the generator would write, and while anything else under');
  emit(' * web/src spells a colour of its own: this is the one file that may.');
  emit(' *');
  emit(' * Names are the system\'s. The comments are its usage notes, which say what a');
  emit(' * token is FOR.');
  emit(' */');
  emit();
  emit(':root {');

  /* ---- colour */
  emit('  /* ========================================================== colour == */');
  if (system.color.note) emit(comment(system.color.note));
  for (const c of colours(system.color, theme, 'tokens.json')) define(c.name, c.value, c.usage);

  /* ---- the app's colours, after the system's and never in place of one */
  if (extension) {
    if (extension.extends !== system.name)
      fail(`practice-tokens.json extends "${extension.extends}", not "${system.name}"`);
    if (extension.release !== release)
      fail(`practice-tokens.json was reviewed against ${system.name} ${extension.release}, ` +
           `and the system is ${release}: review it, then set its release`);
    for (const key of Object.keys(extension))
      if (!['name', 'extends', 'release', 'note', 'color'].includes(key))
        fail(`practice-tokens.json has a family "${key}"; it may add colours only`);
    emit();
    emit(`  /* ${'='.repeat(50)} ${extension.name} == */`);
    if (extension.note) emit(comment(extension.note));
    if (extension.color?.note) emit(comment(extension.color.note));
    for (const c of colours(extension.color, theme, 'practice-tokens.json')) define(c.name, c.value, c.usage);
  }

  /* ---- the length families */
  for (const fam of LENGTH_FAMILIES) {
    const block = system[fam.key];
    if (!block || !Array.isArray(block.tokens)) fail(`tokens.json has no ${fam.key} family`);
    emit();
    emit(`  /* ${'='.repeat(Math.max(4, 64 - fam.title.length))} ${fam.title} == */`);
    if (block.note) emit(comment(block.note));
    for (const t of block.tokens) {
      checkToken(t, fam.key);
      define(t.name, `${px(t.value, t.name, fam.bare)}px`, t.usage);
    }
  }

  /* ---- light */
  const shadows = system.shadow;
  if (!shadows || !Array.isArray(shadows.tokens)) fail('tokens.json has no shadow family');
  emit();
  emit('  /* ============================================================ shadow == */');
  if (shadows.note) emit(comment(shadows.note));
  for (const t of shadows.tokens) {
    checkToken(t, 'shadow');
    const layers = shadowLayers(t.value, t.name);
    define(t.name, layers.map((l) =>
      [len(l.x), len(l.y), len(l.blur), ...(l.spread ? [len(l.spread)] : []), l.colour].join(' ')).join(', '), t.usage);
  }

  /* ---- type: the family as a property, the styles as classes */
  const type = system.type;
  if (!type?.families) fail('tokens.json has no type families');
  if ((type.fonts ?? []).length) fail('tokens.json lists fonts to load, which this generator has no rule for');
  for (const fam of Object.keys(type.families))
    if (fam !== 'mono') fail(`type family "${fam}" is not one this generator knows`);
  emit();
  emit('  /* ============================================================== type == */');
  if (type.note) emit(comment(type.note));
  define('font-mono', type.families.mono);

  /* ---- the kit's spellings */
  emit();
  emit('  /* ===================================================== kit aliases == */');
  emit(comment('The names the copied ui-kit spells, each the system token it means (ALIASES in scripts/gen-tokens.mjs).'));
  for (const [alias, target] of ALIASES) {
    if (!defined.has(target)) fail(`the alias --${alias} names --${target}, which tokens.json does not define`);
    define(alias, `var(--${target})`);
  }
  emit('}');

  /* ---- the text styles */
  emit();
  emit('/* ============================================================ text styles ==');
  emit(' * One class per style, t-<name>: size, line height, weight and tracking as the');
  emit(' * system states them. Uppercase is not a token; the kit\'s stylesheet sets it');
  emit(' * on the styles whose usage notes ask for it. */');
  const seen = new Set();
  for (const group of type.groups ?? []) {
    if (!type.families[group.family]) fail(`type group "${group.name}" names family "${group.family}", which is not declared`);
    for (const s of group.styles ?? []) {
      for (const k of Object.keys(s))
        if (!STYLE_KEYS.has(k)) fail(`text style "${s.name}" has a property "${k}" this generator does not know`);
      if (!NAME.test(s.name ?? '')) fail(`text style ${JSON.stringify(s.name)} is not a class name`);
      if (seen.has(s.name)) fail(`two text styles are called "${s.name}"`);
      seen.add(s.name);
      const weight = Number(s.fontWeight);
      if (!Number.isInteger(weight) || weight < 100 || weight > 900 || weight % 100)
        fail(`text style "${s.name}" has weight ${JSON.stringify(s.fontWeight)}`);
      const tracking = em(s.letterSpacing, s.name);
      if (s.usage) emit(comment(s.usage, ''));
      emit(`.t-${s.name} {`);
      emit(`  font: ${weight} ${px(s.fontSize, s.name)}px/${px(s.lineHeight, s.name)}px var(--font-${group.family});`);
      emit(`  letter-spacing: ${tracking === 0 ? '0' : `${tracking}em`};`);
      emit('}');
    }
  }
  emit();
  return out.join('\n');
}

/* ---------------------------------------------------------- generate -- */

/** What the generator writes, as text. */
export function generate() {
  const system = JSON.parse(readFileSync(SYSTEM_JSON, 'utf8'));
  const extension = existsSync(EXTENSION_JSON) ? JSON.parse(readFileSync(EXTENSION_JSON, 'utf8')) : null;
  return render(system, extension);
}

/* Whether the file on disk is what generate() makes; CRLF line ends (git's
 * autocrlf on Windows) are the same file. */
export function isStale(text = generate()) {
  if (!existsSync(TOKENS_CSS)) return true;
  return readFileSync(TOKENS_CSS, 'utf8').replace(/\r\n/g, '\n') !== text;
}

function main(argv) {
  const text = generate();
  const stale = isStale(text);
  const rel = relative(ROOT, TOKENS_CSS);
  if (argv.includes('--check')) {
    if (stale) console.error(`stale: ${rel}\nrun: node scripts/gen-tokens.mjs`);
    return stale ? 1 : 0;
  }
  if (!stale) {
    console.log('up to date');
    return 0;
  }
  mkdirSync(dirname(TOKENS_CSS), { recursive: true });
  writeFileSync(TOKENS_CSS, text);
  console.log(`wrote ${rel}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = main(process.argv.slice(2));
