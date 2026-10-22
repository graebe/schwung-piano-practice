// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * The Path map on the 1-bit screen, asserted on pixels. Imports only
 * src/pathmap -- the 128x64 buffer below is this file's own, a cut-down
 * tools/screen_buffer.mjs -- so it runs unchanged in Drums Practice.
 *
 * `npm run preview -- --view map --places 5|7|8` (or --map drums) shows the
 * same maps as ASCII art when a failure here needs looking at.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { layoutPlaces, cellRect, cellCentre, MAP_Y, MAP_H, COLS } from '../src/pathmap/layout.mjs';
import { createWalk, walkTo, posAt, walkDuration } from '../src/pathmap/walk.mjs';
import { makePlace } from '../src/pathmap/model.mjs';
import {
  drawMap, glyphRows, placeGlyph, compile, rowsToRuns, runsToRects, drawWalker,
  BODIES, AVATAR_ROWS, GLYPH_W, GLYPH_H, GLYPH_DX, SKY_H, AVATAR_TILE,
} from '../src/pathmap/render.mjs';

/* ---- A 128x64 1-bit screen that counts the calls made to it ------------- */
const W = 128;
const H = 64;
function screen(fill = 0) {
  const px = new Uint8Array(W * H).fill(fill);
  const set = (x, y, v) => {
    if (x >= 0 && y >= 0 && x < W && y < H) px[y * W + x] = v ? 1 : 0;
  };
  return {
    px,
    calls: 0,
    fillRect(x, y, w, h, v) {
      this.calls++;
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) set(x + xx, y + yy, v);
    },
    drawRect() { this.calls++; },
    line() { this.calls++; },
    text() { this.calls++; },
    textWidth(s) { return s.length * 6 - 1; },
    on(x, y) { return x >= 0 && y >= 0 && x < W && y < H && px[y * W + x] === 1; },
    count(x, y, w, h) {
      let n = 0;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (this.on(xx, yy)) n++;
      return n;
    },
    /* A region as ASCII rows, to compare with glyphRows. */
    rows(x, y, w, h) {
      const out = [];
      for (let yy = y; yy < y + h; yy++) {
        let r = '';
        for (let xx = x; xx < x + w; xx++) r += this.on(xx, yy) ? '#' : '.';
        out.push(r);
      }
      return out;
    },
  };
}

const lit = (rows) => rows.join('').split('').filter((c) => c === '#').length;
const place = (state, percent = 0, kind = 'island', due = 0) => makePlace({ label: kind, state, percent, kind, due });

/* What drawMap must have put in place i's 11x10 box. */
function expectedGlyph(p, { here = false, avatar = false } = {}) {
  const look = { skipped: 'dotted', ahead: 'sparse' }[p.state] || 'solid';
  const ground = BODIES[p.kind].filter((r) => r.includes('o')).length;
  const level = look === 'solid' ? (p.percent >= 100 ? ground : p.percent <= 0 ? 0 : Math.min(ground - 1, Math.max(1, Math.round(p.percent / 100 * ground)))) : 0;
  return glyphRows(p.kind, look, level, { due: p.due > 0, here, flag: p.state === 'done', avatar });
}
const glyphAt = (c, L, i) => {
  const r = cellRect(L.cells[i]);
  return c.rows(r.x + GLYPH_DX, r.y, GLYPH_W, GLYPH_H);
};

/* The four maps the spec asks to see. */
const MAPS = {
  pianoWorld: [place('skipped', 100), place('done', 100, 'island', 2), place('current', 40), place('fresh'), place('ahead')],
  drumsWorld: [place('done', 100), place('done', 100, 'island', 1), place('current', 64), place('started', 20),
    place('skipped'), place('ahead'), place('ahead')],
  pianoIsland: [place('done', 100, 'place', 1), place('done', 100, 'place'), place('started', 60, 'place'),
    place('current', 40, 'place'), place('skipped', 0, 'place'), place('ahead', 0, 'place'), place('ahead', 0, 'place'),
    place('fresh', 0, 'fort')],
  drumsIsland: [place('done', 100, 'hut'), place('done', 100, 'place', 2), place('current', 50, 'place'),
    place('started', 20, 'place'), place('fresh', 0, 'place'), place('ahead', 0, 'cove'), place('fresh', 0, 'fort')],
};

