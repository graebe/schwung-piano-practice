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
 *   fireworks  900 ms  over the map: three bold bursts round a point
 *   zoomIn     350 ms  the whole map area: an island grows from its cell to
 *   zoomOut            the map in whole-pixel scales 1, 2, 3, in a frame
 *                      that opens to 128x44 (zoomOut is the same, backwards)
 *   starBurst  600 ms  over any screen: rays round a point (a big score)
 *   finale    2500 ms  the whole map: every flag waves, bursts climb over
 *                      every island and the sky between
 *   banner    1200 ms  over the map: a strip with a few words slides in,
 *                      holds, and slides out
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
/*
 * A burst, bold enough to read as a celebration at 1 bit: a solid flash at
 * its centre, then eight rays -- solid 3 px streaks -- flying out to r 13,
 * then sparks falling from where the rays ended, twinkling as they go.
 * Horizontal and vertical streaks are one rect each, diagonals one line.
 */
const BURST_MS = 450;
const BURSTS = [0, 220, 440];
const BURST_R = 13;
const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

function streak(ctx, x0, y0, x1, y1) {
  if (x0 === x1 || y0 === y1) {
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) + 1, Math.abs(y1 - y0) + 1, 1);
  } else {
    ctx.line(x0, y0, x1, y1, 1);
  }
}

/* One burst at (bx, by), `u` of its way through. */
function burst(ctx, bx, by, u, t) {
  if (u < 0.18) {
    /* The flash: a bright star that swells, then gives way to the rays. */
    const k = u < 0.09 ? 2 : 3;
    ctx.fillRect(bx - k, by, 2 * k + 1, 1, 1);
    ctx.fillRect(bx, by - k, 1, 2 * k + 1, 1);
    ctx.fillRect(bx - 1, by - 1, 3, 3, 1);
    if (k === 3) for (const [dx, dy] of DIRS) if (dx && dy) dot(ctx, bx + dx * 2, by + dy * 2);
    return;
  }
  if (u < 0.72) {
    const v = easeOut((u - 0.18) / 0.54);
    const outer = Math.round(4 + (BURST_R - 4) * v);
    for (const [dx, dy] of DIRS) {
      /* Diagonals step one pixel per axis, so they reach as far by eye. */
      const diag = dx && dy;
      const d = diag ? Math.round(outer * 0.72) : outer;
      const len = diag ? 3 : 4;
      const from = Math.max(1, d - len + 1);
      streak(ctx, bx + dx * from, by + dy * from, bx + dx * d, by + dy * d);
      /* A spark trailing the streak. */
      if (from > 2) dot(ctx, bx + dx * (from - 2), by + dy * (from - 2));
    }
    return;
  }
  /* Sparks fall from the tips, every other one lit in turn. */
  const fall = Math.round(((u - 0.72) / 0.28) * 5);
  for (let i = 0; i < DIRS.length; i++) {
    if ((i + Math.floor(t / 70)) % 2) continue;
    const [dx, dy] = DIRS[i];
    const d = dx && dy ? Math.round(BURST_R * 0.72) : BURST_R;
    dot(ctx, bx + dx * d, by + dy * d + fall);
    dot(ctx, bx + dx * d, by + dy * d + fall + 2);
  }
}

/* Keep a burst's rays inside the map area (its falling sparks are clipped). */
const fit = (x, y) => [
  Math.min(MAP_X + MAP_W - BURST_R - 2, Math.max(MAP_X + BURST_R + 1, x)),
  Math.min(MAP_Y + MAP_H - BURST_R - 2, Math.max(MAP_Y + BURST_R + 1, y)),
];

/* args = { x, y, seed }: three bursts in turn, scattered round (x, y). Draw
 * the map under them with { route: false }. */
