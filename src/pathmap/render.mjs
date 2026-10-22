// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * render.mjs — the Path map on the 128x64 1-bit screen.
 *
 * drawMap draws the map area only (y 10..53); the title bar above and the hint
 * line below are the module's own chrome.
 *
 * Every glyph is authored as ASCII rows, because that is the only sane way to
 * edit 1-bit art, and compiled once into rectangles: horizontal runs, merged
 * downwards where a run repeats on the next row. A place costs 5-15 fillRect
 * calls instead of ~60 pixels, and the compiled form is cached per look, so a
 * frame does no glyph work at all. The route's dots are computed once per
 * layout. On the Move a ctx call is a QuickJS binding crossing (~0.5us), and
 * the map redraws at 50Hz while the avatar walks.
 *
 * ctx: { fillRect(x,y,w,h,v), drawRect(x,y,w,h,v), line(x0,y0,x1,y1,v),
 *        text(x,y,s,v), textWidth(s) }   (only fillRect is needed here)
 *
 * Pure: imports only its siblings. Vendored byte for byte into Drums Practice.
 */

import { COLS, ROWS, MAP_X, MAP_Y, MAP_W, MAP_H, cellRect, cellCentre } from './layout.mjs';
import { posAt } from './walk.mjs';
import { fillLevel } from './model.mjs';

/* ---- Compiling ASCII rows ------------------------------------------------ */

/* [dx, dy, w] horizontal runs of `on` characters. */
export function rowsToRuns(rows, on = '#') {
  const runs = [];
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    let x = 0;
    while (x < row.length) {
      if (row[x] === on) {
        const start = x;
        while (x < row.length && row[x] === on) x++;
        runs.push([start, y, x - start]);
      } else {
        x++;
      }
    }
  }
  return runs;
}

/*
 * [dx, dy, w, h] rectangles: a run that repeats exactly on the next row
 * extends the rectangle above it. An outline's straight sides collapse from
 * one call per row to one call per side.
 */
export function runsToRects(runs) {
  const rects = [];
  const open = new Map();
  for (const [x, y, w] of runs) {
    const k = x * 64 + w;
    const r = open.get(k);
    if (r && r[1] + r[3] === y) {
      r[3]++;
    } else {
      const nr = [x, y, w, 1];
      rects.push(nr);
      open.set(k, nr);
    }
  }
  return rects;
}

export const compile = (rows, on = '#') => runsToRects(rowsToRuns(rows, on));

function blit(ctx, rects, x, y, v) {
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    ctx.fillRect(x + r[0], y + r[1], r[2], r[3], v);
  }
}

/* ---- Place glyphs -------------------------------------------------------- */
/*
 * A place is 11x10, drawn at (cell.x + 3, cell.y): a 3-row sky band for the
 * markers, over a 7-row body.
 *
 * Body legend: '#' coast or wall, always drawn; 'o' ground that fills from the
 * bottom with the place's percentage; '.' never drawn (water, a gate, a door).
 *
 * Sky band, top-centre to top-right:
 *   flag    the place is done
 *   ▼       the current place (blinks with `pulse`)
 *   ■       reviews are due (2x2, top-right)
 */
export const GLYPH_W = 11;
export const GLYPH_H = 10;
export const SKY_H = 3;
export const GLYPH_DX = 3;

export const BODIES = {
  /* An island of the world map: a coast with a bay in its south. */
  island: [
    '...####....',
    '.##oooo##..',
    '#oooooooo#.',
    '#ooooooooo#',
    '.#oooooooo#',
    '.#ooooo###.',
    '..#####....',
  ],
  /* A place on an island: a round clearing. */
  place: [
    '..#######..',
    '.#ooooooo#.',
    '#ooooooooo#',
    '#ooooooooo#',
    '#ooooooooo#',
    '.#ooooooo#.',
    '..#######..',
  ],
  /* The checkpoint: battlements over a wall with a gate. */
  fort: [
    '#.#.#.#.#.#',
    '#ooooooooo#',
    '#ooooooooo#',
    '#ooooooooo#',
    '#ooooooooo#',
    '#oooo.oooo#',
    '#####.#####',
  ],
  /* The lessons: a hut, gable and door. */
  hut: [
    '.....#.....',
    '...##o##...',
    '.##ooooo##.',
    '#ooooooooo#',
    '#ooooooooo#',
    '#oooo.oooo#',
    '#####.#####',
  ],
  /* The electives: a cove, land round a bay that opens east. */
  cove: [
    '..#######..',
    '.#ooooooo#.',
    '#oooooo##..',
    '#ooooo#....',
    '#oooooo##..',
    '.#ooooooo#.',
    '..#######..',
  ],
};

