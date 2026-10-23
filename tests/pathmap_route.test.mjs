// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * The route can always be seen. Its dots are hidden only where something is
 * drawn on that very frame, and a pixel round it: a place's shape (walls and
 * ground, filled or not), and its flag, due dot, marker and avatar only when
 * they are drawn. An empty flag spot or an empty avatar spot hides nothing;
 * a flag, marker or avatar that appears covers the route only where it is.
 * And the route stays a pixel clear of everything lit. Checked on both kinds
 * of map, every layout of 2 to 9 places, every kind of place at every
 * position, every state, with the marker on and off, with no avatar and with
 * it standing on each place. Imports only src/pathmap, so it runs unchanged
 * in Drums Practice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { layoutPlaces, cellRect, cellCentre } from '../src/pathmap/layout.mjs';
import { drawMap, placeKeepOut, glyphRows, GLYPH_DX } from '../src/pathmap/render.mjs';
import { createWalk } from '../src/pathmap/walk.mjs';
import { makePlace, STATES } from '../src/pathmap/model.mjs';
import { BUILDINGS } from '../src/pathmap/places.mjs';

function screen() {
  const px = new Uint8Array(128 * 64);
  return {
    px,
    fillRect(x, y, w, h, v) {
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) if (xx >= 0 && yy >= 0 && xx < 128 && yy < 64) px[yy * 128 + xx] = v ? 1 : 0;
      }
    },
  };
}

/* The route's pixels from place i to place i + 1, in order. */
function polyline(L, i) {
  const out = [];
  for (let k = L.stops[i]; k < L.stops[i + 1]; k++) {
    const a = cellCentre(L.route[k], L.kind);
    const b = cellCentre(L.route[k + 1], L.kind);
    const dx = Math.sign(b.x - a.x);
    const dy = Math.sign(b.y - a.y);
    for (let x = a.x, y = a.y; ; x += dx, y += dy) {
      const key = y * 128 + x;
      if (out[out.length - 1] !== key) out.push(key);
      if (x === b.x && y === b.y) break;
    }
  }
  return out;
}

/* A place's shape on screen: every wall and every pixel of its ground,
 * whatever its look or fill (the ground is there even when it is empty). */
function body(L, i, kind) {
  const island = L.kind === 'island';
  const r = cellRect(L.cells[i], L.kind);
  const out = [];
  for (const level of [0, 99]) {
    glyphRows(kind, 'solid', level, { island }).forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '#') out.push((r.y + y) * 128 + r.x + GLYPH_DX + x);
    }));
  }
  return out;
}

/* Everything drawn on a frame but the route, and a pixel round it. */
function nearDrawn(L, kinds, bare) {
  const near = new Uint8Array(128 * 64);
  const mark = (k) => {
    const x = k % 128;
    const y = Math.floor(k / 128);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < 128 && yy < 64) near[yy * 128 + xx] = 1;
      }
    }
  };
  for (let k = 0; k < bare.length; k++) if (bare[k]) mark(k);
  kinds.forEach((kind, i) => body(L, i, kind).forEach(mark));
  return near;
}

const ISLAND_KINDS = [...Object.keys(BUILDINGS), 'cove', 'fort'];
const WORLD_KINDS = ['island', 'place', 'cove', 'fort'];
/* The two islands the modules ship (tools/preview.mjs), due dots on the odd
 * places and then the even ones; and every kind at every position (each
 * rotation of the kind list), which brings each kind with and without one. */
const DRUMS = ['sign', 'bell', 'clock', 'workshop', 'stage', 'cove', 'fort'];
const PIANO = ['market', 'bell', 'stairs', 'library', 'temple', 'workshop', 'stage', 'fort'];
const rotations = (list) => list.map((_, r) => [...list.slice(r), ...list.slice(0, r)]);
const SETS = [
  ...rotations(WORLD_KINDS).map((pool) => ({ kind: 'world', pool, dues: [0] })),
  { kind: 'island', pool: DRUMS, dues: [0, 1] },
  { kind: 'island', pool: PIANO, dues: [0, 1] },
  ...rotations(ISLAND_KINDS).map((pool) => ({ kind: 'island', pool, dues: [0] })),
];

