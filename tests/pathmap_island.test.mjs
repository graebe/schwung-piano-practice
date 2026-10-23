// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * Island maps: one stage's places as buildings on one island -- their own
 * layouts, the island's coast, and the world maps left exactly as they were.
 * Imports only src/pathmap, so it runs unchanged in Drums Practice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  layoutPlaces, cellRect, cellCentre, padOfCell, ISLAND_GRID, COLS, ROWS, MAP_X, MAP_Y, MAP_W, MAP_H,
} from '../src/pathmap/layout.mjs';
import { drawMap, placeGlyph, COAST, GLYPH_W } from '../src/pathmap/render.mjs';
import { createWalk, walkTo, posAt } from '../src/pathmap/walk.mjs';
import { makePlace } from '../src/pathmap/model.mjs';

/* ---- A 128x64 1-bit screen ------------------------------------------------ */
function screen(fill = 0) {
  const px = new Uint8Array(128 * 64).fill(fill);
  return {
    px,
    calls: 0,
    fillRect(x, y, w, h, v) {
      this.calls++;
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) if (xx >= 0 && yy >= 0 && xx < 128 && yy < 64) px[yy * 128 + xx] = v ? 1 : 0;
      }
    },
    on(x, y) { return x >= 0 && y >= 0 && x < 128 && y < 64 && px[y * 128 + x] === 1; },
  };
}
const fnv = (px) => {
  let h = 0x811c9dc5;
  for (const b of px) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16);
};
const same = (a, b) => a.col === b.col && a.row === b.row;
const corner = (c) => (c.col === 0 || c.col === COLS - 1) && (c.row === 0 || c.row === ROWS - 1);
const STATES = ['done', 'current', 'started', 'fresh', 'skipped', 'ahead'];

const DRUMS = ['sign', 'bell', 'clock', 'workshop', 'stage', 'cove', 'fort'];
const PIANO = ['market', 'bell', 'stairs', 'library', 'temple', 'workshop', 'stage', 'fort'];
const NINE = ['sign', 'bell', 'clock', 'workshop', 'stage', 'library', 'temple', 'stairs', 'fort'];
const placesOf = (kinds, state) => kinds.map((kind, i) => makePlace({
  kind, state: state || STATES[i % 6], percent: (i * 29) % 101, due: i % 3 === 0 ? 1 : 0,
}));

/* ---- Layouts ---------------------------------------------------------------- */

test('island layouts: well formed, a loop of their own, never the world\'s cells', () => {
  for (let n = 1; n <= 9; n++) {
    const L = layoutPlaces(n, { kind: 'island' });
    const W = layoutPlaces(n);
    assert.equal(L.kind, 'island');
    assert.equal(W.kind, 'world');
    assert.notEqual(L, W);
    assert.equal(new Set(L.cells.map(padOfCell)).size, n, `${n}: every place its own pad`);
    assert.ok(!L.cells.every((c) => W.cells.some((w) => same(c, w))), `${n}: not the world's cells`);
    for (let i = 1; i < L.route.length; i++) {
      assert.equal(Math.abs(L.route[i].col - L.route[i - 1].col) + Math.abs(L.route[i].row - L.route[i - 1].row), 1);
    }
    for (let i = 0; i < n; i++) {
      assert.ok(same(L.route[L.stops[i]], L.cells[i]));
      if (i) assert.ok(L.stops[i] > L.stops[i - 1]);
    }
    assert.ok(!L.cells.some(corner) && !L.route.some(corner), `${n}: the corners stay sea`);
  }
});

test('the loop starts low on the left, climbs, crosses the top and comes down the right', () => {
  for (let n = 4; n <= 9; n++) {
    const L = layoutPlaces(n, { kind: 'island' });
    assert.deepEqual(L.cells[0], { col: 1, row: 3 }, `${n}: over the bottom-left pads`);
    assert.equal(L.cells[1].col, 0, `${n}: up the left side`);
    assert.ok(L.route.some((c) => c.row === 0), `${n}: along the top`);
    assert.ok(L.route.some((c) => c.col >= 6 && c.row >= 2), `${n}: down the right`);
  }
  /* From seven places on, the last -- the fort -- stands in the middle. */
  for (const n of [7, 8, 9]) {
    const c = layoutPlaces(n, { kind: 'island' }).cells[n - 1];
    assert.ok(c.col >= 2 && c.col <= 5 && c.row >= 1 && c.row <= 2, `${n}: ${c.col},${c.row}`);
  }
});

test('past nine places, and for unknown kinds', () => {
  assert.deepEqual(layoutPlaces(12, { kind: 'island' }).cells, layoutPlaces(12).cells, 'the same serpentine');
  assert.throws(() => layoutPlaces(5, { kind: 'moon' }), RangeError);
  assert.equal(layoutPlaces(5, { kind: 'island' }), layoutPlaces(5, { kind: 'island' }), 'memoised');
  assert.equal(layoutPlaces(5, {}), layoutPlaces(5));
});

