// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * answer_pads.mjs — multiple-choice answers as pads. Pure.
 *
 * Every drill that asks you to choose — name the lit pad, name what you heard
 * — puts its answers on the bottom of the grid, one coloured pad each, and the
 * screen says which colour means what. Pressing the pad answers.
 *
 *   up to 4    every other pad of the bottom row, centred:  · 1 · 2 · 3 · 4
 *   5 to 8     the whole bottom row
 *   9 to 12    the bottom row, then the row above it
 *
 * The gaps are there for your fingers: with four answers or fewer there is
 * room to leave a dark pad between two, and a near miss lands on nothing
 * rather than on the neighbouring answer.
 */

import { PAD_FIRST } from './padmap.mjs';

export const MAX_ANSWERS = 16;
const ROW = 8;

/*
 * Schwung palette indices, bright and dim. None is green, red, yellow or from
 * the purple ramp: those already mean right, wrong, pressed and the key, and
 * an answer must never be mistaken for a judgement or for the scale. Past five
 * answers the colours come round again — the screen shows a map then, and
 * the position carries the meaning.
 */
export const ANSWER_COLOURS = [
  { name: 'blue', bright: 16, dim: 95 },     /* AzureBlue / DarkAzure          */
  { name: 'orange', bright: 3, dim: 72 },    /* BrightOrange / DarkOrange      */
  { name: 'cyan', bright: 14, dim: 91 },     /* CyanTeal / DarkCyanTeal        */
  { name: 'pink', bright: 25, dim: 113 },    /* BrightPink / DarkBrightPink    */
  { name: 'white', bright: 120, dim: 119 },  /* White / DarkGrey               */
];

/* With this many answers, colour names are listed; past it, a map is drawn. */
export const LIST_MAX = 4;

/* Columns of the spaced layout, by answer count: centred, one dark pad apart. */
const SPACED = [[], [3], [2, 5], [1, 3, 5], [0, 2, 4, 6]];

/* The pad for each answer, in answer order. Made once per count and shared:
 * the LED repaint asks on every pulse, and must not allocate. */
const layouts = [];
export function answerPads(count) {
  const n = Math.max(0, Math.min(MAX_ANSWERS, count | 0));
  if (!layouts[n]) {
    if (n <= LIST_MAX) {
      layouts[n] = SPACED[n].map((col) => PAD_FIRST + col);
    } else {
      layouts[n] = [];
      for (let i = 0; i < n; i++) layouts[n].push(PAD_FIRST + i);
    }
  }
  return layouts[n];
}

/* Which answer a pad is, or -1. */
export function answerAt(count, pad) {
  return answerPads(count).indexOf(pad);
}

/* How many rows from the bottom the answers take: the pads above them are free. */
export function answerRows(count) {
  return count > ROW ? 2 : count > 0 ? 1 : 0;
}

/* A pad belongs to the answer bar — the rows the answers occupy, gaps and all. */
export function inAnswerBar(count, pad) {
  return pad >= PAD_FIRST && pad < PAD_FIRST + answerRows(count) * ROW;
}

export function answerColour(index) {
  return ANSWER_COLOURS[((index % ANSWER_COLOURS.length) + ANSWER_COLOURS.length) % ANSWER_COLOURS.length];
}

/*
 * What a cell of the screen map says: the answer's own key when that is
 * already short (m3, P5, TT, IV, 1), else the start of its label. Two
 * characters is what a boxed 16px cell holds at the 6px advance.
 */
export const SHORT_MAX = 2;
export function shortLabel(answer) {
  if (answer && answer.key && String(answer.key).length <= SHORT_MAX) return String(answer.key);
  const label = answer && answer.label ? String(answer.label) : '';
  return label.replace(/\s+/g, '').slice(0, SHORT_MAX);
}

/*
 * The colour of every answer pad right now, written into `out` (one palette
 * index per answer). A struck-out answer is dark; the answer the jog is on
 * pulses between its bright and dim shade, so turning the jog shows on the
 * pads as well as the screen — while every pad keeps the hue that names it.
 */
export function answerLeds(count, highlight, isStruck, phase, out) {
  out.length = count;
  for (let i = 0; i < count; i++) {
    const c = answerColour(i);
    if (isStruck(i)) out[i] = 0;
    else if (i === highlight && !phase) out[i] = c.dim;
    else out[i] = c.bright;
  }
  return out;
}
