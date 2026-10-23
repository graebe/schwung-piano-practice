// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * layout.mjs — where the places of a Path map sit, and the route between them.
 *
 * The map IS the pad grid: 8 columns by 4 rows of cells, each 16x11 px, so a
 * place is drawn directly above the pad that walks to it. Screen row 0 is the
 * top; pad row 0 is the bottom, so screen cell (row r, col c) is pad note
 * 68 + (3 - r) * 8 + c.
 *
 * The route is a 4-connected chain of cells from the first place to the last,
 * through every place in order. The avatar walks it cell by cell, and the
 * renderer dots it.
 *
 * Small maps are drawn by hand, as pictures (MAPS below), because a route that
 * winds between islands with water around each is a composition, not a
 * formula. Everything else falls back to a serpentine. Layouts are memoised
 * and frozen: the same n always returns the same object, which is what lets
 * the renderer cache its route dots against it.
 *
 * Pure: no imports, no host calls. Vendored byte for byte into Drums Practice.
 */

export const COLS = 8;
export const ROWS = 4;
export const CELL_W = 16;
export const CELL_H = 11;
export const MAP_X = 0;
export const MAP_Y = 10;
export const MAP_W = COLS * CELL_W;
export const MAP_H = ROWS * CELL_H;
export const PAD_FIRST = 68;
export const MAX_PLACES = COLS * ROWS;

/*
 * A cell's anchor, where the route runs and the avatar's feet stand: on the
 * ground line right of a place's body (render.mjs draws the body on the left
 * of the cell and the avatar above the ground beside it).
 */
export const CENTRE_DX = 12;
export const CENTRE_DY = 8;

/*
 * Hand-drawn maps, one per place count. Read them as the screen: four rows of
 * eight cells, top row first. 1..9 are the places in order, '.' is open water,
 * and an arrow is a route cell (water the route crosses) pointing to the next
 * cell of the walk. Out of a place the walk takes its one route neighbour it
 * has not walked yet -- or, where another route passes close by, the one
 * whose arrows lead to the next place. tests/pathmap_layout.test.mjs holds
 * every picture to that.
 *
 * Every place has open water or its own route on all four sides, so islands
 * never touch. The journey starts low on the left, over the pad nearest the
 * player's hands, and travels right; the hops between places are kept even
 * (2-3 cells on the world maps, 5 and 7), so the walk has a rhythm.
 */
const MAPS = {
  1: [
    '........',
    '...1....',
    '........',
    '........',
  ],
  2: [
    '........',
    '.....2..',
    '..1>>^..',
    '........',
  ],
  3: [
    '......3.',
    '...2>>^.',
    '...^....',
    '.1>^....',
  ],
  4: [
    '......4.',
    '..2>v.^.',
    '..^.3>^.',
    '1>^.....',
  ],
  5: [
    '..>3>v..',
    '..^..4>v',
    '..2....5',
    '1>^.....',
  ],
  6: [
    '...3v...',
    '.2>^v..6',
    '.^..4..^',
    '1^..>>5^',
  ],
  7: [
    '..3>>4..',
    '.2^..v.7',
    '.^...5.^',
    '1^...>6^',
  ],
  8: [
    '..3>>4.8',
    '.2^..v.^',
    '.^...5.7',
    '1^...>6^',
  ],
  9: [
    '.>3v.>7v',
    '2^.4.^.8',
    '^..v.6.v',
    '1..>5^.9',
  ],
};

/*
 * Island maps: the places of one stage, on one island. Same pictures, a
 * different shape -- a loop round the island: from low on the left it
 * climbs, runs along the top, comes down the right and back along the
 * bottom, and from seven places on the last (the fort) stands in the middle,
 * in row 2, so the path along the top never runs over it.
 * The last leg comes into the fort from the right, along its ground line,
 * where its gate is: a path that came down or up onto it would stop beside
 * the fort (its anchor is the avatar's spot, right of the building) and
 * read as cut off. So the route comes round to the fort's right and runs
 * straight at it over open ground.
 * The four corner cells stay empty, where the coast rounds off into the sea.
 * No island picture uses the cells of the world map with the same count.
 */
