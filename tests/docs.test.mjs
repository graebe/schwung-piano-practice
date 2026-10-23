// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { expected, termsPage, helpLineFits } from '../tools/docs.mjs';
import { TERMS } from '../src/info.mjs';

test('the help pages and the README carry the glossary as info.mjs has it', () => {
  const { help, readme } = expected();
  assert.equal(readFileSync(new URL('../src/help.json', import.meta.url), 'utf8'), help,
    'help.json is out of date: run npm run docs');
  assert.equal(readFileSync(new URL('../README.md', import.meta.url), 'utf8'), readme,
    'README.md is out of date: run npm run docs');
});

test('docs/curriculum.md is the path curriculum.mjs describes', () => {
  const { curriculum } = expected();
  assert.equal(readFileSync(new URL('../docs/curriculum.md', import.meta.url), 'utf8'), curriculum,
    'docs/curriculum.md is out of date: run npm run docs');
  for (const n of [1, 2, 3, 4, 5]) assert.match(curriculum, new RegExp('## Stage ' + n + ': '));
  assert.doesNotMatch(curriculum, /\bphase\b/i, 'the path has stages now');
});

test('the Terms page defines every term, within the help width', () => {
  const page = termsPage();
  for (const k of Object.keys(TERMS)) assert.ok(page.lines.includes(TERMS[k][0]), k);
  for (const l of page.lines) assert.ok(helpLineFits(l), JSON.stringify(l));
});

/* Every line of every help page, measured in the panel's font against the
 * width beside the scrollbar: a line wider than that is cut on the Move. */
test('every line of help.json fits beside the scrollbar', () => {
  const help = JSON.parse(readFileSync(new URL('../src/help.json', import.meta.url), 'utf8'));
  for (const page of help.children) {
    for (const l of page.lines) assert.ok(helpLineFits(l), `${page.title}: ${JSON.stringify(l)}`);
  }
});
