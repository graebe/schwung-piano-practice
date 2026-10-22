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
import { makePlace, fillLevel } from '../src/pathmap/model.mjs';
import {
  drawMap, glyphRows, placeGlyph, compile, rowsToRuns, runsToRects, drawWalker,
  BODIES, AVATAR_ROWS, AVATAR_W, AVATAR_H, STAND_X, GLYPH_W, GLYPH_H, GLYPH_DX,
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

/* What drawMap must have put in place i's 14x11 box. */
const groundOf = (kind) => BODIES[kind].filter((r) => /[ox]/.test(r)).length;
function expectedGlyph(p, { here = false, avatar = false } = {}) {
  const look = { skipped: 'dotted', ahead: 'sparse' }[p.state] || 'solid';
  const level = look === 'solid' ? fillLevel(p.percent, groundOf(p.kind)) : 0;
  return glyphRows(p.kind, look, level, { due: p.due > 0, here, flag: p.state === 'done', avatar });
}
/* Per row of a glyph: whether any ground is lit, and what its ground cells
 * ('o', and the chest's inverse 'x') look like. */
const groundLit = (kind, rows) => BODIES[kind].map((r, y) => [...r].some((ch, x) => ch === 'o' && rows[y][x] === '#'));
const groundCells = (kind, rows) => BODIES[kind].map((r, y) => [...r].map((ch, x) => (/[ox]/.test(ch) ? rows[y][x] : '')).join(''));
/* The figure's columns and rows, empty but for the figure. */
const slotOf = (rows) => rows.slice(0, AVATAR_H).map((r) => r.slice(STAND_X, STAND_X + AVATAR_W));
const glyphAt = (c, L, i) => {
  const r = cellRect(L.cells[i]);
  return c.rows(r.x + GLYPH_DX, r.y, GLYPH_W, GLYPH_H);
};
/* A place's box as drawn, against what it should be. The avatar's spot is
 * open sky a route may cross unless the figure or the marker is in it. */
function assertGlyph(c, L, i, want, slotToo, msg) {
  const got = glyphAt(c, L, i);
  const mask = (rows) => rows.map((r, y) => (slotToo || y >= AVATAR_H ? r : r.slice(0, STAND_X) + '?'.repeat(AVATAR_W)));
  assert.deepEqual(mask(got), mask(want), msg);
}

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
    assert.ok(rects <= 14, `${kind}: ${rects} rects`);
  }
});

test('glyphs are cached per look: drawing again builds nothing new', () => {
  const p = place('started', 40);
  assert.equal(placeGlyph(p), placeGlyph(makePlace({ ...p, label: 'other' })));
  assert.notEqual(placeGlyph(p), placeGlyph(p, { avatar: true }));
});

/* ---- What each state looks like ------------------------------------------ */

test('the ground fills from the bottom with the percentage', () => {
  const at = (percent) => groundLit('island', glyphRows('island', 'solid', fillLevel(percent, groundOf('island'))));
  assert.deepEqual(at(0).slice(5, 10), [false, false, false, false, false]);
  assert.deepEqual(at(20).slice(5, 10), [false, false, false, false, true], 'the bottom row of ground');
  assert.deepEqual(at(40).slice(5, 10), [false, false, false, true, true]);
  assert.deepEqual(at(60).slice(5, 10), [false, false, true, true, true]);
  assert.deepEqual(at(100).slice(5, 10), [true, true, true, true, true]);
});

test('0, 20, 40, 60 and 100% stay apart with the avatar and the flag on top', () => {
  for (const kind of Object.keys(BODIES)) {
    const looks = [0, 20, 40, 60, 100].map((pc) => {
      const rows = glyphRows(kind, 'solid', fillLevel(pc, groundOf(kind)), { flag: true, avatar: true, due: true });
      return groundCells(kind, rows).join();
    });
    assert.equal(new Set(looks).size, 5, kind);
    /* And they are the same ground as with nothing on top. */
    for (const pc of [0, 40, 100]) {
      const level = fillLevel(pc, groundOf(kind));
      assert.deepEqual(groundCells(kind, glyphRows(kind, 'solid', level, { flag: true, avatar: true, due: true })),
        groundCells(kind, glyphRows(kind, 'solid', level)), `${kind} ${pc}%: nothing covers the ground`);
    }
  }
});

