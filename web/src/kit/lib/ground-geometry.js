// Copied from neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/src/lib/ground-geometry.js), MIT, Torben Gräber.
/*
 * The ground's geometry: where the canvas is, at what scale, and in what pixels.
 * Copyright (c) 2026 Torben Gräber. MIT.
 *
 * PURE FUNCTIONS, pulled out of Ground.jsx and field.js so that the one part of
 * the ground that is arithmetic about the page can be tested without one.
 *
 * WHY SCALE COMES INTO IT AT ALL. Every editor here draws a fixed-size design
 * and fits it to whatever viewport the host hands over with a CSS
 * `transform: scale(k)` on its <main>. The canvas lives inside that <main>, so
 * two measurements of it disagree by exactly k:
 *
 *   clientWidth / clientHeight     layout px, BEFORE the transform (the design's
 *                                  own pixels -- what the field simulates in)
 *   getBoundingClientRect()        viewport px, AFTER it
 *
 * The field's grid is in the first; a panel measured with the second is k times
 * too big and too far from the origin whenever k != 1, and the walls end up
 * somewhere the panels are not. So every rect is divided by k on the way in.
 */

/**
 * The CSS scale between the element's layout box and its on-screen box.
 *
 * `bounds` is its getBoundingClientRect(); `layoutW` its clientWidth. 1 for
 * anything that cannot be measured yet (zero width, not attached), because a
 * scale of 0 or NaN would poison every rect divided by it.
 */
export function viewScale(bounds, layoutW) {
  const k = bounds && layoutW > 0 ? bounds.width / layoutW : 1;
  return Number.isFinite(k) && k > 0 ? k : 1;
}

/**
 * On-screen rects to boxes in the canvas's own layout px.
 *
 * @param base   the canvas's getBoundingClientRect()
 * @param rects  the boxes' getBoundingClientRect()s
 * @param k      viewScale() of the canvas
 * @returns [{x, y, w, h}], zero-area boxes dropped
 *
 * A box with no area is a box that is not laid out yet (a collapsed panel, a
 * hidden tab). Passing it through would wall off a single grid node at the
 * origin, which reads as one dot that never moves.
 */
export function toCanvasRects(base, rects, k = 1) {
  const out = [];
  for (const b of rects) {
    const r = {
      x: (b.left - base.left) / k,
      y: (b.top - base.top) / k,
      w: b.width / k,
      h: b.height / k,
    };
    if (r.w > 0 && r.h > 0) out.push(r);
  }
  return out;
}

/** Whether two box lists are the same boxes, so an unchanged layout is not a rebuild. */
export function sameRects(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = b[i];
    if (p.x !== q.x || p.y !== q.y || p.w !== q.w || p.h !== q.h) return false;
  }
  return true;
}

/**
 * Backing-store pixels per layout px, for a canvas drawn at `dpr` device pixels
 * per CSS px inside an element scaled by `k`.
 *
 * dpr * k is the true ratio -- a canvas sized by dpr alone is resampled by k on
 * screen, blurring every dot when k > 1 and wasting pixels when k < 1. It is
 * then SNAPPED so that one dot pitch is a whole number of backing pixels: the
 * sprite atlas is one sprite per pitch, and a pitch of 19.92 px rounded to 20
 * would put the 68th dot of an 824 px window 5 px from where the static ground
 * has it.
 */
export function backingRatio(dpr, k, pitch) {
  const raw = (dpr > 0 ? dpr : 1) * (k > 0 ? k : 1);
  return Math.max(1, Math.round(pitch * raw)) / pitch;
}
