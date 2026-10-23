// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * The route can always be seen. Between every two neighbouring places, on
 * both kinds of map, for every layout, every state and wherever the avatar
 * stands, the dotted route runs unbroken outside the two places it joins:
 * no gap over 3 px, and at least 3 dots. And the route's centre line never
 * runs into a building it does not join. Imports only src/pathmap, so it
 * runs unchanged in Drums Practice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { layoutPlaces, cellRect, cellCentre } from '../src/pathmap/layout.mjs';
import { drawMap, placeKeepOut, STAND_X, AVATAR_W, AVATAR_H, STAND_Y, GLYPH_DX } from '../src/pathmap/render.mjs';
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
    on(k) { return px[k] === 1; },
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

/* What a place may hide of the route: its keep-out, and the avatar's spot
 * (cleared when the figure or the current marker stands in it). */
function endpointMask(L, i, kind) {
  const m = placeKeepOut(L, i, kind);
  const r = cellRect(L.cells[i], L.kind);
  for (let y = r.y - 1; y <= r.y + STAND_Y + AVATAR_H; y++) {
    for (let x = r.x + GLYPH_DX + STAND_X - 1; x <= r.x + GLYPH_DX + STAND_X + AVATAR_W; x++) m.add(y * 128 + x);
  }
  return m;
}

const ISLAND_KINDS = [...Object.keys(BUILDINGS), 'cove', 'fort'];
const SETS = [
  { kind: 'world', kinds: () => ['island'] },
  { kind: 'world', kinds: () => ['place', 'cove', 'fort'] },
  { kind: 'island', kinds: (n) => ISLAND_KINDS.slice(0, n) },
  { kind: 'island', kinds: (n) => ISLAND_KINDS.slice(ISLAND_KINDS.length - n) },
];

test('the route shows between every two places: no gap over 3 px, at least 3 dots', () => {
  const failures = [];
  for (const set of SETS) {
    for (let n = 2; n <= 9; n++) {
      const L = layoutPlaces(n, { kind: set.kind });
      const pool = set.kinds(n);
      const kinds = Array.from({ length: n }, (_, i) => pool[i % pool.length]);
      for (const state of STATES) {
        const places = kinds.map((kind) => makePlace({ kind, state, percent: 60, due: 1 }));
        for (let at = 0; at < n; at++) {
          const c = screen();
          drawMap(c, { places, layout: L, walk: createWalk(L, at), now: 0 });
          for (let i = 0; i + 1 < n; i++) {
            const hide = new Set([...endpointMask(L, i, kinds[i]), ...endpointMask(L, i + 1, kinds[i + 1])]);
            let dots = 0;
            let gap = 0;
            let worst = 0;
            for (const k of polyline(L, i)) {
              if (hide.has(k)) {
                gap = 0;
                continue;
              }
              if (c.on(k)) {
                dots++;
                gap = 0;
              } else {
                gap++;
                worst = Math.max(worst, gap);
              }
            }
            if (worst > 3 || dots < 3) {
              failures.push(`${set.kind} ${kinds.join('/')} n=${n} ${state} avatar@${at}: ${i + 1}->${i + 2} gap ${worst}, ${dots} dots`);
            }
          }
        }
      }
    }
  }
  assert.deepEqual(failures.slice(0, 12), [], `${failures.length} broken segments`);
});

test('the route\'s centre line never runs into a building it does not join', () => {
  /* Any kind may stand on any place of an island, so check against all of them. */
  for (const kind of ['world', 'island']) {
    const kinds = kind === 'island' ? ISLAND_KINDS : ['island', 'place', 'cove', 'fort'];
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
