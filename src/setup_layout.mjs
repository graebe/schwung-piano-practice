// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * setup_layout.mjs — how each trainer's setup page reads. Pure data, read by
 * trainer.mjs (which knob is which) and view.mjs (where each value is drawn),
 * so the knob numbers and the page cannot disagree.
 *
 * The page shows the settings, not the knobs: the LEVEL band with its big
 * digit, under a rule up to three rows of values that explain themselves
 * ("C harmonic minor", "name it", "broken chords"), and the bottom bar,
 * "PLAY  10 chords", which carries the Round. Touching a knob opens an
 * overlay that names it and lists its options, so the page needs no knob
 * numbers. Each trainer has its own rows (the owner: "the box can be
 * individual per practice type"); only the settings a circle really has
 * appear, and the rows it lacks close up.
 *
 *   rows  up to three: one setting is a full row (its name and its value),
 *         two are halves; a pair in brackets is one phrase from two
 *         settings (Key and Scale read as one thing: the key)
 *   bar   settings the bottom bar says (Round: what PLAY starts)
 *
 * Knobs are numbered in reading order: LEVEL is knob 1, then the rows left
 * to right and top to bottom, a pair's settings in turn, the bar last.
 */

export const SETUP_LAYOUTS = {
  note: { rows: [['answer']], bar: ['round'] },
  int: { rows: [['answer'], ['direction']], bar: ['round'] },
  scale: { rows: [['key', 'answer'], ['direction', 'pattern']], bar: ['round'] },
  chord: { rows: [[['key', 'scale']], ['answer', 'roots'], ['inversions', 'sound']], bar: ['round'] },
  prog: { rows: [['answer', 'key'], ['voicing'], ['rhythm']], bar: ['round'] },
};

export const SETUP_ROWS = 3;

/*
 * The tiles of a circle whose settings are `fields`, in knob order:
 * [{ field, kind: 'level' | 'row' | 'half' | 'bar', row, col, of, pair }].
 * `pair` is 0 or 1 for the two settings of one phrase. A field the layout
 * has no place for throws: every setting must be on the page.
 */
export function placeTiles(subject, fields) {
  const layout = SETUP_LAYOUTS[subject];
  const has = new Set(fields);
  const out = [];
  if (has.has('level')) out.push({ field: 'level', kind: 'level', row: -1, col: 0, of: 1 });
  const rows = layout.rows
    .map((r) => r.map((slot) => (Array.isArray(slot) ? slot.filter((f) => has.has(f)) : has.has(slot) ? slot : null))
      .filter((slot) => slot && slot.length !== 0)
      .map((slot) => (Array.isArray(slot) && slot.length === 1 ? slot[0] : slot)))
    .filter((r) => r.length);
  if (rows.length > SETUP_ROWS) throw new Error(`${subject}: ${rows.length} rows`);
  rows.forEach((r, row) => r.forEach((slot, col) => {
    const kind = r.length === 1 ? 'row' : 'half';
    if (Array.isArray(slot)) slot.forEach((field, pair) => out.push({ field, kind, row, col, of: r.length, pair }));
    else out.push({ field: slot, kind, row, col, of: r.length });
  }));
  layout.bar.filter((f) => has.has(f)).forEach((field) => out.push({ field, kind: 'bar', row: SETUP_ROWS, col: 0, of: 1 }));
  for (const f of fields) {
    if (!out.some((t) => t.field === f)) throw new Error(`${subject}: no place for ${f}`);
  }
  return out;
}
