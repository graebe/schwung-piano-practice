// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * glide.js — a position that eases to wherever it is sent, for a row that
 * moves on one place per right answer. The same curve and the same 450 ms as
 * the Move's screen (session.mjs quizGlide): quick to leave, gentle to arrive.
 */
export const GLIDE_MS = 450;

export const easeOut = (f) => 1 - (1 - f) ** 3;

/*
 * Call the result with the target every frame; it answers where the row is.
 * A new target starts a glide from wherever it is now, so a target that moves
 * on mid-glide carries on rather than jumping. A jump of more than two places
 * is a new round, not a move, and lands at once.
 */
export function createGlide(now = () => performance.now(), ms = GLIDE_MS) {
  let from = null;
  let to = null;
  let t0 = 0;
  const at = (t) => from + (to - from) * easeOut(Math.min(1, Math.max(0, (t - t0) / ms)));
  return (target) => {
    const t = now();
    if (to === null || Math.abs(target - to) > 2) {
      from = to = target;
      t0 = t;
    } else if (target !== to) {
      from = at(t);
      to = target;
      t0 = t;
    }
    return at(t);
  };
}
