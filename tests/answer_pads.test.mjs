// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ANSWER_COLOURS, LIST_MAX, MAX_ANSWERS, SHORT_MAX,
  answerPads, answerAt, answerRows, inAnswerBar, answerColour, shortLabel, answerLeds,
} from '../src/answer_pads.mjs';
import {
  PAD_FIRST, LED_HIT, LED_MISS, LED_PRESSED, LED_ROOT, LED_SCALE, LED_TARGET_FAR, LED_TARGET_NEAR,
} from '../src/padmap.mjs';

const cols = (n) => answerPads(n).map((pad) => pad - PAD_FIRST);

test('up to four answers sit on every other pad of the bottom row, centred', () => {
  assert.deepEqual(cols(0), []);
  assert.deepEqual(cols(1), [3]);
  assert.deepEqual(cols(2), [2, 5]);
  assert.deepEqual(cols(3), [1, 3, 5]);
  assert.deepEqual(cols(4), [0, 2, 4, 6]);
  for (let n = 2; n <= LIST_MAX; n++) {
    const c = cols(n);
    for (let i = 1; i < c.length; i++) assert.ok(c[i] - c[i - 1] >= 2, `${n}: a dark pad between answers`);
  }
});

test('five to eight fill the bottom row; nine to twelve go up a row', () => {
  assert.deepEqual(cols(5), [0, 1, 2, 3, 4]);
  assert.deepEqual(cols(8), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(cols(12), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(answerRows(0), 0);
  assert.equal(answerRows(3), 1);
  assert.equal(answerRows(8), 1);
  assert.equal(answerRows(9), 2);
  assert.equal(cols(99).length, MAX_ANSWERS, 'capped, never off the grid');
});

test('a pad says which answer it is, and the bar includes its gaps', () => {
  assert.equal(answerAt(3, PAD_FIRST + 3), 1);
  assert.equal(answerAt(3, PAD_FIRST + 2), -1, 'a gap is no answer');
  assert.equal(answerAt(3, PAD_FIRST + 8), -1);
  assert.ok(inAnswerBar(3, PAD_FIRST + 2), 'but it is part of the bar: silent, not a key');
  assert.ok(!inAnswerBar(3, PAD_FIRST + 8), 'the row above is keys');
  assert.ok(inAnswerBar(12, PAD_FIRST + 15));
  assert.ok(!inAnswerBar(0, PAD_FIRST), 'no answers, no bar');
});

test('the layouts are shared, so the LED repaint does not allocate', () => {
  assert.equal(answerPads(3), answerPads(3));
});

test('answer colours never borrow a colour that already means something', () => {
  const taken = [LED_HIT, LED_MISS, LED_PRESSED, LED_ROOT, LED_SCALE, LED_TARGET_FAR, LED_TARGET_NEAR, 0];
  const seen = new Set();
  for (const c of ANSWER_COLOURS) {
    assert.ok(!taken.includes(c.bright) && !taken.includes(c.dim), c.name);
    assert.notEqual(c.bright, c.dim, c.name);
    assert.ok(!seen.has(c.bright), 'each colour once');
    seen.add(c.bright);
    assert.ok(c.name.length <= 6, 'a short name for the screen');
  }
  assert.ok(ANSWER_COLOURS.length >= LIST_MAX, 'a different colour for every listed answer');
  assert.equal(answerColour(ANSWER_COLOURS.length), ANSWER_COLOURS[0], 'past the palette it comes round');
});

test('a map cell holds a short name: the key when short, else the label', () => {
  assert.equal(shortLabel({ key: 'm3', label: 'Minor 3rd' }), 'm3');
  assert.equal(shortLabel({ key: 'IV', label: 'IV' }), 'IV');
  assert.equal(shortLabel({ key: 'higher', label: 'Higher' }), 'Hi');
  assert.equal(shortLabel({ label: 'Major 3rd' }), 'Ma');
  assert.equal(shortLabel(null), '');
  assert.ok(shortLabel({ label: 'Augmented' }).length <= SHORT_MAX);
});

test('struck answers go dark, and the jog answer pulses in its own hue', () => {
  const out = [];
  const struck = (i) => i === 2;
  answerLeds(4, 1, struck, 1, out);
  assert.deepEqual(out, [ANSWER_COLOURS[0].bright, ANSWER_COLOURS[1].bright, 0, ANSWER_COLOURS[3].bright]);
  answerLeds(4, 1, struck, 0, out);
  assert.equal(out[1], ANSWER_COLOURS[1].dim, 'the other half of the pulse');
  assert.equal(out[0], ANSWER_COLOURS[0].bright, 'the rest stay steady');
  answerLeds(2, -1, () => false, 0, out);
  assert.equal(out.length, 2, 'the buffer is reused and trimmed');
});
