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
 * A place is 15x11, the full height and all but one column of its cell,
 * drawn at (cell.x, cell.y). Its body sits on the left (columns 1..9); the
 * ground runs on to the right, where the avatar stands with its feet on row 8,
 * so the figure lives in the sky beside the body and never covers it. On the
 * world map the body is a dome hill on a beach that tapers into the sea at
 * both ends.
 *
 *   flag (done)   pole on the body's left shoulder, pennant 3x2 to its right
 *   due dot       2x2 at columns 7..8, rows 0..1
 *   avatar        5x7 at columns 10..14, rows 1..7, feet on the ground
 *   current       a down-arrow in the avatar's spot when it is elsewhere
 *
 * Body legend: '#' coast or wall, always drawn; 'o' ground that fills from the
 * bottom with the place's percentage; 'x' a lock, drawn as the inverse of the
 * ground behind it, so it shows on an empty chest and a full one alike; '.'
 * never drawn (water, a gate, a door).
 */
export const GLYPH_W = 15;
export const GLYPH_H = 11;
export const GLYPH_DX = 0;

export const BODIES = {
  /* An island of the world map: a dome hill on a beach that runs into the sea
   * at both ends. */
  island: [
    '...............',
    '...............',
    '...............',
    '....###........',
    '..##ooo##......',
    '.#ooooooo#.....',
    '.#ooooooo#.....',
    '.#ooooooo#.....',
    '.#############.',
    '#.............#',
    '...............',
  ],
  /* A place on an island: the same hill, on level ground. */
  place: [
    '...............',
    '...............',
    '...............',
    '....###........',
    '..##ooo##......',
    '.#ooooooo#.....',
    '.#ooooooo#.....',
    '.#ooooooo#.....',
    '###############',
    '...............',
    '...............',
  ],
  /* The checkpoint: battlements, a gate, and a rampart. */
  fort: [
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
    '.#.#.#.#.#.....',
    '.#ooooooo#.....',
    '.#ooooooo#.....',
    '.#ooooooo#####.',
    '.#ooo.ooooooo#.',
    '.####.########.',
  ],
  /* The lessons: a hut, gable and door, with a yard. */
  hut: [
    '...............',
    '...............',
    '...............',
    '.....#.........',
    '....#o#........',
    '...#ooo#.......',
    '..#ooooo#......',
    '.#########.....',
    '..#ooooo######.',
    '..#oo.oo#oooo#.',
    '..###.########.',
  ],
  /* The electives (kind 'cove'): a treasure chest -- domed lid, band, lock --
   * beside a patch of sand. */
  cove: [
    '...............',
    '...............',
    '...............',
    '...............',
    '...#####.......',
    '..#ooooo#......',
    '.#ooooooo#.....',
    '.###xxx###.....',
    '.#oooxooo######',
    '.#ooooooo#oooo#',
    '.##############',
  ],
};

/* Marker pixels, [x, y] in glyph coordinates. */
const POLE_X = 2;
const PENNANT = [[3, 0], [4, 0], [5, 0], [3, 1], [4, 1], [5, 1]];
const DUE = [[7, 0], [8, 0], [7, 1], [8, 1]];
const HERE = [[11, 3], [12, 3], [13, 3], [12, 4]];

/*
 * How a state is drawn:
 *   solid   coast drawn, ground filled by percent (fresh, started, current, done)
 *   dotted  coast every other pixel, ground hatched: assumed known (skipped)
 *   sparse  coast every other pixel, no ground: not reached yet (ahead)
 */
const LOOK = { done: 'solid', current: 'solid', started: 'solid', fresh: 'solid', skipped: 'dotted', ahead: 'sparse' };

/* The rows of the ground, bottom first: the rows a fill level lights. */
function groundRows(body) {
  const ys = [];
  for (let y = body.length - 1; y >= 0; y--) if (/[ox]/.test(body[y])) ys.push(y);
  return ys;
}
const GROUND_LEVELS = {};
for (const k in BODIES) GROUND_LEVELS[k] = groundRows(BODIES[k]).length;

/* The flag pole runs down column 2 to the body, standing on its left
 * shoulder, a column in from the wall so the two never read as one line. */
const poleEnd = (body) => {
  let y = 0;
  while (y < body.length && body[y][POLE_X] === '.') y++;
  return y;
};

/* ---- Avatar -------------------------------------------------------------- */
/*
 * 5x7: head, arms, body, legs. It always stands with its feet on the ground
 * line at its anchor (layout.mjs's cellCentre): on a place that is the spit,
 * so standing it is part of the place's compiled glyph and costs nothing. Walking,
 * it is drawn lit on a cleared tile, so the route and the coasts it crosses
 * never run into it, and its legs swap once per cell.
 */
