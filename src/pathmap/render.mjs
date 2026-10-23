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
import { BUILDINGS, ALIASES, ISLAND_VARIANTS } from './places.mjs';

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

/*
 * Every shape a place can take: the world's islands and the bodies above,
 * and the buildings of an island map (places.mjs), padded into the same box.
 */
const pad = (rows) => {
  const out = rows.map((r) => r.padEnd(GLYPH_W, '.'));
  while (out.length < GLYPH_H) out.push('.'.repeat(GLYPH_W));
  return out;
};
export const SHAPES = {};
for (const k in BODIES) SHAPES[k] = BODIES[k];
for (const k in BUILDINGS) SHAPES[k] = pad(BUILDINGS[k]);

/* On an island map the fort and the chest stand on the land (places.mjs). */
const ISLAND_SHAPES = {};
for (const k in ISLAND_VARIANTS) ISLAND_SHAPES[k] = pad(ISLAND_VARIANTS[k]);
const shapeRows = (kind, island) => (island && ISLAND_SHAPES[kind]) || SHAPES[kind];

/* The shape a kind draws as: aliases resolved, unknown kinds a plain place. */
export const shapeKind = (kind) => {
  const k = ALIASES[kind] || kind;
  return SHAPES[k] ? k : 'place';
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
for (const k in SHAPES) GROUND_LEVELS[k] = groundRows(SHAPES[k]).length;
const ISLAND_LEVELS = {};
for (const k in ISLAND_SHAPES) ISLAND_LEVELS[k] = groundRows(ISLAND_SHAPES[k]).length;

/* The flag pole runs down column 2 to the body, standing on its left
 * shoulder, a column in from the wall so the two never read as one line. */
const poleEnd = (body, x = POLE_X) => {
  let y = 0;
  while (y < body.length && body[y][x] === '.') y++;
  return y;
};

/*
 * Where a shape flies its flag: { x, end, pennant }, the pole in column x
 * from the top down to row `end` (where it stands on the body) and the
 * pennant's pixels. The world's shapes fly it on their left shoulder; a
 * building finds its own spot -- a pole of at least 3 px standing on it, its
 * pennant (3x2, flying right or left) a pixel clear of the body and of the
 * due dot -- so a roof peak never runs into the flag. The pole itself may
 * touch the roof it stands on.
 */
const flagCache = new Map();
export function flagOf(kind, island = false) {
  const k = shapeKind(kind);
  const key = k + (island ? '@i' : '');
  let f = flagCache.get(key);
  if (f) return f;
  const body = shapeRows(k, island);
  if (!BUILDINGS[k] && !(island && ISLAND_SHAPES[k])) {
    f = { x: POLE_X, end: poleEnd(body), pennant: PENNANT };
  } else {
    const near = (x, y) => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) if (body[y + dy] && body[y + dy][x + dx] && body[y + dy][x + dx] !== '.') return true;
      }
      return false;
    };
    const flies = [];
    for (const x of [2, 3, 1, 4]) {
      for (const dir of [1, -1]) {
        const pennant = [];
        for (let i = 1; i <= 3; i++) for (let y = 0; y < 2; y++) pennant.push([x + dir * i, y]);
        flies.push({ x, end: poleEnd(body, x), pennant });
      }
    }
    f = flies.find((c) => c.end >= 3
      && c.pennant.every(([px, py]) => px >= 0 && px <= DUE[0][0] - 2 && !near(px, py)))
      || { x: POLE_X, end: poleEnd(body), pennant: PENNANT };
  }
  flagCache.set(key, f);
  return f;
}

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
export function glyphRows(kind, look, level, { due = false, here = false, flag = false, avatar = false, island = false } = {}) {
  const body = shapeRows(shapeKind(kind), island);
  const lit = new Set(groundRows(body).slice(0, level));
  const grid = body.map((row, y) => [...row].map((ch, x) => {
    if (ch === '#') return look === 'solid' || (x + y) % 2 === 0;
    if (ch === 'x') return look === 'solid' && !lit.has(y);
    if (ch === 'o') return look === 'solid' ? lit.has(y) : look === 'dotted' && y % 2 === 0;
    return false;
  }));
  const mark = (pts) => { for (const [x, y] of pts) grid[y][x] = true; };
  if (flag) {
    const f = flagOf(kind, island);
    for (let y = 0; y < f.end; y++) grid[y][f.x] = true;
    mark(f.pennant);
  }
  if (due) mark(DUE);
  if (avatar) {
    AVATAR_ROWS.stand.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '#') grid[STAND_Y + y][STAND_X + x] = true; }));
  } else if (here) {
    mark(HERE);
  }
  return grid.map((r) => r.map((v) => (v ? '#' : '.')).join(''));
}