const SKY = {
  flag: ['.....###...', '.....##....', '.....#.....'],
  here: ['....###....', '.....#.....', '...........'],
  due: ['.........##', '.........##', '...........'],
};

/*
 * How a state is drawn:
 *   solid   coast drawn, ground filled by percent (fresh, started, current, done)
 *   dotted  coast every other pixel, ground hatched: assumed known (skipped)
 *   sparse  coast every other pixel, no ground: not reached yet (ahead)
 */
const LOOK = { done: 'solid', current: 'solid', started: 'solid', fresh: 'solid', skipped: 'dotted', ahead: 'sparse' };

/* The rows of the ground, bottom first: 'o' rows a fill level lights. */
function groundRows(body) {
  const ys = [];
  for (let y = body.length - 1; y >= 0; y--) if (body[y].includes('o')) ys.push(y);
  return ys;
}
const GROUND_LEVELS = {};
for (const k in BODIES) GROUND_LEVELS[k] = groundRows(BODIES[k]).length;

/* ---- Avatar -------------------------------------------------------------- */
/*
 * 5x5. Walking, it is drawn lit on a cleared 7x7 tile, so the route and the
 * coasts it crosses never run into it, and its legs swap every half cell.
 * Standing, it is drawn inverted against whatever is under it -- XORed into
 * the place's glyph when that is compiled -- so it reads on empty ground, on
 * full ground and across the fill line alike. Both sit on the cell centre, so
 * arriving does not jump.
 */
export const AVATAR_W = 5;
export const AVATAR_TILE = 7;
const STANDING = ['..#..', '.###.', '#.#.#', '..#..', '.#.#.'];
/* Walking alternates the standing pose with a stride. */
export const AVATAR_ROWS = {
  stand: STANDING,
  walkA: STANDING,
  walkB: ['..#..', '#####', '..#..', '.#.#.', '#...#'],
};
/* Where the standing figure sits in a glyph: on the body's centre. */
const STAND_X = (GLYPH_W - AVATAR_W) >> 1;
const STAND_Y = SKY_H + 1;
const AVATAR = {};
for (const k in AVATAR_ROWS) AVATAR[k] = compile(AVATAR_ROWS[k]);

export function drawWalker(ctx, x, y, stride = 0) {
  const tx = x - (AVATAR_TILE >> 1);
  const ty = y - (AVATAR_TILE >> 1);
  ctx.fillRect(tx, ty, AVATAR_TILE, AVATAR_TILE, 0);
  blit(ctx, stride % 2 ? AVATAR.walkB : AVATAR.walkA, tx + 1, ty + 1, 1);
}

/* One look of one place as ASCII rows (exported for the preview and tests). */
export function glyphRows(kind, look, level, { due = false, here = false, flag = false, avatar = false } = {}) {
  const body = BODIES[kind] || BODIES.place;
  const ground = groundRows(body);
  const lit = new Set(ground.slice(0, level));
  const rows = [];
  for (let y = 0; y < GLYPH_H; y++) {
    const by = y - SKY_H;
    let row = '';
    for (let x = 0; x < GLYPH_W; x++) {
      let on;
      if (by < 0) {
        on = (flag && SKY.flag[y][x] === '#') || (here && SKY.here[y][x] === '#') || (due && SKY.due[y][x] === '#');
      } else {
        const ch = body[by][x];
        if (ch === '#') on = look === 'solid' || (x + y) % 2 === 0;
        else if (ch === 'o') on = look === 'solid' ? lit.has(by) : look === 'dotted' && by % 2 === 0;
        else on = false;
      }
      const ax = x - STAND_X;
      const ay = y - STAND_Y;
      if (avatar && ax >= 0 && ax < AVATAR_W && ay >= 0 && ay < AVATAR_W && AVATAR_ROWS.stand[ay][ax] === '#') on = !on;
      row += on ? '#' : '.';
    }
    rows.push(row);
  }
  return rows;
}

const glyphCache = new Map();

