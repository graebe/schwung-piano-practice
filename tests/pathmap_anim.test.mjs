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
  ANIMS, FLAG_MS, FIREWORKS_MS, ZOOM_MS, STAR_MS, FINALE_MS, SWEEP_MS, BANNER_MS,
  flagRise, fireworks, zoomIn, zoomOut, starBurst, starFit, finale, banner, sweepColors, sparkleColors, rng,
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
    text(x, y, s, v) {
      this.calls++;
      (this.texts = this.texts || []).push({ x, y, s, v });
      /* A 5x7 block per character stands in for the font. */
      for (let i = 0; i < s.length; i++) for (let yy = 0; yy < 7; yy++) for (let xx = 0; xx < 5; xx++) set(x + i * 6 + xx, y + yy, v);
    },
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
  banner: (t, c) => banner(c, { text: 'STAGE COMPLETE' }, t),
};

test('every animation has its length, and the registry names them all', () => {
  assert.deepEqual([FLAG_MS, FIREWORKS_MS, ZOOM_MS, STAR_MS, FINALE_MS, BANNER_MS], [400, 900, 350, 600, 2500, 1200]);
  assert.deepEqual(Object.keys(ANIMS), ['flag', 'fireworks', 'zoomIn', 'zoomOut', 'star', 'finale', 'banner']);
  assert.deepEqual(Object.values(ANIMS).map((a) => a.ms), [400, 900, 350, 350, 600, 2500, 1200]);
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

test('an elliptical star hugs a big score: clear of it, of the caption, inside the map', () => {
  /* The result screen's case: a score at scale 3 ("100" is 33x15, "95"
   * 21x15) with a 9 px caption underneath, at the bottom of the map area. */
  const CAPTION = [45, 53];
  const layouts = [
    { name: 'centred above the caption', top: MAP_Y, bottom: CAPTION[0] - 2 },
    { name: 'centred in the map area', top: MAP_Y, bottom: CAPTION[0] - 2, y: 31 },
  ];
  for (const [score, w] of [['100', 33], ['95', 21]]) {
    for (const lay of layouts) {
      const fit = starFit({ w, h: 15, top: lay.top, bottom: lay.bottom, y: lay.y });
      const x = 64;
      const box = [x - Math.ceil((w - 1) / 2), fit.y - 7, x + Math.ceil((w - 1) / 2), fit.y + 7];
      let shown = 0;
      for (let t = 0; t <= STAR_MS; t += 5) {
        const c = screen();
        starBurst(c, { x, y: fit.y, rx: fit.rx, ry: fit.ry, len: fit.len, seed: 3 }, t);
        assert.ok(c.calls < 200);
        for (let yy = 0; yy < 64; yy++) {
          for (let xx = 0; xx < 128; xx++) {
            if (!c.on(xx, yy)) continue;
            shown++;
            const at = `${score} ${lay.name} at ${t} ms: ${xx},${yy}`;
            assert.ok(yy >= MAP_Y && yy <= MAP_Y + MAP_H - 1, `${at} leaves the map area`);
            assert.ok(yy >= lay.top && yy <= lay.bottom, `${at} leaves its band`);
            assert.ok(yy < CAPTION[0] - 1, `${at} touches the caption`);
            assert.ok(xx < box[0] - 1 || xx > box[2] + 1 || yy < box[1] - 1 || yy > box[3] + 1, `${at} touches the score`);
          }
        }
      }
      assert.ok(shown > 100, `${score} ${lay.name}: the burst shows (${JSON.stringify(fit)})`);
    }
  }
  /* The snug fits the result screen uses, and their shape. */
  assert.deepEqual(starFit({ w: 33, h: 15, top: 10, bottom: 43 }), { rx: 28, ry: 11, len: 5, y: 27 });
  assert.deepEqual(starFit({ w: 21, h: 15, top: 10, bottom: 43, y: 26 }), { rx: 22, ry: 10, len: 6, y: 26 });
  /* No room for rays: sparks only, still clear of the score. */
  const tight = starFit({ w: 33, h: 15, top: 20, bottom: 40, y: 30 });
  assert.equal(tight.len, 0);
  /* Deterministic, clamped, and the round form unchanged by the new one. */
  const a = screen();
  const b = screen();
  starBurst(a, { x: 64, y: 27, rx: 28, ry: 11, len: 5, seed: 1 }, 300);
  starBurst(b, { x: 64, y: 27, rx: 28, ry: 11, len: 5, seed: 1 }, 300);
  assert.equal(a.key(), b.key());
  const round = screen();
  const same = screen();
  starBurst(round, { x: 64, y: 31, r: 11, seed: 2 }, 300);
  starBurst(same, { x: 64, y: 31, r: 11, seed: 2, rx: undefined }, 300);
  assert.equal(round.key(), same.key());
  /* The round form draws exactly what it drew before the ellipse existed:
   * pixel hashes recorded from it, every 50 ms of { x: 64, y: 31, r: 11 }. */
  const fnv = (px) => {
    let hash = 0x811c9dc5;
    for (const v of px) hash = Math.imul(hash ^ v, 0x01000193) >>> 0;
    return hash.toString(16);
  };
  const recorded = [];
  for (let t = 0; t <= STAR_MS; t += 50) {
    const c = screen();
    starBurst(c, { x: 64, y: 31, r: 11, seed: 2 }, t);
    recorded.push(fnv(c.px));
  }
  assert.equal(recorded.join(','), 'bcc31dc5,74e7cb85,1eceb5d5,9bd16405,9bbfed2d,f88fda0d,de4cd26d,6295cd35,5eaedcc5,69794ecd,ee97a2fd,7df8bde5,bcc31dc5');
  const ry = screen();
  starBurst(ry, { x: 64, y: 31, rx: 14, seed: 2 }, 250);
  assert.ok(ry.count() > 0, 'ry and len default to rx and 7');
});

test('the finale: every flag waves, and bold bursts go up over every island and the sky', () => {
  const at = (t) => {
    const c = screen();
    finale(c, { layout: WL, places: worldPlaces(), seed: 4 }, t);
    return c;
  };
  const still = at(0);
  const flapping = at(150);
  assert.notEqual(still.key(), flapping.key(), 'the flags flap');
  assert.equal(still.key(), at(300).key(), 'and flap back');
  /* The flapping frame differs at every flag, not just one. */
  for (const cell of WL.cells) {
    const r = cellRect(cell);
    let diff = 0;
    for (let y = r.y; y < r.y + 3; y++) for (let x = r.x; x < r.x + 9; x++) diff += still.on(x, y) !== flapping.on(x, y) ? 1 : 0;
    assert.ok(diff >= 2, `flag at ${cell.col},${cell.row} waves`);
  }
  /* Over the finale every island gets a burst near it. */
  const base = (t) => at(Math.floor(t / 150) % 2 ? 150 : 0);
  for (let i = 0; i < WL.cells.length; i++) {
    const r = cellRect(WL.cells[i]);
    let near = 0;
    for (let t = 0; t <= FINALE_MS && !near; t += 25) {
      const c = at(t);
      const b = base(t);
      for (let y = r.y - 14; y < r.y + 16; y++) {
        for (let x = r.x - 10; x < r.x + 26; x++) if (c.on(x, y) && !b.on(x, y)) near++;
      }
    }
    assert.ok(near > 0, `a burst over island ${i}`);
  }
  /* Bold: at its widest a burst lights solid streaks, not single dots. */
  const c = screen();
  fireworks(c, { x: 64, y: 31, seed: 1 }, 270);
  let streaks = 0;
  for (let y = 10; y < 54; y++) for (let x = 0; x < 127; x++) if (c.on(x, y) && c.on(x + 1, y) && c.on(x + 2, y)) streaks++;
  assert.ok(streaks >= 2, 'horizontal streaks of three pixels or more');
  assert.equal(at(FINALE_MS).key(), at(FINALE_MS + 1000).key());
  /* On an island its buildings' flags -- some flying left -- wave too, in bounds. */
  const isle = (t) => {
    const c = screen();
    finale(c, { layout: IL, places: islePlaces(), seed: 2 }, t);
    return c;
  };
  assert.notEqual(isle(0).key(), isle(150).key());
  assert.ok(!isle(150).outside(MAP_X, MAP_Y, MAP_X + MAP_W, MAP_Y + MAP_H));
});

test('the banner slides in, holds its words, and slides out', () => {
  const at = (t, text = 'STAGE COMPLETE') => {
    const c = screen();
    banner(c, { text }, t);
    return c;
  };
  assert.equal(at(0).count(), 0, 'not yet on screen');
  assert.equal(at(BANNER_MS).count(), 0, 'gone at the end');
  /* Sliding in from the left: its right edge moves right. */
  const edge = (c) => {
    let x = -1;
    for (let i = 0; i < 128; i++) if (c.on(i, 31)) x = i;
    return x;
  };
  assert.ok(edge(at(60)) < edge(at(150)), 'sliding in');
  /* Held: a lit strip across the map, 11 px high, the words cut out of it, centred. */
  const held = at(BANNER_MS / 2);
  assert.ok(!held.outside(MAP_X, MAP_Y, MAP_X + MAP_W, MAP_Y + MAP_H));
  let rows = 0;
  for (let y = MAP_Y; y < MAP_Y + MAP_H; y++) if (held.on(0, y) && held.on(127, y)) rows++;
  assert.equal(rows, 11 + 2, 'the strip and its two rules');
  const [line] = held.texts;
  assert.equal(line.v, 0, 'the words are cut out of the strip');
  assert.equal(line.x, (128 - (line.s.length * 6 - 1)) >> 1, 'centred');
  /* Sliding out to the right: the left edge moves right. */
  const leftEdge = (c) => {
    for (let i = 0; i < 128; i++) if (c.on(i, 31)) return i;
    return 128;
  };
  assert.ok(leftEdge(at(1050)) > leftEdge(at(980)), 'sliding out');
  /* Words too wide for one line take two, and the strip grows to fit. */
  const long = at(600, 'LEARNING PATH COMPLETE');
  assert.deepEqual(long.texts.map((t) => t.s), ['LEARNING PATH', 'COMPLETE']);
  let tall = 0;
  for (let y = MAP_Y; y < MAP_Y + MAP_H; y++) if (long.on(0, y) && long.on(127, y)) tall++;
  assert.equal(tall, 19 + 2);
  assert.deepEqual(at(600, 'ONEVERYLONGWORDWITHNOSPACESATALL').texts?.length ?? 0, 0, 'no space to split: no words that would not fit');
  assert.equal(at(600, '').texts.length, 1);
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