/* How one place is drawn on one frame: its look, fill, markers and the key
 * its glyph and its route keep-out are cached under. */
function lookOf(place, here, avatar, island) {
  const look = LOOK[place.state] || 'solid';
  const kind = shapeKind(place.kind);
  const isle = island && !!ISLAND_SHAPES[kind];
  const levels = isle ? ISLAND_LEVELS[kind] : GROUND_LEVELS[kind];
  const level = look === 'solid' ? fillLevel(place.percent, levels) : 0;
  const due = place.due > 0;
  const flag = place.state === 'done';
  const key = `${kind}|${look}|${level}|${due ? 1 : 0}|${here ? 1 : 0}|${flag ? 1 : 0}|${avatar ? 1 : 0}|${isle ? 1 : 0}`;
  return { key, kind, look, level, opts: { due, here, flag, avatar, island: isle } };
}

const glyphCache = new Map();
function glyphOf(g) {
  let rects = glyphCache.get(g.key);
  if (!rects) {
    rects = compile(glyphRows(g.kind, g.look, g.level, g.opts));
    glyphCache.set(g.key, rects);
  }
  return rects;
}

/* The compiled glyph for a place, from the cache. */
export function placeGlyph(place, { here = false, avatar = false, island = false } = {}) {
  return glyphOf(lookOf(place, here, avatar, island));
}

/* ---- Water and route ----------------------------------------------------- */

/* A ripple, set in open water on the world map so the dark reads as sea. */
const WAVE = compile(['.##..', '#..##']);
/* The island's corner ripples: the same wave in two strokes. */
const RIPPLE = compile(['.##..', '...##']);

/*
 * Masks round a place, MASK_W x MASK_H, indexed from (-1, -1): every pixel
 * marked lights itself and the eight round it.
 */
const MASK_W = GLYPH_W + 2;
const MASK_H = GLYPH_H + 2;
function dilating(mask) {
  return (x, y) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) mask[(y + dy + 1) * MASK_W + x + dx + 1] = 1;
    }
  };
}

/*
 * Where the route stays out of a place on one frame: a pixel round what the
 * place draws on it -- its shape, every wall and its ground whether filled or
 * not (a dot on an empty ground would read as fill), and its flag, due dot,
 * marker and avatar only when they are drawn. An empty flag spot or avatar
 * spot hides nothing, so a route coming down onto the ground stays unbroken;
 * a flag, marker or avatar that appears covers it only where it is drawn.
 */
const routeClearCache = new Map();
function routeClearOf(g) {
  let mask = routeClearCache.get(g.key);
  if (!mask) {
    mask = new Uint8Array(MASK_W * MASK_H);
    const lit = dilating(mask);
    shapeRows(g.kind, g.opts.island).forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') lit(x, y); }));
    glyphRows(g.kind, g.look, g.level, g.opts).forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '#') lit(x, y); }));
    routeClearCache.set(g.key, mask);
  }
  return mask;
}

/*
 * Everything a place may ever light, a pixel round: its shape, its flag
 * where it flies (the pole only down to where it stands) and its due dot --
 * and with `slot`, the avatar's spot. The coast breaks round it, and no
 * route may run into a place it does not join (the layouts are checked
 * against it). Each place keeps clear of its own kind only, on both maps.
 */
function keepClear(kinds, slot = false, island = false) {
  const mask = new Uint8Array(MASK_W * MASK_H);
  const lit = dilating(mask);
  for (const k of kinds) {
    shapeRows(k, island).forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') lit(x, y); }));
    /* Its flag, where it flies: on an island each building has its own spot. */
    const f = flagOf(k, island);
    for (const [x, y] of f.pennant) lit(x, y);
    for (let y = 0; y < f.end; y++) lit(f.x, y);
  }
  for (const [x, y] of DUE) lit(x, y);
  if (slot) {
    for (let y = 0; y <= STAND_Y + AVATAR_H; y++) for (let x = STAND_X; x < STAND_X + AVATAR_W; x++) lit(x, y);
  }
  return mask;
}
const clearCache = new Map();
/* The keep-out of one kind, cached: on a map of either kind. */
function clearOf(kind, island, slot = false) {
  const key = `${kind}|${island ? 1 : 0}|${slot ? 1 : 0}`;
  let m = clearCache.get(key);
  if (!m) {
    m = keepClear([kind], slot, island);
    clearCache.set(key, m);
  }
  return m;
}

