// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * The Path's animations: lengths, determinism, where they may draw, what
 * they show at their ends, and what a frame costs. Imports only src/pathmap,
 * so it runs unchanged in Drums Practice.
 *
 * `npm run preview -- --view anim --name flag|fireworks|zoomIn|zoomOut|star|finale`
 * films each one at 0/25/50/75/100%.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ANIMS, FLAG_MS, FIREWORKS_MS, ZOOM_MS, STAR_MS, FINALE_MS, SWEEP_MS,
  flagRise, fireworks, zoomIn, zoomOut, starBurst, finale, sweepColors, sparkleColors, rng,
} from '../src/pathmap/anim.mjs';
import { layoutPlaces, cellRect, MAP_X, MAP_Y, MAP_W, MAP_H } from '../src/pathmap/layout.mjs';
import { drawMap, placeGlyph, GLYPH_W, GLYPH_H } from '../src/pathmap/render.mjs';
import { makePlace } from '../src/pathmap/model.mjs';

/* ---- A 128x64 1-bit screen that counts calls and records where it drew --- */
function screen(fill = 0) {
  const px = new Uint8Array(128 * 64).fill(fill);
  const touched = new Uint8Array(128 * 64);
  const set = (x, y, v) => {
    if (x >= 0 && y >= 0 && x < 128 && y < 64) {
      px[y * 128 + x] = v ? 1 : 0;
      touched[y * 128 + x] = 1;
    } else {
      touched.off = true;
    }
  };
  return {
    px,
    touched,
    calls: 0,
    fillRect(x, y, w, h, v) {
      this.calls++;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) set(xx, yy, v);
    },
    line(x0, y0, x1, y1, v) {
      this.calls++;
      const dx = Math.abs(x1 - x0);
      const dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        set(x0, y0, v);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    },
    text() { this.calls++; },
    textWidth(s) { return s.length * 6 - 1; },
    on(x, y) { return x >= 0 && y >= 0 && x < 128 && y < 64 && px[y * 128 + x] === 1; },
    count() { return px.reduce((a, b) => a + b, 0); },
    key() { return Buffer.from(px).toString('base64'); },
    /* Whether anything was drawn outside the box [x0, y0, x1, y1). */
    outside(x0, y0, x1, y1) {
      if (touched.off) return true;
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 128; x++) if (touched[y * 128 + x] && (x < x0 || x >= x1 || y < y0 || y >= y1)) return true;
      }
      return false;
    },
  };
}

const ISLE = ['sign', 'bell', 'clock', 'workshop', 'stage', 'cove', 'fort'];
const islePlaces = (state = 'done') => ISLE.map((kind) => makePlace({ kind, state, percent: 100 }));
const IL = layoutPlaces(7, { kind: 'island' });
const WL = layoutPlaces(7);
const worldPlaces = () => Array.from({ length: 7 }, () => makePlace({ kind: 'island', state: 'done', percent: 100 }));

/* Every animation with arguments that exercise it. */
const CASES = {
  flag: (t, c) => flagRise(c, { layout: IL, index: 1, place: islePlaces()[1] }, t),
  fireworks: (t, c) => fireworks(c, { x: 64, y: 24, seed: 3 }, t),
  zoomIn: (t, c) => zoomIn(c, { cell: WL.cells[6], place: worldPlaces()[6] }, t),
  zoomOut: (t, c) => zoomOut(c, { cell: WL.cells[0], place: worldPlaces()[0] }, t),
  star: (t, c) => starBurst(c, { x: 64, y: 31, r: 11, seed: 2 }, t),
  finale: (t, c) => finale(c, { layout: WL, places: worldPlaces(), seed: 4 }, t),
};

test('every animation has its length, and the registry names them all', () => {
  assert.deepEqual([FLAG_MS, FIREWORKS_MS, ZOOM_MS, STAR_MS, FINALE_MS], [400, 900, 350, 600, 2500]);
  assert.deepEqual(Object.keys(ANIMS), ['flag', 'fireworks', 'zoomIn', 'zoomOut', 'star', 'finale']);
  assert.deepEqual(Object.values(ANIMS).map((a) => a.ms), [400, 900, 350, 350, 600, 2500]);
  for (const a of Object.values(ANIMS)) assert.equal(typeof a.draw, 'function');
  assert.ok(Object.isFrozen(ANIMS));
});

test('the same seed and moment draw the same frame; time is clamped to the length', () => {
  for (const [name, run] of Object.entries(CASES)) {
    const ms = ANIMS[name].ms;
    for (const t of [0, ms / 4, ms / 2, (3 * ms) / 4, ms]) {
      const a = screen();
      const b = screen();
      run(t, a);
      run(t, b);
      assert.equal(a.key(), b.key(), `${name} at ${t}`);
    }
    for (const [early, clamped] of [[-50, 0], [ms + 500, ms]]) {
      const a = screen();
      const b = screen();
      run(early, a);
      run(clamped, b);
      if (name !== 'fireworks' && name !== 'star') assert.equal(a.key(), b.key(), `${name}: ${early} is ${clamped}`);
    }
  }
  /* A different seed scatters the fireworks elsewhere. */
  const a = screen();
  const b = screen();
  fireworks(a, { x: 64, y: 30, seed: 1 }, 300);
  fireworks(b, { x: 64, y: 30, seed: 9 }, 300);
  assert.notEqual(a.key(), b.key());
  assert.deepEqual([rng(5)(), rng(5)()], [rng(5)(), rng(5)()]);
  assert.ok(rng(0)() >= 0 && rng(0)() < 1);
});

