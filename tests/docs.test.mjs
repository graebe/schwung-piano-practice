// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { expected, termsPage } from '../tools/docs.mjs';
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
  for (const n of [1, 2, 3, 4, 5]) assert.match(curriculum, new RegExp('## Phase ' + n + ': '));
});

test('the Terms page defines every term, within the help width', () => {
  const page = termsPage();
  for (const k of Object.keys(TERMS)) assert.ok(page.lines.includes(TERMS[k][0]), k);
  for (const l of page.lines) assert.ok(l.length <= 25, JSON.stringify(l));
});