/*
 * Everything place i of `layout` may ever light, a pixel round, as a set of
 * screen pixels (for the tests and the scene player).
 */
export function placeKeepOut(layout, i, kind) {
  const island = layout.kind === 'island';
  const m = clearOf(shapeKind(kind), island);
  const r = cellRect(layout.cells[i], layout.kind);
  const out = new Set();
  for (let gy = -1; gy <= GLYPH_H; gy++) {
    for (let gx = -1; gx <= GLYPH_W; gx++) {
      if (m[(gy + 1) * MASK_W + gx + 1]) out.add((r.y + gy) * 128 + r.x + GLYPH_DX + gx);
    }
  }
  return out;
}
/* Whether (x, y) is inside the mask of any place of `layout` (a cell with
 * no place has none). */
function nearPlace(layout, masks, x, y) {
  for (let i = 0; i < layout.cells.length; i++) {
    if (!masks[i]) continue;
    const r = cellRect(layout.cells[i], layout.kind);
    const gx = x - r.x - GLYPH_DX;
    const gy = y - r.y;
    if (gx >= -1 && gx <= GLYPH_W && gy >= -1 && gy <= GLYPH_H && masks[i][(gy + 1) * MASK_W + gx + 1]) return true;
  }
  return false;
}

/*
 * The route as dots, 1px every 2, on the even diagonal so corners stay in
 * step -- at sea and on an island alike: every dot of the route, each once.
 */
function routePoints(layout) {
  const seen = new Set();
  const dots = [];
  for (let i = 1; i < layout.route.length; i++) {
    const a = cellCentre(layout.route[i - 1], layout.kind);
    const b = cellCentre(layout.route[i], layout.kind);
    const dx = Math.sign(b.x - a.x);
    const dy = Math.sign(b.y - a.y);
    for (let x = a.x, y = a.y; ; x += dx, y += dy) {
      const k = y * 256 + x;
      if ((x + y) % 2 === 0 && !seen.has(k)) dots.push(x, y);
      seen.add(k);
      if (x === b.x && y === b.y) break;
    }
  }
  return dots;
}

/* The route's dots on one frame, given how each place is drawn on it: cached
 * per scene and per set of looks, so a frame like the last costs nothing. */
function routeDots(layout, s, looks) {
  const key = looks.map((g) => g.key).join(';');
  let dots = s.dots.get(key);
  if (!dots) {
    const masks = looks.map(routeClearOf);
    dots = [];
    for (let i = 0; i < s.route.length; i += 2) {
      if (!nearPlace(layout, masks, s.route[i], s.route[i + 1])) dots.push(s.route[i], s.route[i + 1]);
    }
    s.dots.set(key, dots);
  }
  return dots;
}

/* ---- The island: one landmass ---------------------------------------------- */
/*
 * An island map is one island: a coast round the map area, 2 px inside its
 * edge with rounded corners, the sea's ripples outside it, the land inside
 * left plain for the buildings and the footpath. A building near the shore
 * stands in front of the coast: the coast breaks a pixel clear of it.
 */
export const COAST = Object.freeze({ x0: MAP_X + 2, y0: MAP_Y + 2, x1: MAP_X + MAP_W - 3, y1: MAP_Y + MAP_H - 3, r: 8 });

/* The land as a span per row, [left, right], for rows y0..y1. */
function landSpans() {
  const { x0, y0, x1, y1, r } = COAST;
  const spans = [];
  for (let y = y0; y <= y1; y++) {
    const dy = y < y0 + r ? y0 + r - y : y > y1 - r ? y - (y1 - r) : 0;
    const inset = dy ? r - Math.round(Math.sqrt(r * r - (dy - 0.5) * (dy - 0.5))) : 0;
    spans.push([x0 + inset, x1 - inset]);
  }
  return spans;
}
const LAND = landSpans();
const onLand = (x, y) => {
  const s = LAND[y - COAST.y0];
  return !!s && x >= s[0] && x <= s[1];
};

/* The ripples of the sea round the island: one in each corner, where the
 * coast rounds off, wherever it fits a pixel clear of the land. */
const SEA_WAVES = (() => {
  const out = [];
  const fits = (x, y) => {
    for (let yy = y - 1; yy <= y + 2; yy++) {
      for (let xx = x - 1; xx <= x + 5; xx++) if (onLand(xx, yy)) return false;
    }
    return true;
  };
  const right = MAP_X + MAP_W - 5;
  const bottom = MAP_Y + MAP_H - 2;
  for (const [x, y] of [[MAP_X, MAP_Y], [right, MAP_Y], [MAP_X, bottom], [right, bottom]]) {
    if (fits(x, y)) out.push(x, y);
  }
  return out;
})();

