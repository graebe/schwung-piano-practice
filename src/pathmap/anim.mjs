// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * anim.mjs — the Path's moments in motion: a flag going up, fireworks, the
 * zoom between the world and an island, a burst of rays round a big score,
 * and the finale when the whole path is done.
 *
 * Each is a pure frame function `(ctx, args, t)`, t in ms from the start,
 * clamped to its duration, so a module plays one by calling it with now() -
 * start every frame and skipping to the end is calling it with the duration.
 * Everything random-looking comes from a seeded generator: the same seed and
 * the same t draw the same frame, on the Move, in the tests and in the
 * preview.
 *
 *   flagRise   400 ms  over the map: the place's flag climbs its pole
 *   fireworks  900 ms  over the map: three bursts round a point
 *   zoomIn     350 ms  the whole map area: an island grows from its cell to
 *   zoomOut            the map in whole-pixel scales 1, 2, 3, in a frame
 *                      that opens to 128x44 (zoomOut is the same, backwards)
 *   starBurst  600 ms  over any screen: rays round a point (a big score)
 *   finale    2500 ms  the whole map: every flag waves, fireworks over
 *                      every island in turn
 *
 * Overlays clip to the map area (starBurst to the screen), so none draws over
 * the title bar or the hint line it was not given. Every frame stays well
 * under 200 ctx calls, the finale's map included.
 *
 * LEDs: sweepColors (a wave across the pads) and sparkleColors (pads that
 * twinkle), in the same shape as leds.mjs's mapPadColors.
 *
 * Pure: imports only its siblings. Vendored byte for byte into Drums Practice.
 */

import { MAP_X, MAP_Y, MAP_W, MAP_H, COLS, MAX_PLACES, cellRect } from './layout.mjs';
import { drawMap, placeGlyph, flagOf, GLYPH_W, GLYPH_H } from './render.mjs';

export const FLAG_MS = 400;
export const FIREWORKS_MS = 900;
export const ZOOM_MS = 350;
export const STAR_MS = 600;
export const FINALE_MS = 2500;
export const SWEEP_MS = 600;

/* ---- Helpers ------------------------------------------------------------- */

/* A seeded generator (mulberry32): the same seed, the same numbers. */
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (u) => Math.min(1, Math.max(0, u));
const easeOut = (u) => 1 - (1 - u) * (1 - u);
const progress = (t, ms) => clamp01(t / ms);

const inMap = (x, y) => x >= MAP_X && x < MAP_X + MAP_W && y >= MAP_Y && y < MAP_Y + MAP_H;
function dot(ctx, x, y) {
  if (inMap(x, y)) ctx.fillRect(x, y, 1, 1, 1);
}

/* ---- Flag ---------------------------------------------------------------- */

/*
 * args = { layout, index, place }: the place's flag climbs its pole, the
 * pennant riding its top, and stops where the drawn flag of a done place
 * stands. Draw the map first with the place not yet done.
 */
export function flagRise(ctx, { layout, index, place }, t) {
  const island = layout.kind === 'island';
  const f = flagOf(place ? place.kind : island ? 'place' : 'island', island);
  const r = cellRect(layout.cells[index], layout.kind);
  const h = Math.ceil(progress(t, FLAG_MS) * f.end);
  const xs = f.pennant.map(([x]) => x);
  const px = Math.min(...xs);
  const pw = Math.max(...xs) - px + 1;
  ctx.fillRect(r.x + f.x, r.y, 1, f.end, 0);
  ctx.fillRect(r.x + px, r.y, pw, f.end, 0);
  if (h <= 0) return;
  const top = f.end - h;
  ctx.fillRect(r.x + f.x, r.y + top, 1, h, 1);
  if (h >= 2) ctx.fillRect(r.x + px, r.y + top, pw, 2, 1);
}

/* ---- Fireworks ----------------------------------------------------------- */

const BURST_MS = 400;
const BURSTS = [0, 250, 500];

/* One burst of twelve rays from (bx, by), `u` of its way through. */
function burst(ctx, bx, by, u, turn, t) {
  const r = 1 + 9 * easeOut(u);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12 + turn) * Math.PI * 2;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    /* Late in the burst the tips twinkle, every other ray in turn. */
    if (u < 0.6 || (k + Math.floor(t / 60)) % 2 === 0) dot(ctx, bx + Math.round(cx * r), by + Math.round(cy * r));
    if (u < 0.7) dot(ctx, bx + Math.round(cx * r * 0.5), by + Math.round(cy * r * 0.5));
  }
}

