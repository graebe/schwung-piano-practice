// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * keyboard-geometry.js -- where the keys of a piano keyboard are. Pure.
 *
 * A port of the plugin kit's Keyboard (plugins/_shared/ui/src/Keyboard.cpp):
 * whole octaves from a C; white keys side by side with a 1px gap; a black key
 * three fifths of a white key's width and of the keys' length, centred on the
 * line between the white keys it sits over; and, under the keys, room for the
 * 3px bass mark.
 */

/* The white keys of an octave, as semitones above its C. */
const WHITES = [0, 2, 4, 5, 7, 9, 11];

export const BLACK_SHARE = 0.6;
export const GAP = 1;
export const MARK_SPACE = 6;
export const MARK_HEIGHT = 3;

/** Whether a MIDI note is a black key. */
export function isBlack(midi) {
  const pc = ((midi % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

/** Which white key a note is, counted from C-1; a black key counts as the
 * white key it sits after. */
export function whiteIndex(midi) {
  const octave = Math.floor(midi / 12);
  const pc = midi - octave * 12;
  let i = 6;
  while (WHITES[i] > pc) i--;
  return octave * 7 + i;
}

/** Whether the keyboard from `lowest`, `octaves` long, shows `midi`. */
export function shows(midi, lowest, octaves) {
  return midi >= lowest && midi < lowest + 12 * octaves && midi < 128 && midi >= 0;
}

/**
 * The keys and their rectangles, white keys first (they are drawn first, and
 * the black ones over them). `width` and `height` are the whole component's
 * px; the keys take the height less MARK_SPACE.
 *
 * `snap` puts every edge on a whole pixel, so the 1px gaps and the black
 * keys' hairlines are each one device pixel wide at 1x rather than a blur
 * across two. The kit's keys are fractional; on a canvas that is invisible,
 * in an SVG at 1x it is not.
 */
export function keyboardLayout({ lowest, octaves, width, height, snap = false }) {
  const n = Math.max(1, octaves | 0);
  const w = width / (7 * n);
  const px = snap ? Math.round : (v) => v;
  const edge = (i) => px(i * w);
  const keysH = Math.max(0, px(height - MARK_SPACE));
  const base = whiteIndex(lowest);
  const whites = [];
  const blacks = [];
  for (let midi = lowest; midi < lowest + 12 * n && midi < 128; midi++) {
    const i = whiteIndex(midi) - base;
    if (isBlack(midi)) {
      /* Centred on the line between the white keys it sits over. */
      const bw = px(w * BLACK_SHARE);
      const centre = snap ? edge(i + 1) - GAP / 2 : (i + 1) * w;
      blacks.push({ midi, black: true, x: px(centre - bw / 2), y: 0, w: bw, h: px(keysH * BLACK_SHARE) });
    } else {
      whites.push({ midi, black: false, x: edge(i), y: 0, w: edge(i + 1) - edge(i) - GAP, h: keysH });
    }
  }
  return { whiteWidth: w, keysHeight: keysH, keys: [...whites, ...blacks], whites, blacks };
}

/** The key under a point, black keys first since they lie on top; null for
 * none (the gap between white keys belongs to neither). */
export function keyAt(layout, x, y) {
  const inside = (k) => x >= k.x && x < k.x + k.w && y >= k.y && y < k.y + k.h;
  return layout.blacks.find(inside) ?? layout.whites.find(inside) ?? null;
}

/**
 * A press's velocity from where on the key it lands: the far end soft, the
 * near end loud, as a finger pressing nearer the front of a real key does
 * with more of its weight. 1..127.
 */
export function velocityAt(key, y, { soft = 24, loud = 127 } = {}) {
  const t = key.h > 0 ? Math.min(1, Math.max(0, (y - key.y) / key.h)) : 1;
  return Math.max(1, Math.min(127, Math.round(soft + (loud - soft) * t)));
}

/** The bass mark's rectangle under a key, as the kit draws it. */
export function bassMark(key, keysHeight) {
  return { x: key.x + 3, y: keysHeight + MARK_SPACE - MARK_HEIGHT, w: Math.max(2, key.w - 6), h: MARK_HEIGHT };
}

/**
 * The C the keyboard should start on: `current` while every note fits in its
 * octaves, otherwise the C at or below the lowest note -- no higher than the C
 * whose octaves just reach 127, so the top notes can always be shown. The
 * kit's lowestToShow, which keeps a keyboard still while the music stays in
 * range rather than following every note.
 */
export function lowestToShow(notes, octaves, current) {
  const list = [...notes].filter((n) => n >= 0 && n < 128);
  if (!list.length) return current;
  const low = Math.min(...list);
  const high = Math.max(...list);
  const span = 12 * Math.max(1, octaves | 0);
  if (low >= current && high < current + span) return current;
  const top = Math.max(0, 120 - (span - 12));
  return Math.min(top, Math.max(0, Math.floor(low / 12) * 12));
}

/** The fewest whole octaves from a C that show every note, at least `min`. */
export function octavesFor(notes, min = 1) {
  const list = [...notes].filter((n) => n >= 0 && n < 128);
  if (!list.length) return min;
  const from = Math.floor(Math.min(...list) / 12) * 12;
  return Math.max(min, Math.floor((Math.max(...list) - from) / 12) + 1);
}

/** The label a C carries: "C4" for 60. */
export const cLabel = (midi) => `C${Math.floor(midi / 12) - 1}`;