test('they draw where they may: the map area, or (the star) the screen', () => {
  for (const [name, run] of Object.entries(CASES)) {
    const ms = ANIMS[name].ms;
    for (let t = 0; t <= ms; t += ms / 20) {
      const c = screen();
      run(t, c);
      if (name === 'star') assert.ok(!c.outside(0, 0, 128, 64), `${name} at ${t}`);
      else assert.ok(!c.outside(MAP_X, MAP_Y, MAP_X + MAP_W, MAP_Y + MAP_H), `${name} at ${t} leaves the map area`);
    }
  }
  /* Fireworks round a point at the very edge stay inside. */
  for (const [x, y] of [[0, 10], [127, 53], [0, 53], [127, 10]]) {
    for (let t = 0; t <= FIREWORKS_MS; t += 30) {
      const c = screen();
      fireworks(c, { x, y, seed: 7 }, t);
      assert.ok(!c.outside(MAP_X, MAP_Y, MAP_X + MAP_W, MAP_Y + MAP_H), `${x},${y} at ${t}`);
    }
  }
});

test('a frame stays under 200 ctx calls, with the map it plays over', () => {
  let worst = 0;
  const place = (kind, state) => makePlace({ kind, state, percent: 60, due: 1 });
  for (const [name, run] of Object.entries(CASES)) {
    const ms = ANIMS[name].ms;
    for (let t = 0; t <= ms; t += 10) {
      const c = screen();
      if (name === 'flag') drawMap(c, { places: ISLE.map((k, i) => place(k, i === 1 ? 'started' : 'skipped')), layout: IL });
      if (name === 'fireworks') drawMap(c, { places: ISLE.map((k) => place(k, 'skipped')), layout: IL, route: false });
      run(t, c);
      worst = Math.max(worst, c.calls);
    }
  }
  assert.ok(worst < 200, `worst frame: ${worst}`);
});

test('the flag climbs from the roof and ends where a done place flies it', () => {
  const layout = IL;
  const p = islePlaces()[1];
  const r = cellRect(layout.cells[1], 'island');
  const box = (c) => {
    const rows = [];
    for (let y = r.y; y < r.y + GLYPH_H; y++) {
      let s = '';
      for (let x = r.x; x < r.x + GLYPH_W; x++) s += c.on(x, y) ? '#' : '.';
      rows.push(s);
    }
    return rows;
  };
  const glyph = (state) => {
    const c = screen();
    for (const [x, y, w, h] of placeGlyph(makePlace({ ...p, state }), { island: true })) c.fillRect(r.x + x, r.y + y, w, h, 1);
    return box(c);
  };
  const frame = (t) => {
    const c = screen();
    for (const [x, y, w, h] of placeGlyph(makePlace({ ...p, state: 'started' }), { island: true })) c.fillRect(r.x + x, r.y + y, w, h, 1);
    flagRise(c, { layout, index: 1, place: p }, t);
    return box(c);
  };
  assert.deepEqual(frame(0), glyph('started'), 'no flag yet');
  assert.deepEqual(frame(FLAG_MS), glyph('done'), 'the flag of a done place');
  let last = 0;
  for (let t = 0; t <= FLAG_MS; t += 20) {
    const n = frame(t).join('').split('').filter((ch) => ch === '#').length;
    assert.ok(n >= last, `growing at ${t}`);
    last = n;
  }
  /* World maps too, and with no place given. */
  const c = screen();
  flagRise(c, { layout: WL, index: 0 }, FLAG_MS);
  assert.ok(c.count() > 0);
});

test('the zoom: an island grows 1x, 2x, 3x in a frame that opens to the map area', () => {
  const cell = WL.cells[3];
  const place = worldPlaces()[3];
  const lit = (t) => {
    const c = screen();
    zoomIn(c, { cell, place }, t);
    return c;
  };
  const glyphPx = placeGlyph(place).reduce((a, [, , w, h]) => a + w * h, 0);
  const frame = (c) => c.count() - glyphPx * 0;
  /* At the start the frame is the cell's box; at the end the map area's edge. */
  const start = lit(0);
  const from = cellRect(cell);
  assert.ok(start.on(from.x, from.y) && start.on(from.x + from.w - 1, from.y + from.h - 1));
  const end = lit(ZOOM_MS);
  for (const [x, y] of [[MAP_X, MAP_Y], [MAP_X + MAP_W - 1, MAP_Y], [MAP_X, MAP_Y + MAP_H - 1], [MAP_X + MAP_W - 1, MAP_Y + MAP_H - 1]]) {
    assert.ok(end.on(x, y), `frame corner ${x},${y}`);
  }
  /* The island's pixels grow with the square of its scale. */
  const inner = (c) => {
    let n = 0;
    for (let y = MAP_Y + 1; y < MAP_Y + MAP_H - 1; y++) for (let x = MAP_X + 1; x < MAP_X + MAP_W - 1; x++) n += c.on(x, y) ? 1 : 0;
    return n;
  };
  assert.equal(inner(lit(ZOOM_MS)), glyphPx * 9, 'three times as wide and tall at the end');
  assert.equal(inner(lit(ZOOM_MS / 2)) - glyphPx * 4 >= 0, true, 'twice in the middle');
  assert.ok(frame(end) > frame(start));
  /* Out is in, backwards. */
  for (const t of [0, 100, 175, 300, ZOOM_MS]) {
    const a = screen();
    const b = screen();
    zoomOut(a, { cell, place }, t);
    zoomIn(b, { cell, place }, ZOOM_MS - t);
    assert.equal(a.key(), b.key(), `out at ${t}`);
  }
  const plain = screen();
  zoomIn(plain, { cell }, ZOOM_MS);
  assert.ok(plain.count() > 0, 'an island even with no place given');
});

