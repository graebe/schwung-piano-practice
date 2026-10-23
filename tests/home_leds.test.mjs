// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * The pads on the home screen. Imports only src/home, so it runs unchanged
 * in Drums Practice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { homePadColors, PULSE_MS } from '../src/home/leds.mjs';

const PALETTE = { off: 0, item: 1, selected: 2, selectedDim: 3 };

test('five pads on the bottom row, columns 1..5; the rest dark', () => {
  const out = homePadColors({ selected: 4, now: 0, palette: PALETTE });
  assert.equal(out.length, 32);
  assert.deepEqual(out.slice(0, 7), [0, 1, 1, 1, 1, 2, 0], 'notes 68..74');
  assert.ok(out.slice(7).every((c) => c === PALETTE.off));
});

test('the selected pad pulses on the 500 ms phase', () => {
  const at = (now) => homePadColors({ count: 5, selected: 1, now, palette: PALETTE })[2];
  assert.equal(PULSE_MS, 500);
  assert.equal(at(0), PALETTE.selected);
  assert.equal(at(249), PALETTE.selected);
  assert.equal(at(250), PALETTE.selectedDim);
  assert.equal(at(500), PALETTE.selected);
  assert.equal(homePadColors({ count: 5, selected: 1, now: 250, palette: PALETTE })[1], PALETTE.item, 'the others steady');
});

test('a smaller ring lights its pads centred under it; a caller-owned array is filled in place', () => {
  const out = new Array(32).fill(9);
  const got = homePadColors({ count: 3, selected: 0, now: 0, palette: PALETTE, out });
  assert.equal(got, out);
  assert.deepEqual(out.slice(0, 6), [0, 0, 2, 1, 1, 0], 'three on columns 2..4');
  assert.deepEqual(homePadColors({ count: 2, selected: 1, palette: PALETTE }).slice(0, 8), [0, 0, 0, 1, 2, 0, 0, 0], 'two on 3..4');
  assert.deepEqual(homePadColors({ count: 4, selected: 3, palette: PALETTE }).slice(0, 8), [0, 0, 1, 1, 1, 2, 0, 0], 'four on 2..5');
  assert.equal(homePadColors({ count: 9, palette: PALETTE }).filter((c) => c !== 0).length, 5, 'never more than five');
});
