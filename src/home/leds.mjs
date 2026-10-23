// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * leds.mjs — the pads of a ring menu: one per circle, in the bottom row,
 * centred under the ring (render.mjs's homePads: the home screen's five on
 * columns 1..5, notes 69..73), left to right. The selected one is bright and
 * pulses on the 500 ms phase the Path map uses; the others are dim; every
 * other pad is dark, because lit means pressable.
 *
 * palette = { off, item, selected, selectedDim }: the module's own colour
 * indices, so the engine stays the same in both modules.
 *
 * Pure: imports only its sibling. Vendored byte for byte into Drums Practice.
 */

import { HOME_MAX, homePads } from './render.mjs';

export const PAD_FIRST = 68;
export const PAD_COUNT = 32;
export const PULSE_MS = 500;

/*
 * Colour indices for the 32 pads, indexed by note - 68. Pass `out` (an array
 * of 32) to fill it in place: LEDs repaint far more often than the screen.
 */
export function homePadColors({ count = HOME_MAX, selected = 0, now = 0, palette, out = new Array(PAD_COUNT) }) {
  out.fill(palette.off);
  const pads = homePads(Math.min(count, HOME_MAX));
  for (let i = 0; i < pads.length; i++) {
    let c = palette.item;
    if (i === selected) c = now % PULSE_MS < PULSE_MS / 2 ? palette.selected : palette.selectedDim;
    out[pads[i] - PAD_FIRST] = c;
  }
  return out;
}
