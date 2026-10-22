// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * The pad grid as the Path map. Imports only src/pathmap, so it runs
 * unchanged in Drums Practice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { layoutPlaces, padOfCell } from '../src/pathmap/layout.mjs';
import { createWalk, walkTo, posAt, walkDuration } from '../src/pathmap/walk.mjs';
import { makePlace } from '../src/pathmap/model.mjs';
import { mapPadColors, PULSE_MS } from '../src/pathmap/leds.mjs';

const PALETTE = { off: 0, done: 1, current: 2, currentDim: 3, started: 4, fresh: 5, skipped: 6, avatar: 7 };
const STATES = ['done', 'current', 'started', 'fresh', 'skipped', 'ahead', 'fresh'];
const places = STATES.map((state, i) => makePlace({ label: 'P' + i, state, kind: 'island' }));
const L = layoutPlaces(7);
const idx = (cell) => padOfCell(cell) - 68;

test('each place lights its pad by state; water is dark', () => {
  const out = mapPadColors({ places, layout: L, now: 0, palette: PALETTE });
  assert.equal(out.length, 32);
  const want = [1, 2, 4, 5, 6, 5, 5];
  for (let i = 0; i < 7; i++) assert.equal(out[idx(L.cells[i])], want[i], STATES[i]);
  const lit = new Set(L.cells.map(idx));
  for (let k = 0; k < 32; k++) if (!lit.has(k)) assert.equal(out[k], PALETTE.off, `pad ${68 + k}`);
});

test('indexed by note - 68: island 1 sits on the bottom-left pad', () => {
  const out = mapPadColors({ places, layout: L, now: 0, palette: PALETTE });
  assert.equal(out[0], PALETTE.done);
});

test('the current place pulses on a 500 ms period', () => {
  const at = (now) => mapPadColors({ places, layout: L, now, palette: PALETTE })[idx(L.cells[1])];
  assert.equal(PULSE_MS, 500);
  assert.equal(at(0), PALETTE.current);
  assert.equal(at(249), PALETTE.current);
  assert.equal(at(250), PALETTE.currentDim);
  assert.equal(at(499), PALETTE.currentDim);
  assert.equal(at(500), PALETTE.current);
});

test('an ahead place takes the palette\'s ahead colour when it has one', () => {
  const out = mapPadColors({ places, layout: L, now: 0, palette: { ...PALETTE, ahead: 9 } });
  assert.equal(out[idx(L.cells[5])], 9);
});

test('the avatar\'s pad is the brightest, and runs across the water while walking', () => {
  const w = createWalk(L, 3);
  let out = mapPadColors({ places, layout: L, walk: w, now: 0, palette: PALETTE });
  assert.equal(out[idx(L.cells[3])], PALETTE.avatar, 'standing on its place');
  walkTo(w, 4, 0);
  const lit = [];
  for (let t = 0; t <= walkDuration(L.stops[4] - L.stops[3]); t += 10) {
    out = mapPadColors({ places, layout: L, walk: w, now: t, palette: PALETTE });
    const k = out.indexOf(PALETTE.avatar);
    assert.equal(out.filter((c) => c === PALETTE.avatar).length, 1);
    assert.equal(k, idx(L.route[Math.round(posAt(w, t).s)]));
    if (lit[lit.length - 1] !== k) lit.push(k);
  }
  assert.deepEqual(lit, L.route.slice(L.stops[3], L.stops[4] + 1).map(idx), 'every cell on the way');
  assert.equal(out[idx(L.cells[3])], PALETTE.fresh, 'the place it left shows its state again');
});

test('a caller-owned array is filled in place', () => {
  const out = new Array(32).fill(42);
  const got = mapPadColors({ places, layout: L, now: 0, palette: PALETTE, out });
  assert.equal(got, out);
  assert.ok(!out.includes(42));
});

test('more places than the layout holds are ignored, fewer leave the rest dark', () => {
  const out = mapPadColors({ places: places.slice(0, 2), layout: L, now: 0, palette: PALETTE });
  assert.equal(out.filter((c) => c !== PALETTE.off).length, 2);
  const over = mapPadColors({ places: [...places, ...places], layout: L, now: 0, palette: PALETTE });
  assert.equal(over.filter((c) => c !== PALETTE.off).length, 7);
});
