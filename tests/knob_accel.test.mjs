// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/* The calmer settings knobs: ten units a value, one value an event at most. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnobAccumulator, TICKS_PER_STEP } from '../src/knob_accel.mjs';

const turn = (acc, knob, units, { at = 0, every = 10, by = 1 } = {}) => {
  const out = [];
  for (let i = 0; i < units; i++) out.push(acc.feed(knob, by, at + i * every));
  return out.filter(Boolean);
};

test('ten units turned one way are one value; nine are none', () => {
  assert.equal(TICKS_PER_STEP, 10);
  assert.deepEqual(turn(createKnobAccumulator(), 0, 9), []);
  assert.deepEqual(turn(createKnobAccumulator(), 0, 10), [1]);
  assert.deepEqual(turn(createKnobAccumulator(), 0, 25), [1, 1], 'twenty-five: two, on separate events');
  assert.deepEqual(turn(createKnobAccumulator(), 0, 20, { by: -1 }), [-1, -1]);
});

test('turning back starts the count again', () => {
  const acc = createKnobAccumulator();
  assert.deepEqual(turn(acc, 0, 9), []);
  assert.deepEqual(turn(acc, 0, 9, { at: 100, by: -1 }), [], 'nine back: the nine forward are gone');
  assert.deepEqual(turn(acc, 0, 1, { at: 200, by: -1 }), [-1], 'the tenth back is a step back');
});

test('a rest starts the count again', () => {
  const acc = createKnobAccumulator({ idleMs: 600 });
  assert.deepEqual(turn(acc, 0, 9), []);
  assert.deepEqual(turn(acc, 0, 1, { at: 80 + 601 }), [], 'after a rest, one unit is one unit');
  assert.deepEqual(turn(acc, 0, 9, { at: 700 }), [1]);
});

test('one event moves one value at most, and drops what it turned past', () => {
  const acc = createKnobAccumulator();
  assert.equal(acc.feed(0, 35, 0), 1, 'a flick of 35 is one step');
  assert.equal(acc.feed(0, 4, 10), 0, 'its 30 past the step are not banked: 5 + 4');
  assert.equal(acc.feed(0, 1, 20), 1);
  assert.equal(acc.feed(0, 0, 30), 0, 'nothing turned, nothing moves');
});

test('each knob counts for itself, and reset forgets every partial turn', () => {
  const acc = createKnobAccumulator();
  assert.deepEqual(turn(acc, 0, 5), []);
  assert.deepEqual(turn(acc, 1, 5, { at: 50 }), []);
  assert.deepEqual(turn(acc, 0, 5, { at: 100 }), [1], 'knob 0 kept its five');
  turn(acc, 1, 4, { at: 150 });
  acc.reset();
  assert.deepEqual(turn(acc, 1, 1, { at: 200 }), [], 'knob 1 forgot its nine');
});