test('island cells sit on a tighter grid inside the coast; their pads do not move', () => {
  assert.deepEqual(cellRect({ col: 0, row: 0 }, 'island'), { x: ISLAND_GRID.x, y: ISLAND_GRID.y, w: 15, h: 9 });
  assert.deepEqual(cellRect({ col: 2, row: 1 }), { x: 32, y: 21, w: 16, h: 11 }, 'the world grid unchanged');
  assert.deepEqual(cellCentre({ col: 7, row: 3 }, 'island'), { x: ISLAND_GRID.x + 7 * 15 + 12, y: ISLAND_GRID.y + 3 * 9 + 8 });
  const L = layoutPlaces(7, { kind: 'island' });
  const w = createWalk(L, 2);
  const p = posAt(w, 0);
  assert.deepEqual([p.x, p.y], [cellCentre(L.cells[2], 'island').x, cellCentre(L.cells[2], 'island').y], 'the walk follows the island grid');
});

/* ---- The island -------------------------------------------------------------- */

const land = (x, y) => {
  const { x0, y0, x1, y1, r } = COAST;
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= (r + 0.5) ** 2;
};

test('the coast runs round the map area, 2 px inside it, with rounded corners and sea outside', () => {
  assert.deepEqual([COAST.x0 - MAP_X, COAST.y0 - MAP_Y, MAP_X + MAP_W - 1 - COAST.x1, MAP_Y + MAP_H - 1 - COAST.y1], [2, 2, 2, 2]);
  const c = screen();
  drawMap(c, { places: [makePlace({ kind: 'sign' })], layout: layoutPlaces(1, { kind: 'island' }) });
  /* With one place in the middle the coast is whole: every edge of the land lit. */
  let edge = 0;
  for (let x = COAST.x0 + COAST.r; x <= COAST.x1 - COAST.r; x++) edge += c.on(x, COAST.y0) && c.on(x, COAST.y1) ? 1 : 0;
  assert.equal(edge, COAST.x1 - COAST.x0 - 2 * COAST.r + 1, 'top and bottom shores');
  for (let y = COAST.y0 + COAST.r; y <= COAST.y1 - COAST.r; y++) assert.ok(c.on(COAST.x0, y) && c.on(COAST.x1, y), `sides at ${y}`);
  /* Plain land inside, ripples in the sea round the corners. */
  let inland = 0;
  let sea = 0;
  for (let y = MAP_Y; y < MAP_Y + MAP_H; y++) {
    for (let x = MAP_X; x < MAP_X + MAP_W; x++) {
      if (!c.on(x, y)) continue;
      if (land(x - 3, y) && land(x + 3, y) && land(x, y - 3) && land(x, y + 3)) inland++;
      if (!land(x, y) && !land(x - 1, y) && !land(x + 1, y)) sea++;
    }
  }
  assert.ok(sea >= 12, `ripples at sea: ${sea}`);
  assert.ok(inland < 120, 'the land is plain: one building, no texture');
});

test('every building, flag and avatar stands inside the coast, on every island layout', () => {
  for (const kinds of [DRUMS, PIANO, NINE, ['market', 'fort'], ['sign', 'bell', 'stairs', 'cove', 'fort']]) {
    const L = layoutPlaces(kinds.length, { kind: 'island' });
    for (const state of ['done', 'current', 'fresh']) {
      const places = placesOf(kinds, state);
      for (let at = 0; at < kinds.length; at++) {
        const c = screen();
        drawMap(c, { places, layout: L, walk: createWalk(L, at), now: 0 });
        for (let i = 0; i < kinds.length; i++) {
          const r = cellRect(L.cells[i], 'island');
          for (let y = r.y; y < r.y + 9; y++) {
            for (let x = r.x; x < r.x + GLYPH_W; x++) {
              if (c.on(x, y)) assert.ok(land(x, y), `${kinds[i]} at ${x},${y} is off the island`);
            }
          }
        }
      }
    }
  }
});

test('round every building the screen shows the building alone: no coast, no path', () => {
  for (const kinds of [DRUMS, PIANO, NINE]) {
    const L = layoutPlaces(kinds.length, { kind: 'island' });
    const places = placesOf(kinds, 'done');
    const c = screen();
    drawMap(c, { places, layout: L, pulse: false });
    for (let i = 0; i < kinds.length; i++) {
      const r = cellRect(L.cells[i], 'island');
      const own = new Set();
      for (const [x, y, w, h] of placeGlyph(places[i], { island: true })) {
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) own.add((r.y + yy) * 128 + r.x + xx);
      }
      for (const k of own) {
        const x = k % 128;
        const y = Math.floor(k / 128);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const q = (y + dy) * 128 + x + dx;
            assert.equal(c.on(x + dx, y + dy), own.has(q), `${kinds[i]}: ${x + dx},${y + dy}`);
          }
        }
      }
    }
  }
});

