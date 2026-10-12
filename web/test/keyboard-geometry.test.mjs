// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * keyboard-geometry.test.mjs -- where the keys are, and which C to start on
 * (web/src/music/keyboard-geometry.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../src/music/keyboard-geometry.js';

test('black keys are the five of every octave, in any octave', () => {
  const blacks = [];
  for (let m = 0; m < 12; m++) if (K.isBlack(m)) blacks.push(m);
  assert.deepEqual(blacks, [1, 3, 6, 8, 10]);
  assert.equal(K.isBlack(61), true);
  assert.equal(K.isBlack(-11), true, 'negative wraps');
  assert.equal(K.isBlack(60), false);
});

test('white index: seven to an octave, a black key counting as the white below', () => {
  assert.equal(K.whiteIndex(60), 35);
  assert.equal(K.whiteIndex(61), 35);
  assert.equal(K.whiteIndex(62), 36);
  assert.equal(K.whiteIndex(71), 41);
  assert.equal(K.whiteIndex(72), 42);
});

test('the layout: whole octaves, 1px gaps, black keys three fifths and centred', () => {
  const L = K.keyboardLayout({ lowest: 48, octaves: 2, width: 280, height: 66 });
  assert.equal(L.whites.length, 14);
  assert.equal(L.blacks.length, 10);
  assert.equal(L.keys.length, 24);
  assert.equal(L.whiteWidth, 20);
  assert.equal(L.keysHeight, 60);
  const c = L.whites[0];
  assert.deepEqual([c.midi, c.x, c.w, c.h], [48, 0, 19, 60]);
  const cs = L.blacks[0];
  assert.equal(cs.midi, 49);
  assert.equal(cs.w, 12);
  assert.equal(cs.h, 36);
  assert.equal(cs.x + cs.w / 2, 20, 'centred on the line between C and D');
  assert.ok(L.keys.indexOf(cs) > L.keys.indexOf(L.whites.at(-1)), 'black keys drawn last');
});

test('snapped, every edge is a whole pixel and the gaps stay one pixel', () => {
  const L = K.keyboardLayout({ lowest: 36, octaves: 4, width: 701, height: 96, snap: true });
  for (const k of L.keys) for (const v of [k.x, k.w, k.h]) assert.ok(Number.isInteger(v), `${k.midi} ${v}`);
  for (let i = 1; i < L.whites.length; i++)
    assert.equal(L.whites[i].x - (L.whites[i - 1].x + L.whites[i - 1].w), 1);
  assert.ok(L.whites.at(-1).x + L.whites.at(-1).w <= 701);
});

test('a keyboard stops at 127', () => {
  const L = K.keyboardLayout({ lowest: 120, octaves: 2, width: 140, height: 50 });
  assert.equal(Math.max(...L.keys.map((k) => k.midi)), 127);
  assert.equal(K.shows(127, 120, 2), true);
  assert.equal(K.shows(128, 120, 2), false);
  assert.equal(K.shows(119, 120, 2), false);
});

test('hit testing: a black key over the white, the gap belonging to neither', () => {
  const L = K.keyboardLayout({ lowest: 60, octaves: 1, width: 140, height: 106 });
  assert.equal(K.keyAt(L, 15, 10).midi, 61, 'the top of the C#');
  assert.equal(K.keyAt(L, 15, 80).midi, 60, 'below it, the C');
  assert.equal(K.keyAt(L, 25, 80).midi, 62, 'and the D');
  assert.equal(K.keyAt(L, 5, 80).midi, 60);
  assert.equal(K.keyAt(L, 19.5, 80), null, 'the gap after C');
  assert.equal(K.keyAt(L, 5, 104), null, 'the mark space');
});

test('velocity: soft at the far end of a key, loud at the near end', () => {
  const key = { y: 0, h: 100 };
  assert.equal(K.velocityAt(key, 0), 24);
  assert.equal(K.velocityAt(key, 100), 127);
  assert.equal(K.velocityAt(key, 500), 127);
  assert.equal(K.velocityAt(key, -5), 24);
  assert.ok(K.velocityAt(key, 50) > 24 && K.velocityAt(key, 50) < 127);
  assert.equal(K.velocityAt({ y: 0, h: 0 }, 0), 127);
  assert.equal(K.velocityAt(key, 0, { soft: 0, loud: 0 }), 1, 'never 0, which is a note-off');
});

test('the bass mark sits under its key, 3px tall', () => {
  const m = K.bassMark({ x: 40, w: 19 }, 60);
  assert.deepEqual(m, { x: 43, y: 63, w: 13, h: 3 });
  assert.equal(K.bassMark({ x: 0, w: 4 }, 60).w, 2);
});

test('lowestToShow: stays while the notes fit, else the C at or below the lowest', () => {
  assert.equal(K.lowestToShow([], 4, 36), 36);
  assert.equal(K.lowestToShow([40, 60, 83], 4, 36), 36, 'C2..B5 holds them');
  assert.equal(K.lowestToShow([84], 4, 36), 84);
  assert.equal(K.lowestToShow([30, 50], 4, 36), 24);
  assert.equal(K.lowestToShow(new Set([65]), 2, 36), 60);
  assert.equal(K.lowestToShow([127], 4, 36), 84, 'no higher than the C whose octaves reach 127');
  assert.equal(K.lowestToShow([-3, 200], 4, 36), 36, 'out-of-range notes ignored');
});

test('octavesFor: the fewest whole octaves from a C', () => {
  assert.equal(K.octavesFor([]), 1);
  assert.equal(K.octavesFor([60, 71]), 1);
  assert.equal(K.octavesFor([60, 72]), 2);
  assert.equal(K.octavesFor([59, 60], 1), 2);
  assert.equal(K.octavesFor([60], 3), 3);
});

test('C labels', () => {
  assert.equal(K.cLabel(60), 'C4');
  assert.equal(K.cLabel(24), 'C1');
});
