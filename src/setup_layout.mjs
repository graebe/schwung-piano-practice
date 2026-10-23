// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * setup_layout.mjs — where each trainer's settings sit in its setup box.
 * Pure data, read by trainer.mjs (which knob is which) and view.mjs (where
 * each tile is drawn), so the knob numbers and the tiles cannot disagree.
 *
 * The box is the song ready box's family: the LEVEL band across the top with
 * its big digit, under a rule two rows of settings, and the PLAY strip across
 * the bottom. Each trainer has its own arrangement (the owner: "the box can
 * be individual per practice type"), and only the settings a circle really
 * has get a tile.
 *
 *   rows   the two rows under the LEVEL band: one setting is a full row
 *          (its name and its value), two are halves and three are thirds
 *          (their values, in words that say what they are: "key C",
 *          "10 right", "in 3rds")
 *   strip  settings at the right end of the PLAY strip (Round, where both
 *          rows are full)
 *
 * The knobs are numbered in reading order: LEVEL is knob 1 in every
 * trainer, the Answer knob 2 wherever a circle has one, then the rows left
 * to right and top to bottom, then the strip. A row whose settings a circle
 * does not have is dropped and the rest close up; a row left with one
 * setting is a full row.
 */

export const SETUP_LAYOUTS = {
  note: { rows: [['answer'], ['round']], strip: [] },
  int: { rows: [['answer', 'direction'], ['round']], strip: [] },
  scale: { rows: [['answer', 'key'], ['direction', 'pattern']], strip: ['round'] },
  chord: { rows: [['answer', 'key', 'scale'], ['roots', 'inversions', 'sound']], strip: ['round'] },
  prog: { rows: [['answer', 'key'], ['voicing', 'rhythm']], strip: ['round'] },
};

export const SETUP_ROWS = 2;
const KIND = ['', 'row', 'half', 'third'];

/*
 * The tiles of a circle whose settings are `fields`, in knob order:
 * [{ field, kind: 'level' | 'row' | 'half' | 'third' | 'strip', row, col,
 * of }]. A field the layout has no place for throws: every setting must
 * have a tile.
 */
export function placeTiles(subject, fields) {
  const layout = SETUP_LAYOUTS[subject];
  const has = new Set(fields);
  const out = [];
  if (has.has('level')) out.push({ field: 'level', kind: 'level', row: -1, col: 0, of: 1 });
  const rows = layout.rows.map((r) => r.filter((f) => has.has(f))).filter((r) => r.length);
  if (rows.length > SETUP_ROWS) throw new Error(`${subject}: ${rows.length} rows`);
  rows.forEach((r, row) => r.forEach((field, col) => out.push({ field, kind: KIND[r.length], row, col, of: r.length })));
  layout.strip.filter((f) => has.has(f)).forEach((field, col) => out.push({ field, kind: 'strip', row: SETUP_ROWS, col, of: 1 }));
  for (const f of fields) {
    if (!out.some((t) => t.field === f)) throw new Error(`${subject}: no tile for ${f}`);
  }
  return out;
}
