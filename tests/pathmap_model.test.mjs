// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * The Path map's places. Imports only src/pathmap, so it runs unchanged in
 * Drums Practice, which vendors the engine byte for byte.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { STATES, KINDS, FILL_LEVELS, makePlace, fillLevel, shortOf, dueTotal } from '../src/pathmap/model.mjs';

test('the states and kinds are the spec\'s, and frozen', () => {
  assert.deepEqual([...STATES], ['done', 'current', 'started', 'fresh', 'skipped', 'ahead']);
  assert.deepEqual([...KINDS], ['island', 'place', 'fort', 'hut', 'cove']);
  assert.ok(Object.isFrozen(STATES) && Object.isFrozen(KINDS));
});

test('makePlace keeps a well-formed place as it is', () => {
  const p = { id: 'p2', label: 'Four chords', short: '4ch', percent: 40, state: 'current', due: 2, kind: 'place' };
  assert.deepEqual(makePlace(p), p);
});

test('makePlace clamps and rounds what an adapter might get wrong', () => {
  assert.equal(makePlace({ percent: 140 }).percent, 100);
  assert.equal(makePlace({ percent: -5 }).percent, 0);
  assert.equal(makePlace({ percent: 33.6 }).percent, 34);
  assert.equal(makePlace({ percent: NaN }).percent, 0);
  assert.equal(makePlace({ due: 2.7 }).due, 2);
  assert.equal(makePlace({ due: -1 }).due, 0);
  assert.equal(makePlace({ due: undefined }).due, 0);
});

test('makePlace falls back to a fresh place for unknown states and kinds', () => {
  const p = makePlace({ state: 'locked', kind: 'volcano' });
  assert.equal(p.state, 'fresh');
  assert.equal(p.kind, 'place');
  const empty = makePlace();
  assert.deepEqual(empty, { id: '', label: '', short: '', percent: 0, state: 'fresh', due: 0, kind: 'place' });
  assert.equal(makePlace({ id: 7 }).id, '7');
});

test('a missing short label comes from the first word', () => {
  assert.equal(shortOf('Intervals I'), 'Inte');
  assert.equal(shortOf('  Ear  '), 'Ear');
  assert.equal(shortOf(''), '');
  assert.equal(shortOf(null), '');
  assert.equal(makePlace({ label: 'Grooves' }).short, 'Groo');
  assert.equal(makePlace({ label: 'Grooves', short: 'G' }).short, 'G');
});

test('fillLevel: begun shows a row, only finished shows them all', () => {
  assert.equal(FILL_LEVELS, 4);
  assert.equal(fillLevel(0), 0);
  assert.equal(fillLevel(undefined), 0);
  assert.equal(fillLevel(1), 1);
  assert.equal(fillLevel(25), 1);
  assert.equal(fillLevel(26), 2);
  assert.equal(fillLevel(99), FILL_LEVELS - 1);
  assert.equal(fillLevel(100), FILL_LEVELS);
  assert.equal(fillLevel(250), FILL_LEVELS);
  assert.equal(fillLevel(99, 5), 4);
  assert.equal(fillLevel(1, 5), 1);
});

test('0, 20, 40, 60 and 100% are five different fills on 4 or 5 rows', () => {
  assert.deepEqual([0, 20, 40, 60, 100].map((p) => fillLevel(p)), [0, 1, 2, 3, 4]);
  assert.deepEqual([0, 20, 40, 60, 100].map((p) => fillLevel(p, 5)), [0, 1, 2, 3, 5]);
});

test('fillLevel never goes down as the percentage rises', () => {
  for (const levels of [2, 4, 5]) {
    let last = 0;
    for (let p = 0; p <= 100; p++) {
      const l = fillLevel(p, levels);
      assert.ok(l >= last && l <= levels, `${p}% of ${levels}`);
      last = l;
    }
  }
});

test('dueTotal sums the reviews due over a map', () => {
  assert.equal(dueTotal([]), 0);
  assert.equal(dueTotal([makePlace({ due: 2 }), makePlace(), makePlace({ due: 3 })]), 5);
});
