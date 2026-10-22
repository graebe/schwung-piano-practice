// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * Where the places of a Path map sit, and the route between them. Imports
 * only src/pathmap, so it runs unchanged in Drums Practice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COLS, ROWS, CELL_W, CELL_H, MAP_Y, MAP_H, MAX_PLACES,
  layoutPlaces, parseMap, routeIndexOf, padOfCell, cellOfPad, placeOfPad, cellRect, cellCentre,
} from '../src/pathmap/layout.mjs';

const same = (a, b) => a.col === b.col && a.row === b.row;
const manhattan = (a, b) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
const inGrid = (c) => c.col >= 0 && c.col < COLS && c.row >= 0 && c.row < ROWS;

/* Everything a layout of any size must hold to. */
function assertWellFormed(n) {
  const L = layoutPlaces(n);
  assert.equal(L.n, n);
  assert.equal(L.cells.length, n, `${n}: one cell per place`);
  assert.equal(new Set(L.cells.map(padOfCell)).size, n, `${n}: places on distinct cells, one pad each`);
  assert.ok(L.cells.every(inGrid) && L.route.every(inGrid), `${n}: inside the grid`);
  assert.equal(new Set(L.route.map(padOfCell)).size, L.route.length, `${n}: the route never crosses itself`);
  for (let i = 1; i < L.route.length; i++) {
    assert.equal(manhattan(L.route[i - 1], L.route[i]), 1, `${n}: route step ${i} is 4-connected`);
  }
  assert.ok(same(L.route[0], L.cells[0]), `${n}: the route starts at the first place`);
  assert.ok(same(L.route[L.route.length - 1], L.cells[n - 1]), `${n}: and ends at the last`);
  for (let i = 0; i < n; i++) {
    assert.ok(same(L.route[L.stops[i]], L.cells[i]), `${n}: stop ${i} is its place`);
    assert.equal(routeIndexOf(L, i), L.stops[i]);
    if (i) assert.ok(L.stops[i] > L.stops[i - 1], `${n}: places visited in order`);
  }
  for (let k = 0; k < MAX_PLACES; k++) {
    const i = L.placeAt[k];
    const cell = { col: k % COLS, row: Math.floor(k / COLS) };
    if (i >= 0) assert.ok(same(L.cells[i], cell));
    else assert.ok(!L.cells.some((c) => same(c, cell)));
  }
  return L;
}

test('every count from 1 to 32 lays out, places on distinct cells', () => {
  for (let n = 1; n <= MAX_PLACES; n++) assertWellFormed(n);
});

test('an empty map is empty; more places than pads is an error', () => {
  const L = layoutPlaces(0);
  assert.deepEqual([L.cells.length, L.route.length], [0, 0]);
  assert.throws(() => layoutPlaces(33), RangeError);
  assert.throws(() => layoutPlaces(-1), RangeError);
  assert.throws(() => layoutPlaces(2.5), RangeError);
  assert.throws(() => layoutPlaces('5'), RangeError);
});

test('layouts are deterministic and frozen', () => {
  for (let n = 1; n <= 12; n++) {
    const a = layoutPlaces(n);
    assert.equal(layoutPlaces(n), a, 'memoised: the same object, so render caches hold');
    assert.ok(Object.isFrozen(a) && Object.isFrozen(a.cells) && Object.isFrozen(a.route) && Object.isFrozen(a.cells[0]));
    assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(layoutPlaces(n))));
  }
});

test('the hand-drawn maps (1..9) keep water round every island', () => {
  for (let n = 1; n <= 9; n++) {
    const L = layoutPlaces(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        assert.ok(manhattan(L.cells[i], L.cells[j]) >= 2, `${n}: places ${i + 1} and ${j + 1} touch`);
      }
      /* A place's four sides are open water or its own two route cells. */
      const own = [L.route[L.stops[i] - 1], L.route[L.stops[i] + 1]].filter(Boolean);
      for (const r of L.route) {
        if (manhattan(r, L.cells[i]) === 1) {
          assert.ok(own.some((o) => same(o, r)), `${n}: place ${i + 1} touches someone else's route at ${r.col},${r.row}`);
        }
      }
    }
  }
});