test('done flies a flag: a pole of 5-6 px on the body, a pennant at its top', () => {
  for (const kind of Object.keys(BODIES)) {
    const plain = glyphRows(kind, 'solid', 0);
    const flag = glyphRows(kind, 'solid', 0, { flag: true });
    const added = [];
    flag.forEach((r, y) => [...r].forEach((ch, x) => ch !== plain[y][x] && added.push([x, y])));
    const pole = added.filter(([x]) => x === 1);
    assert.ok(pole.length >= 5 && pole.length <= 6, `${kind}: pole ${pole.length} px`);
    assert.notEqual(BODIES[kind][pole.length][1], '.', `${kind}: the pole stands on the body`);
    assert.deepEqual(flag.slice(0, 2).map((r) => r.slice(1, 5)), ['####', '####'], `${kind}: pennant to the right at the top`);
    assert.ok(added.every(([x]) => x < STAND_X - 1), `${kind}: clear of the avatar's spot`);
  }
});

test('due shows a 2x2 dot; the current place a down-arrow in the avatar\'s spot', () => {
  const plain = glyphRows('place', 'solid', 0);
  const due = glyphRows('place', 'solid', 0, { due: true });
  assert.deepEqual(due.slice(1, 3).map((r) => r.slice(6, 8)), ['##', '##']);
  assert.equal(lit(due) - lit(plain), 4);
  const here = glyphRows('place', 'solid', 0, { here: true });
  assert.deepEqual(slotOf(here).slice(2, 4), ['.###.', '..#..'], 'a small down-arrow');
  assert.equal(lit(here) - lit(plain), 4);
  /* The avatar standing there replaces the arrow. */
  assert.deepEqual(glyphRows('place', 'solid', 0, { here: true, avatar: true }), glyphRows('place', 'solid', 0, { avatar: true }));
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

test('island, place, fort, hut and chest are five different shapes', () => {
  const kinds = Object.keys(BODIES);
  assert.deepEqual(kinds, ['island', 'place', 'fort', 'hut', 'cove']);
  for (const look of ['solid', 'sparse']) {
    const shapes = kinds.map((k) => glyphRows(k, look, look === 'solid' ? 5 : 0).join('|'));
    assert.equal(new Set(shapes).size, kinds.length, look);
  }
  const fort = glyphRows('fort', 'solid', 4);
  assert.equal(fort[5].slice(0, 9), '#.#.#.#.#', 'battlements');
  assert.equal(fort[GLYPH_H - 1][4], '.', 'a gate that stays open');
  const hut = glyphRows('hut', 'solid', 5);
  assert.equal(hut[3].replace(/\./g, ''), '#', 'a roof peak');
  assert.deepEqual([hut[GLYPH_H - 2][4], hut[GLYPH_H - 1][4]], ['.', '.'], 'a door');
  assert.equal(glyphRows('volcano', 'solid', 0).join(), glyphRows('place', 'solid', 0).join(), 'unknown kinds draw as a place');
});

test('the cove is a treasure chest whose lock shows empty and full', () => {
  const empty = glyphRows('cove', 'solid', 0);
  const full = glyphRows('cove', 'solid', 5);
  assert.equal(empty[4].slice(0, 9), '..#####..', 'a domed lid');
  assert.equal(empty[7].slice(0, 9), '#########', 'a band, with the lock lit on an empty chest');
  assert.equal(full[7].slice(0, 9), '###...###', 'and dark on a full one');
  assert.equal(empty[8][4], '#');
  assert.equal(full[8][4], '.');
});

test('the avatar is a figure standing on top: head, arms, legs, feet on the ground', () => {
  const fig = AVATAR_ROWS.stand;
  assert.deepEqual([fig.length, fig[0].length], [AVATAR_H, AVATAR_W]);
  assert.ok(AVATAR_H >= 7, 'tall enough for head, body and legs');
  assert.equal(fig[3], '#####', 'arms');
  assert.notEqual(AVATAR_ROWS.walkA.slice(5).join(), AVATAR_ROWS.walkB.slice(5).join(), 'the legs alternate');
  assert.deepEqual(AVATAR_ROWS.walkA.slice(0, 5), AVATAR_ROWS.walkB.slice(0, 5), 'only the legs move');
  for (const kind of Object.keys(BODIES)) {
    for (const look of ['solid', 'dotted', 'sparse']) {
      for (const level of [0, 3, 5]) {
        const plain = glyphRows(kind, look, level, { flag: true, due: true });
        const with_ = glyphRows(kind, look, level, { flag: true, due: true, avatar: true });
        assert.deepEqual(slotOf(plain), Array(AVATAR_H).fill('.....'), `${kind}: the spot is open sky`);
        assert.deepEqual(slotOf(with_), fig, `${kind} ${look} ${level}: the whole figure, untouched`);
        assert.deepEqual(with_.slice(AVATAR_H), plain.slice(AVATAR_H), `${kind}: nothing below it changes`);
      }
      /* Feet on the ground: the row under the figure is the spit's coast. */
      assert.equal(BODIES[kind][AVATAR_H].slice(STAND_X, STAND_X + AVATAR_W), '#####', `${kind}: a spit to stand on`);
    }
  }
});

test('the walker clears its tile and stands its feet on the anchor', () => {
  const c = screen(1);
  drawWalker(c, 40, 30, 0);
  const tile = c.rows(40 - 3, 30 - AVATAR_H, AVATAR_W + 2, AVATAR_H);
  assert.ok(tile.every((r) => r[0] === '.' && r[AVATAR_W + 1] === '.'), 'a clear halo either side');
  assert.deepEqual(tile.map((r) => r.slice(1, 1 + AVATAR_W)), AVATAR_ROWS.walkA);
  assert.ok(c.on(40, 30), 'the ground under it is left alone');
  drawWalker(c, 40, 30, 1);
  assert.deepEqual(c.rows(38, 30 - AVATAR_H, AVATAR_W, AVATAR_H), AVATAR_ROWS.walkB, 'the other stride');
});

/* ---- Whole maps ------------------------------------------------------------ */

for (const [name, places] of Object.entries(MAPS)) {
  test(`${name}: every place drawn at its cell, the avatar standing on the current one`, () => {
    const L = layoutPlaces(places.length);
    const cur = places.findIndex((p) => p.state === 'current');
    const c = screen();
    drawMap(c, { places, layout: L, walk: createWalk(L, cur), now: 0 });
    for (let i = 0; i < places.length; i++) {
      assertGlyph(c, L, i, expectedGlyph(places[i], { here: i === cur, avatar: i === cur }), i === cur, `place ${i}`);
    }
    const r = cellRect(L.cells[cur]);
    assert.deepEqual(c.rows(r.x + GLYPH_DX + STAND_X, r.y, AVATAR_W, AVATAR_H), AVATAR_ROWS.stand, 'the figure, clean');
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
  assertGlyph(on, L, cur, expectedGlyph(MAPS.pianoWorld[cur], { here: true }), true);
  assertGlyph(off, L, cur, expectedGlyph(MAPS.pianoWorld[cur]), false);
  assert.deepEqual(slotOf(glyphAt(on, L, cur)).slice(2, 4), ['.###.', '..#..']);
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
    assert.deepEqual(c.rows(p.x - 2, p.y - AVATAR_H, AVATAR_W, AVATAR_H), stride, `figure at ${t} ms`);
    assert.equal(c.count(p.x - 3, p.y - AVATAR_H, 1, AVATAR_H) + c.count(p.x + 3, p.y - AVATAR_H, 1, AVATAR_H), 0, 'a clear halo');
    /* The place it set out from shows no figure once the walker has left it
     * (stepping off, the walker's tile still overlaps the coast). */
    if (t >= 135) assertGlyph(c, L, 0, expectedGlyph(places[0]), true);
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