/* The compiled glyph for a place, from the cache. */
export function placeGlyph(place, { here = false, avatar = false } = {}) {
  const look = LOOK[place.state] || 'solid';
  const kind = BODIES[place.kind] ? place.kind : 'place';
  const level = look === 'solid' ? fillLevel(place.percent, GROUND_LEVELS[kind]) : 0;
  const due = place.due > 0;
  const flag = place.state === 'done';
  const key = `${kind}|${look}|${level}|${due ? 1 : 0}|${here ? 1 : 0}|${flag ? 1 : 0}|${avatar ? 1 : 0}`;
  let rects = glyphCache.get(key);
  if (!rects) {
    rects = compile(glyphRows(kind, look, level, { due, here, flag, avatar }));
    glyphCache.set(key, rects);
  }
  return rects;
}

/* ---- Water and route ----------------------------------------------------- */

/* A ripple, set in open water on the world map so the dark reads as sea. */
const WAVE = compile(['.##..', '#..##']);

/*
 * Per layout, computed once: the route as dots (1px every 2, on the even
 * diagonal so corners stay in step) that stop a pixel short of every place,
 * and the open-water cells that get a ripple.
 */
const sceneCache = new WeakMap();

function scene(layout) {
  let s = sceneCache.get(layout);
  if (s) return s;
  const onRoute = new Set(layout.route.map((c) => c.row * COLS + c.col));
  const inPlace = (x, y) => {
    for (const c of layout.cells) {
      const r = cellRect(c);
      if (x >= r.x + GLYPH_DX - 1 && x <= r.x + GLYPH_DX + GLYPH_W && y >= r.y - 1 && y <= r.y + GLYPH_H) return true;
    }
    return false;
  };
  const seen = new Set();
  const dots = [];
  for (let i = 1; i < layout.route.length; i++) {
    const a = cellCentre(layout.route[i - 1]);
    const b = cellCentre(layout.route[i]);
    const dx = Math.sign(b.x - a.x);
    const dy = Math.sign(b.y - a.y);
    for (let x = a.x, y = a.y; ; x += dx, y += dy) {
      const k = y * 256 + x;
      if ((x + y) % 2 === 0 && !seen.has(k) && !inPlace(x, y)) {
        seen.add(k);
        dots.push(x, y);
      }
      if (x === b.x && y === b.y) break;
    }
  }
  const waves = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if ((col + row) % 2 || onRoute.has(row * COLS + col)) continue;
      const r = cellRect({ col, row });
      /* Jittered so the sea does not read as a grid. */
      waves.push(r.x + 3 + ((col * 7 + row * 3) % 6), r.y + 3 + ((col + row * 2) % 3) * 2);
    }
  }
  s = { dots, waves };
  sceneCache.set(layout, s);
  return s;
}

/* ---- The map ------------------------------------------------------------- */

/*
 * state = { places, layout, walk, now, pulse }
 *   places  model places, one per layout cell
 *   walk    the avatar (walk.mjs); none, no avatar
 *   pulse   the blink phase of the current place's marker (default on)
 *
 * The world map (any place of kind 'island') is sea, so its open water
 * ripples; an island map is land, and stays plain.
 */
export function drawMap(ctx, { places, layout, walk = null, now = 0, pulse = true }) {
  ctx.fillRect(MAP_X, MAP_Y, MAP_W, MAP_H, 0);
  const s = scene(layout);
  let sea = false;
  for (let i = 0; i < places.length; i++) if (places[i].kind === 'island') sea = true;
  if (sea) {
    for (let i = 0; i < s.waves.length; i += 2) blit(ctx, WAVE, s.waves[i], s.waves[i + 1], 1);
  }
  for (let i = 0; i < s.dots.length; i += 2) ctx.fillRect(s.dots[i], s.dots[i + 1], 1, 1, 1);
  const pos = walk ? posAt(walk, now) : null;
  const standing = pos && !pos.moving ? pos.at : -1;
  const n = Math.min(places.length, layout.cells.length);
  for (let i = 0; i < n; i++) {
    const p = places[i];
    const r = cellRect(layout.cells[i]);
    const look = placeGlyph(p, { here: pulse && p.state === 'current', avatar: i === standing });
    blit(ctx, look, r.x + GLYPH_DX, r.y, 1);
  }
  if (pos && pos.moving) drawWalker(ctx, pos.x, pos.y, Math.floor(pos.s * 2));
}