/* Keep a burst's 10 px of rays inside the map area. */
const fit = (x, y) => [
  Math.min(MAP_X + MAP_W - 11, Math.max(MAP_X + 10, x)),
  Math.min(MAP_Y + MAP_H - 11, Math.max(MAP_Y + 10, y)),
];

/* args = { x, y, seed }: three bursts in turn, scattered round (x, y). */
export function fireworks(ctx, { x, y, seed = 1 }, t) {
  const rand = rng(seed);
  for (let i = 0; i < BURSTS.length; i++) {
    const [bx, by] = fit(x + Math.round(rand() * 16 - 8), y - 4 + Math.round(rand() * 6 - 3));
    const turn = rand() < 0.5 ? 0 : 1 / 24;
    const u = (t - BURSTS[i]) / BURST_MS;
    if (u >= 0 && u <= 1) burst(ctx, bx, by, u, turn, t);
  }
}

/* ---- Zoom ---------------------------------------------------------------- */

/*
 * args = { cell, place }: a world map's island (place, as it is drawn there)
 * grows from its cell to the middle of the map area, in whole-pixel scales
 * 1, 2 and 3 so its pixels stay square, inside a frame that opens from the
 * cell to the whole map area. Clears and owns the map area.
 */
export function zoomIn(ctx, { cell, place }, t) {
  const e = easeOut(progress(t, ZOOM_MS));
  const u = progress(t, ZOOM_MS);
  const s = u < 1 / 3 ? 1 : u < 2 / 3 ? 2 : 3;
  const from = cellRect(cell);
  ctx.fillRect(MAP_X, MAP_Y, MAP_W, MAP_H, 0);
  /* The frame: from the cell's box to the map area's edge. */
  const fx = Math.round(from.x + (MAP_X - from.x) * e);
  const fy = Math.round(from.y + (MAP_Y - from.y) * e);
  const fw = Math.round(from.w + (MAP_W - from.w) * e);
  const fh = Math.round(from.h + (MAP_H - from.h) * e);
  ctx.fillRect(fx, fy, fw, 1, 1);
  ctx.fillRect(fx, fy + fh - 1, fw, 1, 1);
  ctx.fillRect(fx, fy, 1, fh, 1);
  ctx.fillRect(fx + fw - 1, fy, 1, fh, 1);
  /* The island, centred on a point that travels from its cell to the middle. */
  const cx = from.x + GLYPH_W / 2 + (MAP_X + MAP_W / 2 - from.x - GLYPH_W / 2) * e;
  const cy = from.y + GLYPH_H / 2 + (MAP_Y + MAP_H / 2 - from.y - GLYPH_H / 2) * e;
  const w = GLYPH_W * s;
  const h = GLYPH_H * s;
  const gx = Math.min(MAP_X + MAP_W - w, Math.max(MAP_X, Math.round(cx - w / 2)));
  const gy = Math.min(MAP_Y + MAP_H - h, Math.max(MAP_Y, Math.round(cy - h / 2)));
  const rects = placeGlyph(place || { kind: 'island', state: 'fresh', percent: 0, due: 0 });
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    ctx.fillRect(gx + r[0] * s, gy + r[1] * s, r[2] * s, r[3] * s, 1);
  }
}

/* The zoom backwards: the island shrinks back into its cell. */
export function zoomOut(ctx, args, t) {
  zoomIn(ctx, args, ZOOM_MS - Math.min(ZOOM_MS, Math.max(0, t)));
}

/* ---- Star burst ---------------------------------------------------------- */

const onScreen = (v, max) => Math.min(max, Math.max(0, v));

/*
 * args = { x, y, r, seed }: twelve rays round a point at radius r -- a big
 * score -- that shoot out and draw back in, turning a little, with sparks
 * that twinkle round them. Clipped to the screen.
 */
export function starBurst(ctx, { x, y, r, seed = 1 }, t) {
  const u = progress(t, STAR_MS);
  const len = Math.round(7 * Math.sin(Math.PI * u));
  if (len > 0) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12 + u / 12) * Math.PI * 2;
      const x0 = x + Math.round(Math.cos(a) * (r + 2));
      const y0 = y + Math.round(Math.sin(a) * (r + 2));
      const x1 = x + Math.round(Math.cos(a) * (r + 2 + len));
      const y1 = y + Math.round(Math.sin(a) * (r + 2 + len));
      ctx.line(onScreen(x0, 127), onScreen(y0, 63), onScreen(x1, 127), onScreen(y1, 63), 1);
    }
  }
  if (u > 0.3 && u < 1) {
    const rand = rng(seed);
    for (let k = 0; k < 4; k++) {
      const a = rand() * Math.PI * 2;
      const d = r + 10 + rand() * 6;
      const sx = Math.round(x + Math.cos(a) * d);
      const sy = Math.round(y + Math.sin(a) * d);
      if ((k + Math.floor(t / 90)) % 2 || sx < 1 || sy < 1 || sx > 126 || sy > 62) continue;
      ctx.fillRect(sx - 1, sy, 3, 1, 1);
      ctx.fillRect(sx, sy - 1, 1, 3, 1);
    }
  }
}