export const AVATAR_W = 5;
export const AVATAR_H = 7;
const STANDING = ['.###.', '.###.', '..#..', '#####', '..#..', '.#.#.', '.#.#.'];
export const AVATAR_ROWS = {
  stand: STANDING,
  walkA: STANDING,
  walkB: ['.###.', '.###.', '..#..', '#####', '..#..', '..#..', '..#..'],
};
/* Where the standing figure sits in a glyph: on the ground right of the body,
 * feet on row 8 (layout.mjs's CENTRE_DY). */
export const STAND_X = 10;
export const STAND_Y = 1;
const AVATAR = {};
for (const k in AVATAR_ROWS) AVATAR[k] = compile(AVATAR_ROWS[k]);

/* The walking figure, feet on (x, y): the anchor of posAt. */
export function drawWalker(ctx, x, y, stride = 0) {
  const tx = x - (AVATAR_W >> 1);
  const ty = y - AVATAR_H;
  ctx.fillRect(tx - 1, ty, AVATAR_W + 2, AVATAR_H, 0);
  blit(ctx, stride % 2 ? AVATAR.walkB : AVATAR.walkA, tx, ty, 1);
}

/* One look of one place as ASCII rows (exported for the preview and tests). */
export function glyphRows(kind, look, level, { due = false, here = false, flag = false, avatar = false } = {}) {
  const body = BODIES[kind] || BODIES.place;
  const lit = new Set(groundRows(body).slice(0, level));
  const grid = body.map((row, y) => [...row].map((ch, x) => {
    if (ch === '#') return look === 'solid' || (x + y) % 2 === 0;
    if (ch === 'x') return look === 'solid' && !lit.has(y);
    if (ch === 'o') return look === 'solid' ? lit.has(y) : look === 'dotted' && y % 2 === 0;
    return false;
  }));
  const mark = (pts) => { for (const [x, y] of pts) grid[y][x] = true; };
  if (flag) {
    for (let y = 0; y < poleEnd(body); y++) grid[y][POLE_X] = true;
    mark(PENNANT);
  }
  if (due) mark(DUE);
  if (avatar) {
    AVATAR_ROWS.stand.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '#') grid[STAND_Y + y][STAND_X + x] = true; }));
  } else if (here) {
    mark(HERE);
  }
  return grid.map((r) => r.map((v) => (v ? '#' : '.')).join(''));
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
 * Where the route stays out of a place: a pixel round anything any kind of
 * body or the flag and due markers can light, so the route reaches a place's
 * coast but never touches it. The avatar's spot is left open, so a route
 * arriving from above comes down onto the spit; the spot is cleared when the
 * avatar or the current marker is in it. Indexed from (-1, -1).
 */
const KEEP_CLEAR = (() => {
  const w = GLYPH_W + 2;
  const mask = new Uint8Array(w * (GLYPH_H + 2));
  const lit = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) mask[(y + dy + 1) * w + x + dx + 1] = 1;
    }
  };
  for (const k in BODIES) {
    BODIES[k].forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') lit(x, y); }));
  }
  for (const [x, y] of [...PENNANT, ...DUE]) lit(x, y);
  for (let y = 0; y < GLYPH_H; y++) lit(POLE_X, y);
  return mask;
})();
/* The avatar's spot and the sky above it, cleared under the figure or the
 * marker so a route coming down never touches its head. */
const SLOT = [STAND_X, 0, AVATAR_W, STAND_Y + AVATAR_H];

/*
 * Per layout, computed once: the route as dots (1px every 2, on the even
 * diagonal so corners stay in step) kept clear of every place, and the
 * open-water cells that get a ripple.
 */
const sceneCache = new WeakMap();

function scene(layout) {
  let s = sceneCache.get(layout);
  if (s) return s;
  const onRoute = new Set(layout.route.map((c) => c.row * COLS + c.col));
  const inPlace = (x, y) => {
    for (const c of layout.cells) {
      const r = cellRect(c);
      const gx = x - r.x - GLYPH_DX;
      const gy = y - r.y;
      if (gx >= -1 && gx <= GLYPH_W && gy >= -1 && gy <= GLYPH_H && KEEP_CLEAR[(gy + 1) * (GLYPH_W + 2) + gx + 1]) return true;
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
    const here = pulse && p.state === 'current';
    const avatar = i === standing;
    if (here || avatar) ctx.fillRect(r.x + GLYPH_DX + SLOT[0], r.y + SLOT[1], SLOT[2], SLOT[3], 0);
    blit(ctx, placeGlyph(p, { here, avatar }), r.x + GLYPH_DX, r.y, 1);
  }
  if (pos && pos.moving) drawWalker(ctx, pos.x, pos.y, Math.floor(pos.s * 2));
}
