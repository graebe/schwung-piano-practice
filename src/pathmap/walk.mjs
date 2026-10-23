// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * walk.mjs — the avatar walking the route of a Path map.
 *
 * The walk is a function of time, never a tick counter: the module passes
 * now() in, and the position is computed from when the walk began. A frame
 * that comes late draws the avatar where it should be by then, so the speed
 * holds however busy the Move is.
 *
 * The avatar walks the route cell by cell, MS_PER_CELL each, through every
 * cell between here and there, and eases out over the last cell. The ease is
 * a quadratic whose starting speed equals the walking speed (it takes twice
 * as long as a walked cell), so there is no jolt where the two meet. A new
 * target while walking starts from wherever the avatar is at that moment.
 *
 * Positions along the route are route indices, fractional while moving.
 *
 * Pure: imports only its sibling. Vendored byte for byte into Drums Practice.
 */

import { cellCentre } from './layout.mjs';

export const MS_PER_CELL = 90;
/* The last cell, eased: twice a walked cell, so the speed is continuous. */
export const MS_EASE_CELL = 2 * MS_PER_CELL;
/* A story walk -- after a finished place, to the next one -- goes slower, so
 * the learner can follow where it leads: walkTo(w, i, now, { msPerCell }). */
export const STORY_MS_PER_CELL = 140;

const clampIndex = (i, n) => Math.max(0, Math.min(n - 1, Math.round(i) || 0));

/* An avatar standing on place `placeIndex` of `layout`; `msPerCell` sets its
 * pace (MS_PER_CELL unless told otherwise). */
export function createWalk(layout, placeIndex = 0, { msPerCell = MS_PER_CELL } = {}) {
  const n = layout.cells.length;
  if (n === 0) throw new RangeError('pathmap: a walk needs a map with at least one place');
  const target = clampIndex(placeIndex, n);
  const s = layout.stops[target];
  return { layout, target, from: s, to: s, t0: 0, ms: msPerCell, base: msPerCell };
}

/* How long a walk of `d` route cells takes, in ms, at `msPerCell`. */
export function walkDuration(d, msPerCell = MS_PER_CELL) {
  const ease = Math.min(d, 1);
  return (d - ease) * msPerCell + ease * 2 * msPerCell;
}

/* Distance covered after `t` ms of a walk of `d` cells. */
function covered(d, t, ms) {
  if (t <= 0 || d <= 0) return 0;
  const ease = Math.min(d, 1);
  const flat = d - ease;
  const tFlat = flat * ms;
  if (t < tFlat) return t / ms;
  const u = (t - tFlat) / (ease * 2 * ms);
  if (u >= 1) return d;
  return flat + ease * (1 - (1 - u) * (1 - u));
}

/* The route position at `now`, fractional while moving. */
function routePos(w, now) {
  const d = Math.abs(w.to - w.from);
  const s = covered(d, now - w.t0, w.ms || MS_PER_CELL);
  return w.to >= w.from ? w.from + s : w.from - s;
}

/* Walk to place `target` (clamped), from wherever the avatar is now, at the
 * walk's own pace or the one given (a story walk: STORY_MS_PER_CELL). */
export function walkTo(w, target, now, { msPerCell = w.base || MS_PER_CELL } = {}) {
  const n = w.layout.cells.length;
  const from = routePos(w, now);
  w.ms = msPerCell;
  w.target = clampIndex(target, n);
  w.from = from;
  w.to = w.layout.stops[w.target];
  w.t0 = now;
  return w;
}

/* One jog detent: `delta` places on from the current target, clamped to
 * 0..count-1 (no wrap). Turning on while walking extends the walk. */
export function walkStep(w, delta, count, now) {
  const n = Math.min(count, w.layout.cells.length);
  return walkTo(w, clampIndex(w.target + delta, n), now);
}

export function arrived(w, now) {
  return now - w.t0 >= walkDuration(Math.abs(w.to - w.from), w.ms || MS_PER_CELL);
}

/*
 * { x, y, moving, at, s }: the avatar's pixel centre, whether it is walking,
 * the place it stands on or last reached (passing a place's centre counts),
 * and its route position.
 */
export function posAt(w, now) {
  const { layout } = w;
  const moving = !arrived(w, now);
  const s = moving ? routePos(w, now) : w.to;
  const i = Math.min(Math.floor(s), layout.route.length - 1);
  const f = s - i;
  const a = cellCentre(layout.route[i], layout.kind);
  let x = a.x;
  let y = a.y;
  if (f > 0) {
    const b = cellCentre(layout.route[i + 1], layout.kind);
    x = Math.round(a.x + (b.x - a.x) * f);
    y = Math.round(a.y + (b.y - a.y) * f);
  }
  let at = w.target;
  if (moving) {
    const stops = layout.stops;
    if (w.to >= w.from) {
      at = 0;
      for (let k = 0; k < stops.length && stops[k] <= s + 1e-9; k++) at = k;
    } else {
      at = stops.length - 1;
      for (let k = stops.length - 1; k >= 0 && stops[k] >= s - 1e-9; k--) at = k;
    }
  }
  return { x, y, moving, at, s };
}