test('a map draws only the map area, and within its call budget', () => {
  /*
   * THE BUDGET. The route is dotted 1 px in 2 on both maps (each dot one
   * call) and a skipped or ahead place draws its outline a pixel at a time,
   * so the worst frame -- nine places all dotted, the route dense, the
   * avatar walking -- measures 273 calls. The budget is that plus about 10%.
   * At ~490 ns per host call that is ~0.15 ms, far inside the 250 ms the
   * Move allows a slow frame; a map redraws only while something moves.
   * Past nine places (the serpentine, which no module shows) it is 360.
   */
  const BUDGET = 300;
  const BUDGET_SERPENTINE = 360;
  const ALL = ['sign', 'bell', 'clock', 'workshop', 'stage', 'library', 'temple', 'stairs', 'market', 'cove', 'fort'];
  for (const kind of ['world', 'island']) {
    for (let n = 2; n <= 12; n++) {
      let worst = 0;
      const L = layoutPlaces(n, { kind });
      for (const state of [...STATES, 'mixed']) {
        const places = Array.from({ length: n }, (_, i) => makePlace({
          kind: kind === 'island' ? ALL[i % ALL.length] : 'island',
          state: state === 'mixed' ? STATES[i % 6] : state, percent: 60, due: 1,
        }));
        const w = createWalk(L, 0);
        walkTo(w, n - 1, 0);
        for (const t of [0, 150, 99999]) {
          const c = screen(1);
          drawMap(c, { places, layout: L, walk: w, now: t });
          for (let x = 0; x < 128; x++) {
            for (const y of [0, 9, 54, 63]) assert.ok(c.on(x, y), 'title bar and hint line untouched');
          }
          worst = Math.max(worst, c.calls);
        }
      }
      assert.ok(worst < (n <= 9 ? BUDGET : BUDGET_SERPENTINE), `${kind} n=${n}: worst frame ${worst} calls`);
    }
  }
  /* The maps the modules show, in the states they mostly are, stay lean. */
  for (const kinds of [DRUMS, PIANO]) {
    const c = screen();
    drawMap(c, { places: placesOf(kinds), layout: layoutPlaces(kinds.length, { kind: 'island' }) });
    assert.ok(c.calls < 230, `${kinds.length} places: ${c.calls}`);
  }
  /* A celebration can leave the route out. */
  const L = layoutPlaces(8, { kind: 'island' });
  const a = screen();
  const b = screen();
  drawMap(a, { places: placesOf(PIANO, 'done'), layout: L });
  drawMap(b, { places: placesOf(PIANO, 'done'), layout: L, route: false });
  assert.ok(b.calls < a.calls - 20, 'no dots');
});

test('the kind follows the layout unless it is given', () => {
  const L = layoutPlaces(5, { kind: 'island' });
  const places = placesOf(['market', 'bell', 'stairs', 'library', 'fort']);
  const a = screen();
  const b = screen();
  drawMap(a, { places, layout: L });
  drawMap(b, { places, layout: L, kind: 'island' });
  assert.equal(fnv(a.px), fnv(b.px));
  const c = screen();
  drawMap(c, { places, layout: L, kind: 'world' });
  assert.notEqual(fnv(a.px), fnv(c.px), 'no coast on a world backdrop');
});

/* ---- The world, as it was ------------------------------------------------------ */

test('world maps are what they were, but for the route dots the island-path fix brought back', () => {
  /* Pixel hashes of the world maps. Recorded first from the engine before the
   * island work; re-recorded once (2026-10-23) when the route's keep-out
   * moved from every world shape at once to each place's own lit pixels.
   * That change was checked frame by frame against the old engine on 792
   * world frames: not one pixel went dark, and every pixel added is a route
   * dot (on the even diagonal, in the route's line). The map of 9 was also
   * redrawn so its places 2 and 3 are joined by a visible route; no module
   * shows nine islands. */
  const GOLDEN = { 5: ['fd775db2', '6833856b'], 7: ['a7b6d148', 'ed6eee28'], 8: ['2adbc17', 'c283e803'], 9: ['437d5d85', 'afa39568'] };
  for (const [n, kinds] of [[5, ['island']], [7, ['island']], [8, ['place', 'place', 'place', 'place', 'place', 'place', 'place', 'fort']], [9, ['island']]]) {
    const places = Array.from({ length: n }, (_, i) => makePlace({
      state: STATES[i % 6], percent: (i * 37) % 101, due: i % 3 === 0 ? 1 : 0, kind: kinds[i % kinds.length],
    }));
    const L = layoutPlaces(n);
    const w = createWalk(L, 1);
    const c = screen();
    drawMap(c, { places, layout: L, walk: w, now: 0 });
    const still = fnv(c.px);
    c.px.fill(0);
    walkTo(w, n - 1, 0);
    drawMap(c, { places, layout: L, walk: w, now: 150 });
    assert.deepEqual([still, fnv(c.px)], GOLDEN[n], `world map of ${n}`);
  }
});