test('the world maps start low on the left, and their hops are even', () => {
  const five = layoutPlaces(5);
  const seven = layoutPlaces(7);
  for (const L of [five, seven]) {
    assert.deepEqual(L.cells[0], { col: 0, row: ROWS - 1 }, 'island 1 sits over the bottom-left pad');
    const hops = L.stops.slice(1).map((s, i) => s - L.stops[i]);
    assert.ok(hops.every((h) => h >= 2 && h <= 3), `hops ${hops}`);
  }
  assert.deepEqual(five.stops, [0, 3, 6, 9, 12]);
  /* The span of the screen is used: from the left edge to the right one. */
  assert.deepEqual([Math.min(...five.cells.map((c) => c.col)), Math.max(...five.cells.map((c) => c.col))], [0, 7]);
  assert.deepEqual([Math.min(...seven.cells.map((c) => c.col)), Math.max(...seven.cells.map((c) => c.col))], [0, 7]);
});

test('past nine places the serpentine keeps a water cell between places up to 16', () => {
  for (let n = 10; n <= 16; n++) {
    const L = layoutPlaces(n);
    assert.equal(L.route.length, 2 * n - 1);
    assert.ok(L.stops.every((s, i) => s === 2 * i));
  }
  for (let n = 17; n <= 32; n++) {
    const L = layoutPlaces(n);
    assert.equal(L.route.length, n, `${n}: shoulder to shoulder`);
  }
  assert.deepEqual(layoutPlaces(32).route[8], { col: 7, row: 2 }, 'the serpentine turns up at the right edge');
});

test('pads and cells: the bottom row is pad row 0', () => {
  assert.equal(padOfCell({ col: 0, row: 3 }), 68);
  assert.equal(padOfCell({ col: 7, row: 3 }), 75);
  assert.equal(padOfCell({ col: 0, row: 0 }), 92);
  assert.equal(padOfCell({ col: 7, row: 0 }), 99);
  for (let note = 68; note <= 99; note++) {
    const c = cellOfPad(note);
    assert.equal(padOfCell(c), note);
    assert.equal(padOfCell(c), 68 + (3 - c.row) * 8 + c.col, 'the spec\'s formula');
  }
  assert.equal(cellOfPad(67), null);
  assert.equal(cellOfPad(100), null);
  assert.equal(cellOfPad(70.5), null);
});

test('placeOfPad finds the place above a pad, -1 over water', () => {
  const L = layoutPlaces(5);
  for (let i = 0; i < 5; i++) assert.equal(placeOfPad(L, padOfCell(L.cells[i])), i);
  const water = L.route.find((c) => L.placeAt[c.row * COLS + c.col] < 0);
  assert.equal(placeOfPad(L, padOfCell(water)), -1);
  assert.equal(placeOfPad(L, 12), -1);
});

test('cells tile the map area, y 10..53, exactly', () => {
  assert.deepEqual(cellRect({ col: 0, row: 0 }), { x: 0, y: MAP_Y, w: CELL_W, h: CELL_H });
  const last = cellRect({ col: 7, row: 3 });
  assert.equal(last.x + last.w, 128);
  assert.equal(last.y + last.h - 1, 53);
  assert.equal(MAP_Y + MAP_H - 1, 53);
  assert.deepEqual(cellCentre({ col: 1, row: 2 }), { x: 16 + 8, y: MAP_Y + 2 * CELL_H + 6 });
});

test('a mis-drawn map picture is refused, and says where', () => {
  const bad = {
    'has no place 1': ['........', '..2.....', '........', '........'],
    'has 0 ways out of place 1': ['........', '..1.....', '........', '..2.....'],
    'has 2 ways out of place 1': ['........', '.>1<....', '........', '........'],
    'runs aground at 3,1': ['........', '.1>.....', '........', '........'],
    'runs aground at 2,1': ['........', '.1>v....', '..^<....', '........'],
    'reaches place 3 out of order': ['........', '.1>3>2..', '........', '........'],
  };
  for (const [why, rows] of Object.entries(bad)) {
    assert.throws(() => parseMap(rows, 3), (e) => e.message.includes(why), why);
  }
  assert.deepEqual(parseMap(['........', '.1>2....', '........', '........'], 2).route.length, 3);
});
