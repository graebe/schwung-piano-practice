// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * leds.mjs — the pad grid as the Path map: one lit pad per place.
 *
 * A place's pad is coloured by its state, the pad under the avatar is the
 * brightest thing on the grid (it runs across the pads while the avatar
 * walks, water pads included), and every other pad is dark: lit means
 * pressable. The current place pulses on a 500 ms period, timed from `now`.
 *
 * The colours are the module's own palette indices, passed in, so the engine
 * stays the same in both modules:
 *   palette = { off, done, current, currentDim, started, fresh, skipped, avatar }
 * An `ahead` place uses palette.ahead when the module has one, else fresh.
 *
 * Pure: imports only its siblings. Vendored byte for byte into Drums Practice.
 */

import { MAX_PLACES, PAD_FIRST, padOfCell } from './layout.mjs';
import { posAt } from './walk.mjs';

export const PULSE_MS = 500;

function stateColour(state, palette, now) {
  switch (state) {
    case 'done': return palette.done;
    case 'current': return now % PULSE_MS < PULSE_MS / 2 ? palette.current : palette.currentDim;
    case 'started': return palette.started;
    case 'skipped': return palette.skipped;
    case 'ahead': return palette.ahead ?? palette.fresh;
    default: return palette.fresh;
  }
}

/*
 * Colour indices for the 32 pads, indexed by note - 68. Pass `out` (an array
 * of 32) to fill it in place: LEDs repaint far more often than the screen.
 */
export function mapPadColors({ places, layout, walk = null, now = 0, palette, out = new Array(MAX_PLACES) }) {
  out.fill(palette.off);
  const n = Math.min(places.length, layout.cells.length);
  for (let i = 0; i < n; i++) {
    out[padOfCell(layout.cells[i]) - PAD_FIRST] = stateColour(places[i].state, palette, now);
  }
  if (walk && layout.route.length) {
    const pos = posAt(walk, now);
    const cell = layout.route[Math.min(layout.route.length - 1, Math.round(pos.s))];
    out[padOfCell(cell) - PAD_FIRST] = palette.avatar;
  }
  return out;
}