/* Every frame of the sweep: its layout, kinds, places, avatar, marker phase. */
function* frames() {
  for (const set of SETS) {
    for (let n = 2; n <= 9; n++) {
      const L = layoutPlaces(n, { kind: set.kind });
      const kinds = Array.from({ length: n }, (_, i) => set.pool[i % set.pool.length]);
      for (const state of STATES) {
        for (const dueOdd of set.dues) {
          const places = kinds.map((kind, i) => makePlace({ kind, state, percent: 60, due: i % 2 === dueOdd ? 1 : 0 }));
          /* The marker blinks only on the current place. */
          for (const pulse of state === 'current' ? [true, false] : [true]) {
            for (let at = -1; at < n; at++) {
              const walk = at < 0 ? null : createWalk(L, at);
              yield { L, kinds, places, walk, pulse, dueOdd, label: `${set.kind} ${kinds.join('/')} n=${n} ${state} due${dueOdd} pulse=${pulse} avatar@${at < 0 ? '-' : at + 1}` };
            }
          }
        }
      }
    }
  }
}

test('route dots are hidden only where something is drawn on the frame, and a pixel round it', () => {
  const failures = [];
  let count = 0;
  for (const f of frames()) {
    const c = screen();
    drawMap(c, { places: f.places, layout: f.L, walk: f.walk, now: 0, pulse: f.pulse });
    const bare = screen();
    drawMap(bare, { places: f.places, layout: f.L, walk: f.walk, now: 0, pulse: f.pulse, route: false });
    const near = nearDrawn(f.L, f.kinds, bare.px);
    const want = new Set();
    for (let i = 0; i + 1 < f.L.cells.length; i++) {
      for (const k of polyline(f.L, i)) if ((k % 128 + Math.floor(k / 128)) % 2 === 0 && !near[k]) want.add(k);
    }
    const missing = [];
    const extra = [];
    for (let k = 0; k < c.px.length; k++) {
      const expect = bare.px[k] === 1 || want.has(k);
      if (c.px[k] === 1 && !expect) extra.push(k);
      else if (c.px[k] === 0 && expect) missing.push(k);
    }
    count++;
    if (missing.length || extra.length) {
      const at = (ks) => ks.slice(0, 4).map((k) => `${k % 128},${Math.floor(k / 128)}`).join(' ');
      failures.push(`${f.label}: ${missing.length} dots hidden (${at(missing)}), ${extra.length} stray (${at(extra)})`);
    }
  }
  assert.ok(count > 5000, `swept ${count} frames`);
  assert.deepEqual(failures.slice(0, 8), [], `${failures.length} of ${count} frames break the rule`);
});

test('the route shows between every two places: no gap over 3 px, at least 3 dots', () => {
  const failures = [];
  for (const f of frames()) {
    if (!f.pulse) continue;
    const c = screen();
    drawMap(c, { places: f.places, layout: f.L, walk: f.walk, now: 0, pulse: f.pulse });
    const bare = screen();
    drawMap(bare, { places: f.places, layout: f.L, walk: f.walk, now: 0, pulse: f.pulse, route: false });
    const near = nearDrawn(f.L, f.kinds, bare.px);
    for (let i = 0; i + 1 < f.L.cells.length; i++) {
      let dots = 0;
      let gap = 0;
      let worst = 0;
      for (const k of polyline(f.L, i)) {
        if (near[k]) {
          gap = 0;
        } else if (c.px[k]) {
          dots++;
          gap = 0;
        } else {
          gap++;
          worst = Math.max(worst, gap);
        }
      }
      if (worst > 3 || dots < 3) failures.push(`${f.label}: ${i + 1}->${i + 2} gap ${worst}, ${dots} dots`);
    }
  }
  assert.deepEqual(failures.slice(0, 8), [], `${failures.length} broken segments`);
});

test('the route\'s centre line never runs into a building it does not join', () => {
  /* Any kind may stand on any place of an island, so check against all of them. */
  for (const kind of ['world', 'island']) {
    const kinds = kind === 'island' ? ISLAND_KINDS : WORLD_KINDS;
    for (let n = 2; n <= 9; n++) {
      const L = layoutPlaces(n, { kind });
      for (let j = 0; j < n; j++) {
        const keep = new Set();
        for (const k of kinds) for (const p of placeKeepOut(L, j, k)) keep.add(p);
        for (let i = 0; i + 1 < n; i++) {
          if (i === j || i + 1 === j) continue;
          for (const p of polyline(L, i)) {
            assert.ok(!keep.has(p), `${kind} n=${n}: route ${i + 1}->${i + 2} runs into place ${j + 1} at ${p % 128},${Math.floor(p / 128)}`);
          }
        }
      }
    }
  }
});
