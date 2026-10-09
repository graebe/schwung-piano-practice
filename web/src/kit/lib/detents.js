// Copied from neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/src/lib/detents.js), MIT, Torben Gräber.
/*
 * Detents: values a control holds on while it is dragged past them.
 * Copyright (c) 2026 Torben Gräber. MIT.
 *
 * A Length knob at 1/32 has 128 values on 200px of travel, a step and a half
 * of a pixel each, and the four a user is reaching for -- 16, 32, 64, 128 --
 * are as hard to land on as the other 124. A detent makes them easy without
 * making them the only ones.
 *
 * HOW: EVERY DETENT IS GIVEN A STRETCH OF TRAVEL OF ITS OWN. The drag is
 * measured along a "travel" axis that is the value axis with a flat run of
 * DETENT_HOLD_PX inserted at each detent; over that run the value IS the
 * detent. So a drag passing through holds there for the same distance from
 * either side, and nowhere else is the knob any slower than it was. A drag
 * that starts on a detent starts in the middle of its run: half the hold to
 * leave it, either way.
 *
 * It is a pure function of where the press was and how far the pointer has
 * moved since -- no state, no timers -- so a drag back over the same pixels
 * gives the same values, and these functions are the whole of it.
 *
 * WHAT IT IS NOT: the value. Detents are a feel in the editor only; the
 * parameter, its automation and its host stay exactly as continuous or as
 * stepped as they were.
 *
 * Values are whatever unit the caller uses -- normalised 0..1 for a Knob, a
 * count for a Ring -- as long as the detents are in the same one.
 */

/*
 * 14px OF TRAVEL PER DETENT. Under 12 a drag at a normal speed crosses it in a
 * single pointer event and it is not felt; over 16 it is felt as a catch, and
 * at 128 values on 200px it would be the width of ten values. 14px is ~9
 * Length steps' worth of travel, and four detents add 56px to the knob's full
 * sweep, which is still one comfortable drag.
 */
export const DETENT_HOLD_PX = 14;

/* Two values this close are the same detent: well under half of the finest
 * step any control here has (1/127 of the range). */
const EPS = 1e-4;

/* Finite, ascending, without duplicates; in 0..1 for a normalised control,
 * which is the only range `clamp` below knows. */
function clean(detents, lo = 0, hi = 1) {
  const out = [];
  for (const d of [...(detents ?? [])].sort((a, b) => a - b)) {
    if (!Number.isFinite(d) || d < lo || d > hi) continue;
    if (out.length && Math.abs(d - out[out.length - 1]) <= EPS) continue;
    out.push(d);
  }
  return out;
}

/** Where `value` sits on the travel axis: past every detent below it by a
 * full hold, and on a detent in the middle of its hold. */
export function detentTravel(value, detents, hold) {
  let off = 0;
  for (const d of clean(detents)) {
    if (Math.abs(value - d) <= EPS) return d + off + hold / 2;
    if (value < d) break;
    off += hold;
  }
  return value + off;
}

/** The value at `travel` -- the inverse of detentTravel, flat across each
 * detent's hold. Unclamped: the caller clamps. */
export function detentValue(travel, detents, hold) {
  let off = 0;
  for (const d of clean(detents)) {
    const start = d + off;
    if (travel < start) return travel - off;
    if (travel <= start + hold) return d;
    off += hold;
  }
  return travel - off;
}

/**
 * A drag's value, normalised: `start` where the press was, `dy` pixels moved
 * since (up is positive), `travel` the pixels for the whole range. `fine`
 * (shift) ignores the detents -- a fine drag is for the values between them.
 */
export function dragValue(start, dy, { travel, detents, fine = false } = {}) {
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const ds = clean(detents);
  if (fine || !ds.length) return clamp(start + dy / travel);
  const hold = DETENT_HOLD_PX / travel;
  return clamp(detentValue(detentTravel(start, ds, hold) + dy / travel, ds, hold));
}

/** The nearest detent above `value` (`dir` > 0) or below it, or null when
 * there is none that way -- Page Up and Page Down. Any units. */
export function nextDetent(value, detents, dir) {
  const ds = clean(detents, -Infinity, Infinity);
  if (dir > 0) return ds.find((d) => d > value + EPS) ?? null;
  for (let i = ds.length - 1; i >= 0; i--) if (ds[i] < value - EPS) return ds[i];
  return null;
}
