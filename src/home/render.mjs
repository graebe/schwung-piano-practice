// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * render.mjs — the home screen: five circles with icons, the selected one
 * filled and grown, its label underneath.
 *
 * drawHome draws the band between the title bar and the hint line (y 10..54);
 * both of those are the module's own chrome.
 *
 * Circles and icons are compiled once into rectangles (horizontal runs,
 * merged downwards where they repeat), the same idea as src/pathmap/render.mjs
 * and copied here rather than imported, so this folder stands alone. A circle
 * is a midpoint circle per radius: its outline collapses to ~12 rects, its
 * fill to one rect per distinct row. A frame is ~70 ctx calls.
 *
 * The grow is a function of the time passed in: the circle the jog lands on
 * grows from r 9 to r 12 over GROW_MS with an ease-out, the one it left
 * shrinks back, and an icon switches to its large size at r >= 11.
 *
 * ctx: { fillRect(x,y,w,h,v), drawRect(x,y,w,h,v), line(x0,y0,x1,y1,v),
 *        text(x,y,s,v), textWidth(s) }   (fillRect, text, textWidth here)
 *
 * Pure: imports only its siblings. Vendored byte for byte into Drums Practice.
 */

import { ICONS } from './icons.mjs';

export const HOME_X = Object.freeze([13, 38, 64, 90, 115]);
export const HOME_Y = 30;
export const HOME_COUNT = HOME_X.length;
export const R_SMALL = 9;
export const R_LARGE = 12;
/* At this radius and above a circle carries the large icon. */
export const ICON_SWITCH_R = 11;
export const LABEL_Y = 46;
export const GROW_MS = 160;
/* The band drawHome owns: below the title bar, above the hint line. */
export const BAND_Y = 10;
export const BAND_H = 45;
/* One pad per circle, left to right: the bottom row, columns 1..5. */
export const HOME_PADS = Object.freeze([69, 70, 71, 72, 73]);

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

/* [dx, dy, w, h] rectangles: a run repeated on the next row extends the one
 * above it. */
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

/* ---- Circles ------------------------------------------------------------- */

/*
 * The midpoint circle of radius r as ASCII rows, (2r+1) square, centre at
 * (r, r): `outline` is the 1 px ring, `fill` the disc it bounds.
 */
export function circleRows(r) {
  const n = 2 * r + 1;
  const ring = Array.from({ length: n }, () => new Array(n).fill('.'));
  let x = r;
  let y = 0;
  let d = 1 - r;
  while (x >= y) {
    for (const [px, py] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]]) {
      ring[r + py][r + px] = '#';
    }
    y++;
    if (d < 0) {
      d += 2 * y + 1;
    } else {
      x--;
      d += 2 * (y - x) + 1;
    }
  }
  const outline = ring.map((row) => row.join(''));
  const fill = outline.map((row) => {
    const a = row.indexOf('#');
    const b = row.lastIndexOf('#');
    return '.'.repeat(a) + '#'.repeat(b - a + 1) + '.'.repeat(n - 1 - b);
  });
  return { outline, fill };
}

const circleCache = new Map();

/* The compiled circle of radius r, { outline, fill } as rects, cached. */
export function circleRuns(r) {
  let c = circleCache.get(r);
  if (!c) {
    const rows = circleRows(r);
    c = { outline: compile(rows.outline), fill: compile(rows.fill) };
    circleCache.set(r, c);
  }
  return c;
}

/* ---- Icons --------------------------------------------------------------- */

const iconCache = new Map();

/*
 * An item's icon at one size: `icon` is a key into ICONS, or an icon the
 * module passes in ({ small: rows, large: rows }), as the practice icon is.
 */
export function iconRows(icon, large) {
  const set = typeof icon === 'string' ? ICONS[icon] : icon;
  if (!set) return null;
  return large ? set.large : set.small;
}

function iconRects(rows) {
  let rects = iconCache.get(rows);
  if (!rects) {
    rects = compile(rows);
    iconCache.set(rows, rects);
  }
  return rects;
}

/* ---- Grow ---------------------------------------------------------------- */

/* A home screen at rest on circle `selected`. */
export function createGrow(selected = 0) {
  return { from: selected, to: selected, fromR: R_SMALL, t0: -Infinity };
}

const easeOut = (u) => 1 - (1 - u) * (1 - u);
const progress = (grow, now) => Math.min(1, Math.max(0, (now - grow.t0) / GROW_MS));

/*
 * Select circle `to` at `now`: it grows, the one selected so far shrinks from
 * whatever size it has reached. Mutates and returns `grow`.
 */
export function startGrow(grow, to, now) {
  if (to === grow.to) return grow;
  const fromR = radiusAt(grow, grow.to, now);
  grow.from = grow.to;
  grow.fromR = fromR;
  grow.to = to;
  grow.t0 = now;
  return grow;
}

/* The radius of circle i at `now`, a whole pixel. */
export function radiusAt(grow, i, now) {
  const e = easeOut(progress(grow, now));
  if (i === grow.to) return Math.round(R_SMALL + (R_LARGE - R_SMALL) * e);
  if (i === grow.from) return Math.round(grow.fromR + (R_SMALL - grow.fromR) * e);
  return R_SMALL;
}

/* Every circle's radius at `now`. */
export function growAt(grow, now, count = HOME_COUNT) {
  const out = new Array(count);
  for (let i = 0; i < count; i++) out[i] = radiusAt(grow, i, now);
  return out;
}

/* Whether the grow is still running: the module keeps `dirty` while it is. */
export function growing(grow, now) {
  return now - grow.t0 < GROW_MS;
}

/* ---- The screen ---------------------------------------------------------- */

/* The circle a pad opens, or -1. */
export function itemOfPad(note) {
  return HOME_PADS.indexOf(note);
}

/*
 * state = { items, selected, grow, now }
 *   items     [{ key, label, icon }], up to five, left to right
 *   selected  the chosen circle (grow.to wins when a grow is given)
 *   grow      from createGrow/startGrow; none, every circle at rest
 *
 * The selected circle is filled and its icon cut out of it; the rest are
 * rings with the icon drawn lit.
 */
export function drawHome(ctx, { items, selected = 0, grow = null, now = 0 }) {
  ctx.fillRect(0, BAND_Y, 128, BAND_H, 0);
  const sel = grow ? grow.to : selected;
  const n = Math.min(items.length, HOME_COUNT);
  for (let i = 0; i < n; i++) {
    const r = grow ? radiusAt(grow, i, now) : i === sel ? R_LARGE : R_SMALL;
    const cx = HOME_X[i];
    const filled = i === sel;
    const c = circleRuns(r);
    blit(ctx, filled ? c.fill : c.outline, cx - r, HOME_Y - r, 1);
    const rows = iconRows(items[i].icon, r >= ICON_SWITCH_R);
    if (rows) {
      const half = rows.length >> 1;
      blit(ctx, iconRects(rows), cx - half, HOME_Y - half, filled ? 0 : 1);
    }
  }
  const item = items[sel];
  if (item && item.label) {
    ctx.text((128 - ctx.textWidth(item.label)) >> 1, LABEL_Y, item.label, 1);
  }
}
