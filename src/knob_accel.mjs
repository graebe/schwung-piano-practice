// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * knob_accel.mjs — calmer knobs for settings. Pure.
 *
 * A Move knob sends a few units a detent, more on a fast turn, and a setting
 * that moved one value per unit raced past where you wanted it. The owner,
 * on the device: "make the settings much less sensitive, maybe ten times".
 *
 * So a settings knob gathers its units and moves one value for every
 * `ticksPerStep` of them, turned the same way. Turning back, or resting for
 * `idleMs`, starts the count again, so a half turn never carries over into
 * the next gesture. One event moves one value at most: a flick is one step,
 * not five, and what it turned past the step is dropped rather than banked.
 *
 * Continuous controls do not use this: the song's scrub (knob 1) and tempo
 * (knob 8) want every unit.
 */

/* Units per value: the feel, in one place. */
export const TICKS_PER_STEP = 10;
export const IDLE_MS = 600;

export function createKnobAccumulator({ ticksPerStep = TICKS_PER_STEP, idleMs = IDLE_MS } = {}) {
  const knobs = new Map();
  return {
    /* Units turned on `knob` (signed) at time `now`: -1, 0 or +1 steps. */
    feed(knob, delta, now) {
      if (!delta) return 0;
      const dir = delta > 0 ? 1 : -1;
      let k = knobs.get(knob);
      if (!k || k.dir !== dir || now - k.at > idleMs) {
        k = { sum: 0, dir, at: now };
        knobs.set(knob, k);
      }
      k.sum += Math.abs(delta);
      k.at = now;
      if (k.sum < ticksPerStep) return 0;
      k.sum %= ticksPerStep;
      return dir;
    },
    /* Forget every partial turn: a new screen starts from rest. */
    reset() {
      knobs.clear();
    },
  };
}