/* ---- Compiling glyphs ---------------------------------------------------- */

test('rows compile to rectangles that cover exactly the lit pixels', () => {
  const all = [...Object.values(BODIES), ...Object.values(AVATAR_ROWS),
    glyphRows('island', 'dotted', 0, { due: true }), glyphRows('fort', 'solid', 3, { flag: true, avatar: true })];
  for (const rows of all) {
    const c = screen();
    for (const [x, y, w, h] of compile(rows)) c.fillRect(x, y, w, h, 1);
    assert.deepEqual(c.rows(0, 0, rows[0].length, rows.length), rows.map((r) => r.replace(/[^#]/g, '.')));
  }
});

test('straight sides merge: an outline is a handful of calls, not a row each', () => {
  const runs = rowsToRuns(['#..#', '#..#', '#..#', '####']);
  assert.equal(runs.length, 7);
  assert.deepEqual(runsToRects(runs), [[0, 0, 1, 3], [3, 0, 1, 3], [0, 3, 4, 1]]);
  for (const kind of Object.keys(BODIES)) {
    const rects = compile(glyphRows(kind, 'solid', 0)).length;
    assert.ok(rects <= 12, `${kind}: ${rects} rects`);
  }
});

test('glyphs are cached per look: drawing again builds nothing new', () => {
  const p = place('started', 40);
  assert.equal(placeGlyph(p), placeGlyph(makePlace({ ...p, label: 'other' })));
  assert.notEqual(placeGlyph(p), placeGlyph(p, { avatar: true }));
});

/* ---- What each state looks like ------------------------------------------ */

test('the ground fills from the bottom with the percentage', () => {
  const rowsLit = (percent) => {
    const g = glyphRows('island', 'solid', Math.round(percent / 20));
    const body = BODIES.island;
    return body.map((r, by) => [...r].some((ch, x) => ch === 'o' && g[by + SKY_H][x] === '#'));
  };
  assert.deepEqual(rowsLit(0), [false, false, false, false, false, false, false]);
  assert.deepEqual(rowsLit(40), [false, false, false, false, true, true, false], 'bottom two rows of ground');
  assert.deepEqual(rowsLit(100), [false, true, true, true, true, true, false]);
});

test('done flies a flag; due shows a dot top-right; the current place a marker', () => {
  const sky = (opts) => glyphRows('place', 'solid', 0, opts).slice(0, SKY_H);
  assert.equal(lit(sky({})), 0, 'a plain place has an empty sky');
  const flag = sky({ flag: true });
  assert.ok(flag.every((r) => r[5] === '#'), 'the pole');
  assert.ok(lit(flag) >= 5);
  const due = sky({ due: true });
  assert.deepEqual(due.map((r) => r.slice(9)), ['##', '##', '..']);
  assert.equal(lit(due), 4);
  const here = sky({ here: true });
  assert.ok(lit(here) > 0 && here[0][5] === '#' && here[1][5] === '#');
  assert.notDeepEqual(here, flag);
});

test('skipped is dotted and hatched; ahead is dimmer still', () => {
  for (const kind of Object.keys(BODIES)) {
    const solid = lit(glyphRows(kind, 'solid', 0));
    const dotted = glyphRows(kind, 'dotted', 0);
    const sparse = glyphRows(kind, 'sparse', 0);
    assert.ok(lit(sparse) < solid * 0.7, `${kind}: ahead is fainter than fresh`);
    assert.ok(lit(dotted) > lit(sparse), `${kind}: skipped carries a hatch ahead lacks`);
    /* Dotted: no two outline pixels side by side. */
    for (const r of sparse) assert.ok(!r.includes('##'), `${kind}: ${r}`);
  }
  assert.equal(lit(glyphRows('island', 'sparse', 0)), lit(glyphRows('island', 'sparse', 5)), 'ahead shows no ground');
});

test('island, place, fort, hut and cove are five different shapes', () => {
  const kinds = Object.keys(BODIES);
  assert.deepEqual(kinds, ['island', 'place', 'fort', 'hut', 'cove']);
  for (const look of ['solid', 'sparse']) {
    const shapes = kinds.map((k) => glyphRows(k, look, look === 'solid' ? 5 : 0).join('|'));
    assert.equal(new Set(shapes).size, kinds.length, look);
  }
  const fort = glyphRows('fort', 'solid', 5);
  assert.equal(fort[SKY_H], '#.#.#.#.#.#', 'battlements');
  assert.equal(fort[GLYPH_H - 1][5], '.', 'a gate that stays open');
  const hut = glyphRows('hut', 'solid', 5);
  assert.equal(hut[SKY_H].replace(/\./g, ''), '#', 'a roof peak');
  assert.equal(hut[GLYPH_H - 1][5], '.', 'a door');
  const cove = glyphRows('cove', 'solid', 5);
  assert.equal(cove[SKY_H + 3].slice(7), '....', 'a bay opening east');
  assert.equal(glyphRows('volcano', 'solid', 0).join(), glyphRows('place', 'solid', 0).join(), 'unknown kinds draw as a place');
});

test('standing, the avatar is the place inverted under its figure', () => {
  for (const kind of Object.keys(BODIES)) {
    for (const level of [0, 2, 5]) {
      const plain = glyphRows(kind, 'solid', level);
      const with_ = glyphRows(kind, 'solid', level, { avatar: true });
      const flipped = [];
      for (let y = 0; y < GLYPH_H; y++) {
        for (let x = 0; x < GLYPH_W; x++) if (plain[y][x] !== with_[y][x]) flipped.push(`${x},${y}`);
      }
      const figure = [];
      AVATAR_ROWS.stand.forEach((r, y) => [...r].forEach((ch, x) => ch === '#' && figure.push(`${x + 3},${y + SKY_H + 1}`)));
      assert.deepEqual(flipped, figure, `${kind} at level ${level}`);
    }
  }
});

test('the walker clears its tile and draws the figure on it', () => {
  const c = screen(1);
  drawWalker(c, 40, 30, 0);
  const tile = c.rows(40 - 3, 30 - 3, AVATAR_TILE, AVATAR_TILE);
  assert.equal(tile[0], '.......');
  assert.equal(tile[6], '.......');
  assert.deepEqual(tile.slice(1, 6).map((r) => r.slice(1, 6)), AVATAR_ROWS.walkA);
  drawWalker(c, 40, 30, 1);
  assert.deepEqual(c.rows(38, 28, 5, 5), AVATAR_ROWS.walkB, 'the other stride');
});

/* ---- Whole maps ------------------------------------------------------------ */

for (const [name, places] of Object.entries(MAPS)) {
  test(`${name}: every place drawn at its cell, the avatar standing on the current one`, () => {
    const L = layoutPlaces(places.length);
    const cur = places.findIndex((p) => p.state === 'current');
    const c = screen();
    drawMap(c, { places, layout: L, walk: createWalk(L, cur), now: 0 });
    for (let i = 0; i < places.length; i++) {
      assert.deepEqual(glyphAt(c, L, i), expectedGlyph(places[i], { here: i === cur, avatar: i === cur }), `place ${i}`);
    }
  });
}

test('the route is dotted, 1 px every 2, between the places', () => {
  const L = layoutPlaces(5);
  const c = screen();
  drawMap(c, { places: MAPS.pianoWorld, layout: L, now: 0 });
  /* Every water cell on the route carries dots along its centre line. */
  for (const cell of L.route) {
    if (L.placeAt[cell.row * COLS + cell.col] >= 0) continue;
    const r = cellRect(cell);
    const { x, y } = cellCentre(cell);
    const across = c.rows(r.x, y, r.w, 1)[0];
    const down = c.rows(x, r.y, 1, r.h).join('');
    assert.ok(across.includes('#.#') || down.includes('#.#'), `dots in ${cell.col},${cell.row}`);
    assert.ok(!across.includes('##') && !down.includes('##'), `dotted, not solid, in ${cell.col},${cell.row}`);
  }
  /* And it stops short of every island: a pixel of water round each. */
  for (const cell of L.cells) {
    const r = cellRect(cell);
    const { y } = cellCentre(cell);
    assert.ok(!c.on(r.x + GLYPH_DX - 1, y) && !c.on(r.x + GLYPH_DX + GLYPH_W, y));
  }
});

test('the world map ripples; an island map is plain land', () => {
  const sea = layoutPlaces(7);
  const openWater = (c, L) => {
    let n = 0;
    for (let k = 0; k < 32; k++) {
      const cell = { col: k % COLS, row: Math.floor(k / COLS) };
      if (L.route.some((r) => r.col === cell.col && r.row === cell.row)) continue;
      const r = cellRect(cell);
      n += c.count(r.x, r.y, r.w, r.h);
    }
    return n;
  };
  const world = screen();
  drawMap(world, { places: MAPS.drumsWorld, layout: sea, now: 0 });
  assert.ok(openWater(world, sea) > 20, 'waves in the open sea');
  const island = screen();
  drawMap(island, { places: MAPS.drumsIsland, layout: sea, now: 0 });
  assert.equal(openWater(island, sea), 0);
});

test('drawMap touches nothing outside y 10..53', () => {
  for (const places of Object.values(MAPS)) {
    const L = layoutPlaces(places.length);
    const w = createWalk(L, 0);
    walkTo(w, places.length - 1, 0);
    for (const now of [0, 45, 300, 1e6]) {
      const c = screen(1);
      drawMap(c, { places, layout: L, walk: w, now });
      assert.equal(c.count(0, 0, W, MAP_Y), W * MAP_Y, 'title bar untouched');
      assert.equal(c.count(0, MAP_Y + MAP_H, W, H - MAP_Y - MAP_H), W * (H - MAP_Y - MAP_H), 'footer untouched');
    }
  }
});

test('the pulse blinks the current marker; no walk, no avatar', () => {
  const L = layoutPlaces(5);
  const cur = 2;
  const on = screen();
  drawMap(on, { places: MAPS.pianoWorld, layout: L, now: 0 });
  const off = screen();
  drawMap(off, { places: MAPS.pianoWorld, layout: L, now: 0, pulse: false });
  assert.deepEqual(glyphAt(on, L, cur), expectedGlyph(MAPS.pianoWorld[cur], { here: true }));
  assert.deepEqual(glyphAt(off, L, cur), expectedGlyph(MAPS.pianoWorld[cur]));
});

test('walking, the avatar is drawn between cells at its position', () => {
  const places = MAPS.drumsWorld;
  const L = layoutPlaces(7);
  const w = createWalk(L, 0);
  walkTo(w, 6, 0);
  for (const t of [45, 135, 500, walkDuration(L.stops[6]) - 60]) {
    const c = screen();
    drawMap(c, { places, layout: L, walk: w, now: t });
    const p = posAt(w, t);
    assert.ok(p.moving);
    const stride = Math.floor(p.s * 2) % 2 ? AVATAR_ROWS.walkB : AVATAR_ROWS.walkA;
    assert.deepEqual(c.rows(p.x - 2, p.y - 2, 5, 5), stride, `figure at ${t} ms`);
    assert.equal(c.count(p.x - 3, p.y - 3, 7, 1) + c.count(p.x - 3, p.y + 3, 7, 1), 0, 'a clear halo');
    /* The place it set out from shows no figure once the walker has left it
     * (stepping off, the walker's tile still overlaps the coast). */
    if (t >= 135) assert.deepEqual(glyphAt(c, L, 0), expectedGlyph(places[0]));
  }
});

test('a frame is cheap: under 200 ctx calls for 7 islands, nearly all fillRect', () => {
  const L = layoutPlaces(7);
  const w = createWalk(L, 2);
  for (const [name, places] of [['drumsWorld', MAPS.drumsWorld], ['drumsIsland', MAPS.drumsIsland]]) {
    const c = screen();
    drawMap(c, { places, layout: L, walk: w, now: 0 });
    assert.ok(c.calls < 200, `${name}: ${c.calls} calls`);
  }
  /* The worst case: every place skipped, so every coast is dots, mid-walk. */
  const skipped = Array.from({ length: 9 }, () => place('skipped', 0, 'island', 1));
  const L9 = layoutPlaces(9);
  const w9 = createWalk(L9, 0);
  walkTo(w9, 8, 0);
  const c = screen();
  drawMap(c, { places: skipped, layout: L9, walk: w9, now: 300 });
  assert.ok(c.calls < 450, `9 skipped islands: ${c.calls} calls`);
});