export function fireworks(ctx, { x, y, seed = 1 }, t) {
  const rand = rng(seed);
  for (let i = 0; i < BURSTS.length; i++) {
    const [bx, by] = fit(x + Math.round(rand() * 24 - 12), y + Math.round(rand() * 8 - 4));
    const u = (t - BURSTS[i]) / BURST_MS;
    if (u >= 0 && u <= 1) burst(ctx, bx, by, u, t);
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
const FINALE_FIRST = 400;

/*
 * A pennant's flapping frame: its tip dropped a row and stretched a pixel,
 * so against the still frame the flag visibly waves.
 */
function flap(ctx, f, x, y) {
  const xs = f.pennant.map(([px]) => px);
  const px = Math.min(...xs);
  const right = px > f.x;
  ctx.fillRect(x + px, y, 3, 2, 0);
  if (right) {
    ctx.fillRect(x + px, y, 2, 1, 1);
    ctx.fillRect(x + px + 1, y + 1, 3, 1, 1);
  } else {
    ctx.fillRect(x + px + 1, y, 2, 1, 1);
    ctx.fillRect(x + px - 1, y + 1, 3, 1, 1);
  }
}

/*
 * args = { layout, places, seed }: the whole sky goes up. Every flag waves,
 * and bold bursts climb across the map -- one over each island in turn and
 * one between, somewhere in the open sky. Draws the map (without the
 * route) itself.
 */
export function finale(ctx, { layout, places, seed = 1 }, t) {
  const tt = Math.min(FINALE_MS, Math.max(0, t));
  drawMap(ctx, { places, layout, pulse: false, route: false });
  const island = layout.kind === 'island';
  const flutter = Math.floor(tt / WAVE_MS) % 2 === 1;
  const n = Math.min(places.length, layout.cells.length);
  if (flutter) {
    for (let i = 0; i < n; i++) {
      if (places[i].state !== 'done') continue;
      const r = cellRect(layout.cells[i], layout.kind);
      flap(ctx, flagOf(places[i].kind, island), r.x, r.y);
    }
  }
  const rand = rng(seed);
  const bursts = 2 * n;
  for (let k = 0; k < bursts; k++) {
    const sky = k % 2 === 1;
    const i = k >> 1;
    let bx;
    let by;
    if (sky) {
      bx = MAP_X + Math.round(rand() * MAP_W);
      by = MAP_Y + Math.round(rand() * MAP_H);
    } else {
      const r = cellRect(layout.cells[i], layout.kind);
      bx = r.x + 7;
      by = r.y + 2;
    }
    /* Evenly in turn, the last one done as the finale ends. */
    const start = FINALE_FIRST + (bursts > 1 ? (k * (FINALE_MS - BURST_MS - FINALE_FIRST)) / (bursts - 1) : 0);
    const u = (tt - start) / BURST_MS;
    if (u >= 0 && u <= 1) {
      const [fx, fy] = fit(bx, by);
      burst(ctx, fx, fy, u, tt);
    }
  }
}

/* ---- Banner -------------------------------------------------------------- */

export const BANNER_MS = 1200;
const BANNER_SLIDE = 260;

/* The text in one line if it fits, else in two, split at the space nearest
 * the middle. */
function bannerLines(ctx, text) {
  if (ctx.textWidth(text) <= MAP_W - 6) return [text];
  const mid = text.length / 2;
  let at = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === ' ' && (at < 0 || Math.abs(i - mid) < Math.abs(at - mid))) at = i;
  return at < 0 ? [text] : [text.slice(0, at), text.slice(at + 1)];
}

/*
 * args = { text }: a strip across the middle of the map area, lit, the text
 * cut out of it ("STAGE COMPLETE", "CHECKPOINT PASSED", "LEARNING PATH
 * COMPLETE"). It slides in from the left, holds, and slides out to the right.
 * 11 px high, 19 for a text that needs two lines.
 */
export function banner(ctx, { text }, t) {
  const tt = Math.min(BANNER_MS, Math.max(0, t));
  let x;
  if (tt < BANNER_SLIDE) x = -MAP_W + Math.round(MAP_W * easeOut(tt / BANNER_SLIDE));
  else if (tt > BANNER_MS - BANNER_SLIDE) {
    const u = (tt - (BANNER_MS - BANNER_SLIDE)) / BANNER_SLIDE;
    x = Math.round(MAP_W * u * u);
  } else x = 0;
  if (x <= -MAP_W || x >= MAP_W) return;
  const lines = bannerLines(ctx, String(text || ''));
  const h = lines.length === 1 ? 11 : 19;
  const y = MAP_Y + ((MAP_H - h) >> 1);
  const left = Math.max(MAP_X, MAP_X + x);
  const right = Math.min(MAP_X + MAP_W, MAP_X + x + MAP_W);
  /* The strip, and a rule a pixel above and below it, like a ribbon. */
  ctx.fillRect(left, y - 2, right - left, 1, 1);
  ctx.fillRect(left, y - 1, right - left, h + 2, 0);
  ctx.fillRect(left, y, right - left, h, 1);
  ctx.fillRect(left, y + h + 1, right - left, 1, 1);
  lines.forEach((line, k) => {
    const w = ctx.textWidth(line);
    const tx = MAP_X + x + ((MAP_W - w) >> 1);
    /* The words ride the strip, shown once they are wholly on screen. */
    if (tx >= MAP_X && tx + w <= MAP_X + MAP_W) ctx.text(tx, y + 2 + k * 8, line, 0);
  });
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
  banner: Object.freeze({ ms: BANNER_MS, draw: banner }),
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
