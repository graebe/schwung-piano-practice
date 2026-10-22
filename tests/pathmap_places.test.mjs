// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * The buildings of an island map, as a set. Imports only src/pathmap, so it
 * runs unchanged in Drums Practice.
 *
 * `npm run preview -- --view map --kind island --map drums|piano` shows them
 * on their island.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { BUILDINGS, ALIASES, ISLAND_VARIANTS } from '../src/pathmap/places.mjs';
import {
  glyphRows, placeGlyph, flagOf, shapeKind, BODIES, SHAPES, GLYPH_W, GLYPH_H, STAND_X,
} from '../src/pathmap/render.mjs';
import { makePlace, KINDS, fillLevel } from '../src/pathmap/model.mjs';

const ISLAND_KINDS = [...Object.keys(BUILDINGS), 'cove', 'fort'];
const lit = (rows) => rows.join('').split('').filter((c) => c === '#').length;
const bodyOf = (kind) => (ISLAND_VARIANTS[kind] || BUILDINGS[kind]);
const ground = (kind) => bodyOf(kind).filter((r) => /[ox]/.test(r)).length;

test('the set: nine buildings, the hut an alias of the signpost, every one a kind', () => {
  assert.deepEqual(Object.keys(BUILDINGS), ['sign', 'bell', 'clock', 'workshop', 'stage', 'library', 'temple', 'stairs', 'market']);
  assert.deepEqual({ ...ALIASES }, { hut: 'sign' });
  for (const k of [...Object.keys(BUILDINGS), 'hut']) assert.ok(KINDS.includes(k), k);
  assert.deepEqual(Object.keys(ISLAND_VARIANTS), ['fort', 'cove']);
});

test('every building fits the box: base on row 8, clear of the avatar beside it', () => {
  for (const kind of ISLAND_KINDS) {
    const body = bodyOf(kind);
    assert.equal(body.length, 9, kind);
    for (const row of body) {
      assert.match(row, /^[#ox.]{10}$/, `${kind}: ${row}`);
      assert.equal(row[9], '.', `${kind}: column 9 stays clear of the avatar`);
    }
    assert.ok(/#/.test(body[8]), `${kind}: standing on row 8`);
    assert.ok(STAND_X >= 10);
  }
});

test('every building lights up in at least two steps, and fills from the bottom', () => {
  for (const kind of ISLAND_KINDS) {
    const levels = ground(kind);
    assert.ok(levels >= 2, `${kind}: ${levels} rows of wall`);
    const at = (pc) => glyphRows(kind, 'solid', fillLevel(pc, levels), { island: true }).join();
    assert.equal(new Set([at(0), at(50), at(100)]).size, 3, `${kind}: empty, begun and finished differ`);
    if (levels >= 3) assert.notEqual(at(20), at(60), `${kind}: 20 and 60% differ`);
  }
});

test('details drawn in the inverse of the wall read empty and full', () => {
  /* Every 'x' sits in a row that fills, so it flips with the wall behind it. */
  for (const kind of ISLAND_KINDS) {
    bodyOf(kind).forEach((row, y) => {
      if (row.includes('x')) assert.ok(/o/.test(row) || /x/.test(row), `${kind} row ${y}`);
    });
    if (!bodyOf(kind).join('').includes('x')) continue;
    const empty = glyphRows(kind, 'solid', 0, { island: true });
    const full = glyphRows(kind, 'solid', ground(kind), { island: true });
    const xs = [];
    bodyOf(kind).forEach((row, y) => [...row].forEach((ch, x) => ch === 'x' && xs.push([x, y])));
    for (const [x, y] of xs) assert.notEqual(empty[y][x], full[y][x], `${kind}: the detail at ${x},${y} flips`);
  }
});

test('eleven different buildings at a glance, and none is a world shape', () => {
  for (const look of ['solid', 'sparse']) {
    const shapes = ISLAND_KINDS.map((k) => glyphRows(k, look, look === 'solid' ? 1 : 0, { island: true }).join('|'));
    assert.equal(new Set(shapes).size, ISLAND_KINDS.length, look);
    for (const w of Object.keys(BODIES)) {
      if (w === 'fort' || w === 'cove') continue;
      assert.ok(!shapes.includes(glyphRows(w, look, look === 'solid' ? 1 : 0).join('|')), `${w} ${look}`);
    }
  }
});

test('done flies a flag on the roof: a pole of 3 px or more, its pennant clear of the building', () => {
  for (const kind of ISLAND_KINDS) {
    const f = flagOf(kind, true);
    const body = glyphRows(kind, 'solid', ground(kind), { island: true });
    assert.ok(f.end >= 3, `${kind}: pole ${f.end} px`);
    assert.notEqual(body[f.end][f.x], '.', `${kind}: the pole stands on the building`);
    for (let y = 0; y < f.end; y++) assert.equal(body[y][f.x], '.', `${kind}: the pole is in open sky`);
    for (const [x, y] of f.pennant) {
      assert.ok(x >= 0 && x <= 6 && y >= 0 && y < 2, `${kind}: pennant inside the box, clear of the due dot`);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) assert.equal(body[y + dy]?.[x + dx] ?? '.', '.', `${kind}: pennant at ${x},${y} touches`);
      }
    }
    const done = glyphRows(kind, 'solid', ground(kind), { island: true, flag: true });
    assert.equal(lit(done) - lit(body), f.end + 6, `${kind}: pole and a 3x2 pennant`);
  }
  /* The world keeps its flag on the left shoulder. */
  assert.equal(flagOf('island').x, 2);
  assert.deepEqual(flagOf('fort'), flagOf('fort', false));
  assert.notDeepEqual(flagOf('fort', true), flagOf('fort'));
});

test('every state reads: fill, flag, marker, avatar, due, dotted and sparse', () => {
  for (const kind of ISLAND_KINDS) {
    const looks = {};
    for (const [name, state, percent, opts] of [
      ['fresh', 'fresh', 0, {}], ['started', 'started', 50, {}], ['done', 'done', 100, {}],
      ['here', 'current', 50, { here: true }], ['avatar', 'current', 50, { avatar: true }],
      ['due', 'started', 50, { due: true }], ['skipped', 'skipped', 0, {}], ['ahead', 'ahead', 0, {}]]) {
      const p = makePlace({ kind, state, percent, due: opts.due ? 1 : 0 });
      looks[name] = placeGlyph(p, { here: !!opts.here, avatar: !!opts.avatar, island: true });
    }
    assert.equal(new Set(Object.values(looks).map((r) => JSON.stringify(r))).size, 8, kind);
    assert.equal(placeGlyph(makePlace({ kind, state: 'fresh' }), { island: true }), looks.fresh, 'cached');
  }
});

test('the hut and unknown kinds resolve; world maps keep their own fort and chest', () => {
  assert.equal(shapeKind('hut'), 'sign');
  assert.equal(shapeKind('nope'), 'place');
  assert.deepEqual(glyphRows('fort', 'solid', 2), SHAPES.fort.length ? glyphRows('fort', 'solid', 2, { island: false }) : null);
  assert.notDeepEqual(glyphRows('fort', 'solid', 2, { island: true }), glyphRows('fort', 'solid', 2));
  assert.equal(glyphRows('bell', 'solid', 0).length, GLYPH_H);
  assert.equal(glyphRows('bell', 'solid', 0)[0].length, GLYPH_W);
});
