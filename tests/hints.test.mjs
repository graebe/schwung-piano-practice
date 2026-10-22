// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * hints.test.mjs — every screen says which keys work on it, in one row or in
 * parts that take turns, and the Shift layer says what Shift does there.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { VIEWS } from '../src/session.mjs';
import {
  keysFor, hintFor, hintPart, keyLines, pack, HINT_CHARS, ROTATE_MS,
} from '../src/hints.mjs';

/* Every state a screen's hint distinguishes, and none. */
const STATES = [{}, { top: true }, { scrolls: true }, { pages: 3 }, { choice: true },
  { stages: true, stage: 1 }, { stages: true, stage: 2 }, { listening: true }, { paused: true },
  { quiz: true }, { twoNext: true }, { ear: true, hintsLeft: true }, { ear: true }, { pick: true },
  { pick: true, hintsLeft: true }, { streak: 7 }, { editing: true }, { action: true }];

test('every screen of the session has a hint, and a Shift layer', () => {
  for (const view of VIEWS) {
    for (const st of STATES) {
      const parts = hintFor(view, st);
      assert.ok(parts.length > 0, `${view} ${JSON.stringify(st)} has no hint`);
      assert.ok(hintFor(view, { ...st, shift: true }).length > 0, `${view}: no Shift layer`);
    }
  }
  assert.deepEqual(hintFor('nowhere'), [], 'an unknown screen says nothing rather than something wrong');
  assert.equal(keysFor('nowhere'), null);
});

test('every part fits one row of the panel; longer hints are split into parts', () => {
  for (const view of VIEWS) {
    for (const st of STATES) {
      for (const shift of [false, true]) {
        for (const part of hintFor(view, { ...st, shift })) {
          assert.ok(part.length <= HINT_CHARS, `${view}: "${part}" is ${part.length} characters`);
        }
      }
    }
  }
  assert.deepEqual(pack(['CLICK do it', 'BACK close']), ['CLICK do it', 'BACK close'], '23 characters: two parts');
  assert.deepEqual(pack(['CLICK open', 'MENU help']), ['CLICK open  MENU help'], '21 fit in one');
  assert.deepEqual(pack([]), []);
});

test('the format is KEY verb, two spaces between pairs, in the suggested words', () => {
  assert.deepEqual(hintFor('menu', { top: true }), ['CLICK open  MENU help']);
  assert.deepEqual(hintFor('menu', {}), ['CLICK open  BACK up']);
  assert.deepEqual(hintFor('sheet'), ['CLICK do it', 'BACK close']);
  assert.deepEqual(hintFor('info', { scrolls: true }), ['JOG scroll', 'BACK close']);
  assert.deepEqual(hintFor('card', { pages: 3 }), ['JOG page  CLICK go on']);
  assert.deepEqual(hintFor('running', {}), ['REC pause  BACK stop']);
  assert.deepEqual(hintFor('running', { listening: true }), ['PLAY pause  BACK stop']);
  assert.deepEqual(hintFor('summary', {}), ['CLICK next  REC again']);
  assert.ok(hintFor('ready', {}).join('  ').startsWith('REC start  PLAY listen'));
  for (const view of VIEWS) {
    for (const part of hintFor(view, {})) {
      for (const pair of part.split('  ')) {
        assert.match(pair, /^((JOG|CLICK|BACK|MENU|SHIFT|PLAY|REC|PAD) |S[12] |PAUSED$|streak )/, `${view}: "${pair}"`);
      }
    }
  }
});

test('while Shift is held the footer is what Shift does here, each part saying so', () => {
  assert.deepEqual(hintFor('menu', { shift: true }), ['SHIFT: CLICK options', 'SHIFT: BACK quit']);
  assert.deepEqual(hintFor('ready', { shift: true }), ['SHIFT: CLICK settings', 'SHIFT: BACK quit']);
  assert.deepEqual(hintFor('summary', { shift: true }), ['SHIFT: CLICK skip', 'SHIFT: BACK quit']);
  for (const view of VIEWS) {
    for (const part of hintFor(view, { shift: true })) assert.match(part, /^SHIFT: /);
  }
});

test('parts take turns every three seconds, by the clock', () => {
  const parts = ['A', 'B', 'C'];
  assert.equal(hintPart(parts, 0), 'A');
  assert.equal(hintPart(parts, ROTATE_MS - 1), 'A');
  assert.equal(hintPart(parts, ROTATE_MS), 'B');
  assert.equal(hintPart(parts, 3 * ROTATE_MS), 'A');
  assert.equal(hintPart(['only'], 99999), 'only');
  assert.equal(hintPart([], 0), '');
  assert.equal(hintPart(null, 0), '');
  assert.equal(hintPart(parts, -5), 'A');
});

test('the help page lists the keys, MENU, and the Shift layer', () => {
  assert.deepEqual(keyLines('menu', { top: true }), ['CLICK open', 'MENU help', 'SHIFT+CLICK options', 'SHIFT+BACK quit']);
  assert.deepEqual(keyLines('info', {}), ['BACK close', 'MENU close', 'SHIFT+BACK quit']);
  assert.ok(!keyLines('ready', { stages: true }).some((l) => /^S[12] /.test(l)), 'a status is not a key');
  assert.deepEqual(keyLines('nowhere'), []);
});