/* ---- Finale -------------------------------------------------------------- */

const WAVE_MS = 150;
const FINALE_FIRST = 600;
const FINALE_STEP = 220;

/*
 * args = { layout, places, seed }: the world map, every flag waving, and a
 * burst of fireworks over each island in turn. Draws the whole map (without
 * the route) itself.
 */
export function finale(ctx, { layout, places, seed = 1 }, t) {
  const tt = Math.min(FINALE_MS, Math.max(0, t));
  drawMap(ctx, { places, layout, pulse: false, route: false });
  const island = layout.kind === 'island';
  const flutter = Math.floor(tt / WAVE_MS) % 2 === 1;
  const n = Math.min(places.length, layout.cells.length);
  const rand = rng(seed);
  for (let i = 0; i < n; i++) {
    const r = cellRect(layout.cells[i], layout.kind);
    const turn = rand() < 0.5 ? 0 : 1 / 24;
    if (places[i].state === 'done' && flutter) {
      /* The pennant's other shape: its tip dipping, then lifting again. */
      const f = flagOf(places[i].kind, island);
      const xs = f.pennant.map(([x]) => x);
      const px = Math.min(...xs);
      const right = px > f.x;
      ctx.fillRect(r.x + px, r.y, 3, 2, 0);
      ctx.fillRect(r.x + px + (right ? 0 : 1), r.y, 2, 1, 1);
      ctx.fillRect(r.x + px + (right ? 1 : 0), r.y + 1, 2, 1, 1);
    }
    const u = (tt - FINALE_FIRST - i * FINALE_STEP) / BURST_MS;
    if (u >= 0 && u <= 1) {
      const [bx, by] = fit(r.x + 6, r.y + 2);
      burst(ctx, bx, by, u, turn, tt);
    }
  }
}

/* ---- Registry ------------------------------------------------------------ */

/* Every animation by name, with its length: what a scene player needs. */
export const ANIMS = Object.freeze({
  flag: Object.freeze({ ms: FLAG_MS, draw: flagRise }),
  fireworks: Object.freeze({ ms: FIREWORKS_MS, draw: fireworks }),
  zoomIn: Object.freeze({ ms: ZOOM_MS, draw: zoomIn }),
  zoomOut: Object.freeze({ ms: ZOOM_MS, draw: zoomOut }),
  star: Object.freeze({ ms: STAR_MS, draw: starBurst }),
  finale: Object.freeze({ ms: FINALE_MS, draw: finale }),
});

/* ---- LEDs ---------------------------------------------------------------- */

/*
 * A wave of colour across the pads, left to right over SWEEP_MS: the
 * column under it bright, its neighbours dim, the rest off. Indexed by
 * note - 68. palette = { off, sweep, sweepDim }.
 */
export function sweepColors({ t, palette, out = new Array(MAX_PLACES) }) {
  out.fill(palette.off);
  /* From off the left edge to off the right one: dark at both ends. */
  const at = -1.75 + progress(t, SWEEP_MS) * (COLS + 2.5);
  for (let i = 0; i < MAX_PLACES; i++) {
    const d = Math.abs((i % COLS) - at);
    if (d < 0.75) out[i] = palette.sweep;
    else if (d < 1.75) out[i] = palette.sweepDim ?? palette.sweep;
  }
  return out;
}

/*
 * Pads that twinkle: a handful lit at a time, a new handful every 80 ms,
 * chosen by the seed -- the same seed and t light the same pads.
 * palette = { off, sparkle }.
 */
export function sparkleColors({ t, seed = 1, palette, out = new Array(MAX_PLACES) }) {
  out.fill(palette.off);
  const rand = rng(seed * 7919 + Math.floor(Math.max(0, t) / 80));
  for (let k = 0; k < 5; k++) out[Math.floor(rand() * MAX_PLACES)] = palette.sparkle;
  return out;
}