/* The coast as rects, broken round the places, for one layout and its kinds. */
function coastRects(layout, masks) {
  const rows = [];
  for (let y = MAP_Y; y < MAP_Y + MAP_H; y++) {
    let row = '';
    for (let x = MAP_X; x < MAP_X + MAP_W; x++) {
      const edge = onLand(x, y) && (!onLand(x - 1, y) || !onLand(x + 1, y) || !onLand(x, y - 1) || !onLand(x, y + 1));
      row += edge && !nearPlace(layout, masks, x, y) ? '#' : '.';
    }
    rows.push(row);
  }
  return compile(rows).map(([x, y, w, h]) => [x + MAP_X, y + MAP_Y, w, h]);
}

/*
 * Per layout and the kinds on it, computed once: the route's points (its
 * dots per set of looks, as frames ask for them), and the world's ripples
 * or the island's coast.
 */
const sceneCache = new WeakMap();

function scene(layout, places, island) {
  let byKinds = sceneCache.get(layout);
  if (!byKinds) {
    byKinds = new Map();
    sceneCache.set(layout, byKinds);
  }
  const kinds = layout.cells.map((_, i) => shapeKind(places[i] ? places[i].kind : 'place'));
  const key = (island ? 'i:' : 'w:') + kinds.join(',');
  let s = byKinds.get(key);
  if (s) return s;
  const route = routePoints(layout);
  if (island) {
    const coastMasks = kinds.map((k) => clearOf(k, true, true));
    s = { route, dots: new Map(), waves: SEA_WAVES, coast: coastRects(layout, coastMasks) };
  } else {
    const onRoute = new Set(layout.route.map((c) => c.row * COLS + c.col));
    const waves = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if ((col + row) % 2 || onRoute.has(row * COLS + col)) continue;
        const r = cellRect({ col, row });
        /* Jittered so the sea does not read as a grid. */
        waves.push(r.x + 3 + ((col * 7 + row * 3) % 6), r.y + 3 + ((col + row * 2) % 3) * 2);
      }
    }
    s = { route, dots: new Map(), waves, coast: null };
  }
  byKinds.set(key, s);
  return s;
}

/* ---- The map ------------------------------------------------------------- */

/*
 * state = { places, layout, walk, now, pulse, kind }
 *   places  model places, one per layout cell
 *   walk    the avatar (walk.mjs); none, no avatar
 *   pulse   the blink phase of the current place's marker (default on)
 *   kind    'world' (islands in the sea) or 'island' (one island, its places
 *           as buildings); the layout's own kind by default
 *   route   false leaves the route's dots out (a celebration over the map)
 *
 * The world map's open water ripples. An island map is one landmass: its
 * coast, the sea round it, and plain land inside.
 */
export function drawMap(ctx, { places, layout, walk = null, now = 0, pulse = true, kind = layout.kind || 'world', route = true }) {
  ctx.fillRect(MAP_X, MAP_Y, MAP_W, MAP_H, 0);
  const island = kind === 'island';
  const s = scene(layout, places, island);
  let sea = island;
  for (let i = 0; i < places.length && !sea; i++) if (places[i].kind === 'island') sea = true;
  if (sea) {
    const wave = island ? RIPPLE : WAVE;
    for (let i = 0; i < s.waves.length; i += 2) blit(ctx, wave, s.waves[i], s.waves[i + 1], 1);
  }
  if (s.coast) blit(ctx, s.coast, 0, 0, 1);
  const pos = walk ? posAt(walk, now) : null;
  const standing = pos && !pos.moving ? pos.at : -1;
  const n = Math.min(places.length, layout.cells.length);
  const looks = [];
  for (let i = 0; i < n; i++) looks.push(lookOf(places[i], pulse && places[i].state === 'current', i === standing, island));
  if (route) {
    const dots = routeDots(layout, s, looks);
    for (let i = 0; i < dots.length; i += 2) ctx.fillRect(dots[i], dots[i + 1], 1, 1, 1);
  }
  for (let i = 0; i < n; i++) {
    const r = cellRect(layout.cells[i], layout.kind);
    blit(ctx, glyphOf(looks[i]), r.x + GLYPH_DX, r.y, 1);
  }
  if (pos && pos.moving) drawWalker(ctx, pos.x, pos.y, Math.floor(pos.s * 2));
}
