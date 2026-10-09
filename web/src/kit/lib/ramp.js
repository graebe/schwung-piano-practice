// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
// From the neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/src/lib/ramp.js).
// Changed: trimmed to the two functions the ground uses (readRgb, cssHex); the
// spectrogram's ramp and lookup table are not part of this app.
/*
 * System colours, for a canvas.
 *
 * NO COLOUR IS SPELLED HERE, and that is the point of the file existing at all.
 * A canvas cannot use a CSS variable, so it reads the tokens back through
 * getComputedStyle and gets its colours from the one place the design system
 * is transcribed (here: the generated tokens.gen.css).
 */

/**
 * Three 0..255 channels as a string a canvas will accept.
 *
 * WHY THIS IS HERE AND NOT WHERE IT IS USED. A canvas cannot take a CSS
 * variable, so anything drawing into one needs a colour as text -- and the
 * moment that text is assembled where it is used, the file doing the assembling
 * contains colour syntax and the token guard stops it. Rightly: the guard cannot
 * tell an `rgb()` built from a token apart from one somebody typed.
 *
 * So the formatting lives once, in the file whose entire job is already "system
 * colours, for a canvas, read back rather than spelled". Its callers pass
 * channels that came out of `readRgb` -- or, for the ground's dot, channels
 * DERIVED from those by arithmetic -- and never a value of their own.
 */
export const cssHex = (channels) =>
  `#${channels.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;

/**
 * A custom property as three 0..255 channels, or null if it is not a hex
 * colour. Read back rather than spelled: a colour written into JavaScript is a
 * colour outside the token file, and the token guard would catch it.
 */
export function readRgb(name, el = document.documentElement) {
  const raw = getComputedStyle(el).getPropertyValue(name).trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  return [
    parseInt(raw.slice(0, 2), 16),
    parseInt(raw.slice(2, 4), 16),
    parseInt(raw.slice(4, 6), 16),
  ];
}