test('the star: rays out and back, sparks between, none at the ends', () => {
  const at = (t) => {
    const c = screen();
    starBurst(c, { x: 64, y: 31, r: 11, seed: 2 }, t);
    return c;
  };
  assert.equal(at(0).count(), 0);
  assert.equal(at(STAR_MS).count(), 0);
  assert.ok(at(STAR_MS / 2).count() > at(STAR_MS / 8).count(), 'longest half way');
  /* Rays leave the score's own circle alone. */
  const mid = at(STAR_MS / 2);
  for (let y = 31 - 11; y <= 31 + 11; y++) {
    for (let x = 64 - 11; x <= 64 + 11; x++) if ((x - 64) ** 2 + (y - 31) ** 2 < 11 * 11) assert.ok(!mid.on(x, y));
  }
  /* Near an edge it is clipped, never wrapped. */
  const edge = screen();
  starBurst(edge, { x: 2, y: 2, r: 4 }, STAR_MS / 2);
  assert.ok(!edge.outside(0, 0, 128, 64));
});

test('the finale: every flag waves, and fireworks go up over each island in turn', () => {
  const at = (t) => {
    const c = screen();
    finale(c, { layout: WL, places: worldPlaces(), seed: 4 }, t);
    return c;
  };
  assert.notEqual(at(0).key(), at(150).key(), 'the flags flutter');
  assert.equal(at(0).key(), at(300).key(), 'and flutter back');
  /* Island i's burst is near island i, at its turn. */
  for (const i of [0, 3, 6]) {
    const t = 600 + i * 220 + 200;
    const c = at(t);
    const base = at(Math.floor(t / 300) * 300 + (Math.floor(t / 150) % 2 ? 150 : 0));
    const r = cellRect(WL.cells[i]);
    let near = 0;
    for (let y = r.y - 12; y < r.y + 14; y++) {
      for (let x = r.x - 6; x < r.x + 22; x++) if (c.on(x, y) && !base.on(x, y)) near++;
    }
    assert.ok(near > 0, `fireworks over island ${i}`);
  }
  assert.equal(at(FINALE_MS).key(), at(FINALE_MS + 1000).key());
});

test('LEDs: a wave sweeps left to right; sparkles are seeded', () => {
  const palette = { off: 0, sweep: 1, sweepDim: 2, sparkle: 3 };
  const centre = (t) => {
    const out = sweepColors({ t, palette });
    assert.equal(out.length, 32);
    const cols = [];
    for (let i = 0; i < 32; i++) if (out[i] === 1) cols.push(i % 8);
    return cols.length ? cols.reduce((a, b) => a + b, 0) / cols.length : null;
  };
  let last = -1;
  for (let t = 0; t <= SWEEP_MS; t += 60) {
    const c = centre(t);
    if (c !== null) {
      assert.ok(c >= last, `moving right at ${t}`);
      last = c;
    }
  }
  assert.ok(last >= 6, 'reaches the right edge');
  assert.equal(sweepColors({ t: SWEEP_MS * 2, palette }).filter((v) => v !== 0).length, 0, 'gone after');
  assert.deepEqual(sweepColors({ t: 300, palette: { off: 0, sweep: 5 } }).filter((v) => v === 2), [], 'no dim colour, no dim pads');
  const out = new Array(32).fill(9);
  assert.equal(sparkleColors({ t: 100, seed: 2, palette, out }), out);
  const lit = out.filter((v) => v === 3).length;
  assert.ok(lit >= 1 && lit <= 5);
  assert.ok(!out.includes(9));
  assert.deepEqual(sparkleColors({ t: 100, seed: 2, palette }), sparkleColors({ t: 159, seed: 2, palette }), 'steady for 80 ms');
  assert.notDeepEqual(sparkleColors({ t: 100, seed: 2, palette }), sparkleColors({ t: 180, seed: 2, palette }));
  assert.notDeepEqual(sparkleColors({ t: 100, seed: 2, palette }), sparkleColors({ t: 100, seed: 3, palette }));
});
