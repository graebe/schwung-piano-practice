// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * The avatar's walk: a function of time, smooth, clamped, retargetable.
 * Imports only src/pathmap, so it runs unchanged in Drums Practice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { layoutPlaces, cellCentre } from '../src/pathmap/layout.mjs';
import {
  MS_PER_CELL, MS_EASE_CELL, createWalk, walkTo, walkStep, posAt, arrived, walkDuration,
} from '../src/pathmap/walk.mjs';

const L7 = layoutPlaces(7);
const centreOfRoute = (L, k) => cellCentre(L.route[k]);

test('a new walk stands on its place', () => {
  const w = createWalk(L7, 3);
  const p = posAt(w, 12345);
  const c = cellCentre(L7.cells[3]);
  assert.deepEqual([p.x, p.y, p.moving, p.at], [c.x, c.y, false, 3]);
  assert.ok(arrived(w, 0));
  assert.equal(createWalk(L7).target, 0, 'place 0 by default');
  assert.equal(createWalk(L7, 99).target, 6, 'clamped to the map');
  assert.equal(createWalk(L7, -3).target, 0);
  assert.throws(() => createWalk(layoutPlaces(0), 0), RangeError);
});

test('walking: 90 ms per cell, through every cell, then an ease over the last', () => {
  const w = createWalk(L7, 0);
  walkTo(w, 3, 1000);
  const d = L7.stops[3];
  assert.equal(walkDuration(d), (d - 1) * MS_PER_CELL + MS_EASE_CELL);
  for (let k = 0; k < d; k++) {
    const p = posAt(w, 1000 + k * MS_PER_CELL);
    const c = centreOfRoute(L7, k);
    assert.deepEqual([p.x, p.y], [c.x, c.y], `on cell ${k} at ${k * MS_PER_CELL} ms`);
    assert.ok(p.moving || k === 0);
  }
  /* Halfway through a walked cell is halfway between the two centres. */
  const half = posAt(w, 1000 + MS_PER_CELL / 2);
  const a = centreOfRoute(L7, 0);
  const b = centreOfRoute(L7, 1);
  assert.deepEqual([half.x, half.y], [Math.round((a.x + b.x) / 2), Math.round((a.y + b.y) / 2)]);
  assert.ok(Math.abs(half.s - 0.5) < 1e-9);
  const end = 1000 + walkDuration(d);
  assert.ok(posAt(w, end - 1).moving);
  assert.ok(!arrived(w, end - 1) && arrived(w, end));
  const there = posAt(w, end);
  assert.deepEqual([there.moving, there.at, there.s], [false, 3, d]);
});

test('the ease-out meets the walking speed without a jolt, and slows to a stop', () => {
  const w = createWalk(L7, 0);
  walkTo(w, 6, 0);
  const d = L7.stops[6];
  const flatEnd = (d - 1) * MS_PER_CELL;
  const speed = (t) => (posAt(w, t + 0.5).s - posAt(w, t - 0.5).s);
  assert.ok(Math.abs(speed(flatEnd - 5) - 1 / MS_PER_CELL) < 1e-6);
  assert.ok(Math.abs(speed(flatEnd + 1) - 1 / MS_PER_CELL) < 0.001, 'continuous across the seam');
  const t = flatEnd + MS_EASE_CELL;
  assert.ok(speed(t - 20) < speed(t - 100), 'slowing down');
  assert.ok(speed(t - 1) < 0.001, 'nearly stopped at the end');
});

test('the avatar never jumps: at 10 ms a frame it moves at most 2 px', () => {
  for (const [from, to] of [[0, 6], [6, 0], [2, 5]]) {
    const w = createWalk(L7, from);
    walkTo(w, to, 0);
    let last = posAt(w, 0);
    for (let t = 10; t <= walkDuration(Math.abs(L7.stops[to] - L7.stops[from])) + 20; t += 10) {
      const p = posAt(w, t);
      assert.ok(Math.abs(p.x - last.x) + Math.abs(p.y - last.y) <= 2, `${from}->${to} at ${t} ms`);
      last = p;
    }
    assert.equal(last.at, to);
  }
});

test('passing a place counts as reaching it, in either direction', () => {
  const w = createWalk(L7, 0);
  walkTo(w, 6, 0);
  const seen = [];
  for (let t = 0; !arrived(w, t); t += 5) {
    const at = posAt(w, t).at;
    if (seen[seen.length - 1] !== at) seen.push(at);
  }
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5]);
  assert.equal(posAt(w, 1e6).at, 6);
  walkTo(w, 1, 1e6);
  const back = [];
  for (let t = 1e6; !arrived(w, t); t += 5) {
    const at = posAt(w, t).at;
    if (back[back.length - 1] !== at) back.push(at);
  }
  assert.deepEqual(back, [6, 5, 4, 3, 2]);
});

test('a new target while walking starts from where the avatar is', () => {
  const w = createWalk(L7, 0);
  walkTo(w, 6, 0);
  const before = posAt(w, 400);
  assert.ok(before.s > L7.stops[1], 'already past place 1');
  walkTo(w, 1, 400);
  const after = posAt(w, 400);
  assert.deepEqual([after.x, after.y], [before.x, before.y], 'no jump on retarget');
  assert.ok(Math.abs(after.s - before.s) < 1e-9);
  assert.ok(posAt(w, 430).s < after.s, 'and turns back');
  const end = 400 + walkDuration(before.s - L7.stops[1]);
  assert.ok(!arrived(w, end - 1) && arrived(w, end));
  assert.equal(posAt(w, end).at, 1);
  /* Retargeting to where it already stands is a no-op walk. */
  walkTo(w, 1, end + 50);
  assert.ok(arrived(w, end + 50));
});

test('walkStep moves a place at a time from the target, clamped, no wrap', () => {
  const w = createWalk(L7, 0);
  walkStep(w, -1, 7, 0);
  assert.equal(w.target, 0, 'no wrap below');
  assert.ok(arrived(w, 0));
  walkStep(w, 1, 7, 0);
  walkStep(w, 1, 7, 10);
  assert.equal(w.target, 2, 'two detents mid-walk: two places on');
  walkStep(w, 10, 7, 20);
  assert.equal(w.target, 6, 'no wrap above');
  walkStep(w, 1, 4, 30);
  assert.equal(w.target, 3, 'clamped to the count given');
  walkTo(w, -4, 40);
  assert.equal(w.target, 0);
});

test('one place: standing still is all a walk can do', () => {
  const L = layoutPlaces(1);
  const w = createWalk(L, 0);
  walkStep(w, 1, 1, 0);
  const p = posAt(w, 0);
  assert.deepEqual([p.moving, p.at], [false, 0]);
  assert.deepEqual([p.x, p.y], [cellCentre(L.cells[0]).x, cellCentre(L.cells[0]).y]);
});