const ISLANDS = {
  1: [
    '........',
    '........',
    '....1...',
    '........',
  ],
  2: [
    '.>>>>>v.',
    '.^....v.',
    '.^...2<.',
    '.1......',
  ],
  3: [
    '.>2>>>v.',
    '.^....v.',
    '.^...3<.',
    '.1......',
  ],
  4: [
    '.>>>3>v.',
    '2^....>v',
    '^<....4<',
    '.1......',
  ],
  5: [
    '.>>3>>v.',
    '2^....4.',
    '^<....v.',
    '.1...5<.',
  ],
  6: [
    '.>>3>>4.',
    '2^....>v',
    '^<....v5',
    '.1..6<<.',
  ],
  7: [
    '.>3>>4v.',
    '2^....>v',
    '^<.7<<v5',
    '.1...6<.',
  ],
  8: [
    '.>3>4>5.',
    '2^....>v',
    '^<.8<<v6',
    '.1...7<.',
  ],
  9: [
    '.3>4>5v.',
    '2^....6v',
    '^<.9<<v7',
    '.1...8<.',
  ],
};


const STEP = { '>': [1, 0], '<': [-1, 0], v: [0, 1], '^': [0, -1] };
const isPlaceChar = (ch) => ch >= '1' && ch <= '9';

/* Turn a picture like the ones above into cells and a route. */
export function parseMap(rows, n) {
  const at = (col, row) => (row >= 0 && row < ROWS && col >= 0 && col < COLS ? rows[row][col] : '.');
  let cur = null;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) if (at(col, row) === '1') cur = { col, row };
  }
  if (!cur) throw new Error(`pathmap: map ${n} has no place 1`);
  const cells = [cur];
  const route = [cur];
  const seen = new Set([cur.row * COLS + cur.col]);
  /* Whether following the arrows from cell c ends at place `want`. */
  const leadsTo = (c, want) => {
    for (let k = 0; k <= MAX_PLACES; k++) {
      const ch = at(c.col, c.row);
      if (!STEP[ch]) return isPlaceChar(ch) && ch.charCodeAt(0) - 48 === want;
      c = { col: c.col + STEP[ch][0], row: c.row + STEP[ch][1] };
    }
    return false;
  };
  while (cells.length < n) {
    const ch = at(cur.col, cur.row);
    let next;
    if (STEP[ch]) {
      next = { col: cur.col + STEP[ch][0], row: cur.row + STEP[ch][1] };
    } else {
      let out = [];
      for (const d of Object.values(STEP)) {
        const c = { col: cur.col + d[0], row: cur.row + d[1] };
        if (STEP[at(c.col, c.row)] && !seen.has(c.row * COLS + c.col)) out.push(c);
      }
      /* Two ways out (a route passing close by): the one whose arrows lead
       * to the next place is this place's own. */
      const ways = out.length;
      if (ways > 1) out = out.filter((c) => leadsTo(c, cells.length + 1));
      if (out.length !== 1) throw new Error(`pathmap: map ${n} has ${ways} ways out of place ${cells.length}`);
      next = out[0];
    }
    const nch = at(next.col, next.row);
    if (nch === '.' || seen.has(next.row * COLS + next.col)) throw new Error(`pathmap: map ${n} runs aground at ${next.col},${next.row}`);
    if (isPlaceChar(nch)) {
      if (nch.charCodeAt(0) - 49 !== cells.length) throw new Error(`pathmap: map ${n} reaches place ${nch} out of order`);
      cells.push(next);
    }
    route.push(next);
    seen.add(next.row * COLS + next.col);
    cur = next;
  }
  return { cells, route };
}

/* Route index k of the serpentine: bottom row left to right, then up. */
function serpentineCell(k) {
  const band = Math.floor(k / COLS);
  const i = k % COLS;
  return { col: band % 2 === 0 ? i : COLS - 1 - i, row: ROWS - 1 - band };
}

/*
 * Past the hand-drawn maps: a serpentine. Up to 16 places keep a water cell
 * between neighbours (places on every other cell); more than that and the
 * places sit shoulder to shoulder, one per cell.
 */
function serpentine(n) {
  const gap = 2 * n - 1 <= MAX_PLACES ? 2 : 1;
  const length = gap * (n - 1) + 1;
  const route = [];
  for (let k = 0; k < length; k++) route.push(serpentineCell(k));
  const cells = [];
  for (let i = 0; i < n; i++) cells.push(route[i * gap]);
  return { cells, route };
}

function deepFreeze(layout) {
  for (const c of layout.cells) Object.freeze(c);
  for (const c of layout.route) Object.freeze(c);
  Object.freeze(layout.cells);
  Object.freeze(layout.route);
  Object.freeze(layout.stops);
  Object.freeze(layout.placeAt);
  return Object.freeze(layout);
}

const memo = new Map();

/*
 * The layout for n places: { n, kind, cells, route, stops, placeAt }.
 *   kind        'world' (islands in the sea, the default) or 'island' (the
 *               places of one stage, on one island)
 *   cells[i]    the cell of place i
 *   route       the cells the avatar walks, place 0 first, place n-1 last
 *   stops[i]    the index in route of place i (routeIndexOf)
 *   placeAt[k]  the place on grid cell k = row * 8 + col, or -1 for water
 *
 * Past nine places both kinds fall back to the same serpentine.
 */
export function layoutPlaces(n, { kind = 'world' } = {}) {
  if (!Number.isInteger(n) || n < 0 || n > MAX_PLACES) {
    throw new RangeError(`pathmap: ${n} places do not fit a ${COLS}x${ROWS} map`);
  }
  if (kind !== 'world' && kind !== 'island') throw new RangeError(`pathmap: no ${kind} maps`);
  const key = kind + n;
  const hit = memo.get(key);
  if (hit) return hit;
  const pictures = kind === 'island' ? ISLANDS : MAPS;
  const base = n === 0 ? { cells: [], route: [] } : pictures[n] ? parseMap(pictures[n], n) : serpentine(n);
  const placeAt = new Array(MAX_PLACES).fill(-1);
  base.cells.forEach((c, i) => { placeAt[c.row * COLS + c.col] = i; });
  const stops = base.cells.map((c) => base.route.findIndex((r) => r.col === c.col && r.row === c.row));
  const layout = deepFreeze({ n, kind, cells: base.cells, route: base.route, stops, placeAt });
  memo.set(key, layout);
  return layout;
}

/* The route index of place i: how far along the walk it is. */
export function routeIndexOf(layout, placeIndex) {
  return layout.stops[placeIndex];
}

export function padOfCell({ col, row }) {
  return PAD_FIRST + (ROWS - 1 - row) * COLS + col;
}

/* The cell above a pad, or null for a note that is not a pad. */
export function cellOfPad(note) {
  const i = note - PAD_FIRST;
  if (!Number.isInteger(i) || i < 0 || i >= MAX_PLACES) return null;
  return { col: i % COLS, row: ROWS - 1 - Math.floor(i / COLS) };
}

/* The place a pad press walks to, or -1 for a water pad. */
export function placeOfPad(layout, note) {
  const cell = cellOfPad(note);
  return cell ? layout.placeAt[cell.row * COLS + cell.col] : -1;
}

/*
 * On an island map the cells sit on a slightly tighter grid, 15 x 9 px from
 * (4, 14), so every building -- flag, roof and the avatar beside it -- stays
 * inside the island's coast (render.mjs's COAST, 2 px inside the map area).
 * The cells and their pads are the same; only where they are drawn moves.
 */
export const ISLAND_GRID = Object.freeze({ x: MAP_X + 4, y: MAP_Y + 4, w: 15, h: 9 });

export function cellRect({ col, row }, kind = 'world') {
  if (kind === 'island') {
    const g = ISLAND_GRID;
    return { x: g.x + col * g.w, y: g.y + row * g.h, w: g.w, h: g.h };
  }
  return { x: MAP_X + col * CELL_W, y: MAP_Y + row * CELL_H, w: CELL_W, h: CELL_H };
}

/* Where the route crosses a cell and the avatar's feet stand on it. */
export function cellCentre(cell, kind = 'world') {
  const r = cellRect(cell, kind);
  return { x: r.x + CENTRE_DX, y: r.y + CENTRE_DY };
}
