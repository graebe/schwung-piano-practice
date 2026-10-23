// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * scales.mjs — every scale the module knows, in one list. Pure.
 *
 * There were two: Move's twenty-two (the Scale setting, the Practice › Scales
 * folders) and the ear course's twenty-six (Identify scales, Read scales).
 * They overlap in thirteen, and spelled the steps twice. Now each scale is
 * written once, with both of its names:
 *
 *   short    what the Scale setting and a Practice folder print, kept to
 *            the ~90px a settings row leaves beside its label
 *   label    what an answer list prints, within 16 characters
 *   letters  the staff letter of each degree, counted from the root's: seven-
 *            note scales one letter a degree; the others as players write
 *            them (the pentatonics skip two, whole tone uses six, the
 *            diminished scales repeat one: C D Eb F Gb Ab A B)
 *   move     one of Move's own scales, which is what the Scale setting
 *            offers. Not a list chosen here: the names are the device
 *            firmware's (`strings /opt/move/MoveOriginal`), so the module
 *            lights the same pads Move would for the same setting.
 *            `pentatonic` was renamed `majorPent` when the rest arrived —
 *            see the v6 settings migration in ui.js, which exists because a
 *            stored value no longer in the list is dropped silently.
 *
 * Ids never change: the Settings `mode` keys, the Practice folder ids and the
 * ear courses' answer keys are all these ids. `altered` and `superLocrian`
 * are the same steps under two ids for that reason — the setting has one, the
 * course the other.
 */

import { CORRECT, WRONG, INCOMPLETE } from './verdict.mjs';

/* The modes of the three seven-note parents come from rotating them, so not
 * one of them is typed out by hand. */
export function rotate(parent, degree) {
  const up = parent.slice(degree).concat(parent.slice(0, degree).map((s) => s + 12));
  return up.map((s) => s - parent[degree]);
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const HARMONIC = [0, 2, 3, 5, 7, 8, 11];
const MELODIC = [0, 2, 3, 5, 7, 9, 11];

const s = (id, steps, short, label, extra = {}) => ({ id, steps, short, label, ...extra });

/*
 * Move's scales first, in the firmware's order — familiar first, chromatic
 * last as the "no filtering" end — then the course's, in its order.
 */
export const SCALE_LIST = [
  s('major', rotate(MAJOR, 0), 'Major', 'Major', { move: true }),
  s('minor', rotate(MAJOR, 5), 'Minor', 'Natural minor', { move: true }),
  s('dorian', rotate(MAJOR, 1), 'Dorian', 'Dorian', { move: true }),
  s('mixolydian', rotate(MAJOR, 4), 'Mixolydian', 'Mixolydian', { move: true }),
  s('lydian', rotate(MAJOR, 3), 'Lydian', 'Lydian', { move: true }),
  s('phrygian', rotate(MAJOR, 2), 'Phrygian', 'Phrygian', { move: true }),
  s('locrian', rotate(MAJOR, 6), 'Locrian', 'Locrian', { move: true }),
  s('majorPent', [0, 2, 4, 7, 9], 'Maj Pentatonic', 'Major pent', { move: true, letters: [0, 1, 2, 4, 5] }),
  s('minorPent', [0, 3, 5, 7, 10], 'Min Pentatonic', 'Minor pent', { move: true, letters: [0, 2, 3, 4, 6] }),
  s('minorBlues', [0, 3, 5, 6, 7, 10], 'Minor Blues', 'Minor blues', { move: true, letters: [0, 2, 3, 4, 4, 6] }),
  s('harmonicMinor', rotate(HARMONIC, 0), 'Harmonic Min', 'Harmonic minor', { move: true }),
  s('melodicMinor', rotate(MELODIC, 0), 'Melodic Min', 'Melodic minor', { move: true }),
  s('wholeTone', [0, 2, 4, 6, 8, 10], 'Whole Tone', 'Whole tone', { move: true, letters: [0, 1, 2, 3, 4, 5] }),
  s('superLocrian', rotate(MELODIC, 6), 'Super Locrian', 'Super Locrian', { move: true }),
  s('phrygianDominant', rotate(HARMONIC, 4), 'Phryg Dom', 'Phrygian dom', { move: true }),
  s('bhairav', [0, 1, 4, 5, 7, 8, 11], 'Bhairav', 'Bhairav', { move: true }),
  s('hungarianMinor', [0, 2, 3, 6, 7, 8, 11], 'Hungarian Min', 'Hungarian minor', { move: true }),
  s('hirajoshi', [0, 2, 3, 7, 8], 'Hirajoshi', 'Hirajoshi', { move: true, letters: [0, 1, 2, 4, 5] }),
  s('inSen', [0, 1, 5, 7, 10], 'In-Sen', 'In-Sen', { move: true, letters: [0, 1, 3, 4, 6] }),
  s('iwato', [0, 1, 5, 6, 10], 'Iwato', 'Iwato', { move: true, letters: [0, 1, 3, 4, 6] }),
  s('kumoi', [0, 2, 3, 7, 9], 'Kumoi', 'Kumoi', { move: true, letters: [0, 1, 2, 4, 5] }),
  s('chromatic', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 'Chromatic', 'Chromatic', { move: true }),

  s('locrianSharp6', rotate(HARMONIC, 1), 'Locrian #6', 'Locrian #6'),
  s('ionianSharp5', rotate(HARMONIC, 2), 'Ionian #5', 'Ionian #5'),
  s('dorianSharp4', rotate(HARMONIC, 3), 'Dorian #4', 'Dorian #4'),
  s('lydianSharp2', rotate(HARMONIC, 5), 'Lydian #2', 'Lydian #2'),
  s('alteredDim', rotate(HARMONIC, 6), 'Altered bb7', 'Altered bb7'),
  s('dorianFlat2', rotate(MELODIC, 1), 'Dorian b2', 'Dorian b2'),
  s('lydianAugmented', rotate(MELODIC, 2), 'Lydian Aug', 'Lydian augmented'),
  s('lydianDominant', rotate(MELODIC, 3), 'Lydian Dom', 'Lydian dominant'),
  s('mixolydianFlat6', rotate(MELODIC, 4), 'Mixolydian b6', 'Mixolydian b6'),
  s('locrianSharp2', rotate(MELODIC, 5), 'Locrian #2', 'Locrian #2'),
  s('altered', rotate(MELODIC, 6), 'Altered', 'Altered'),
  s('wholeHalf', [0, 2, 3, 5, 6, 8, 9, 11], 'Whole-half dim', 'Whole-half dim', { letters: [0, 1, 2, 3, 4, 5, 5, 6] }),
  s('halfWhole', [0, 1, 3, 4, 6, 7, 9, 10], 'Half-whole dim', 'Half-whole dim', { letters: [0, 1, 2, 2, 3, 4, 5, 6] }),
];

const BY_ID = new Map(SCALE_LIST.map((x) => [x.id, x]));

export function scaleById(id) {
  return BY_ID.get(id) || null;
}

/* The letter each degree sits on, counted from the root's. */
export function lettersOf(id) {
  const sc = scaleById(id);
  return (sc && sc.letters) || [0, 1, 2, 3, 4, 5, 6];
}

/* Move's scales by id, as the Scale setting and the generators read them. */
export const MODES = {};
export const MODE_LABELS = {};
for (const sc of SCALE_LIST) {
  if (!sc.move) continue;
  MODES[sc.id] = sc.steps;
  MODE_LABELS[sc.id] = sc.short;
}

/*
 * The scale ladder, in the ear course's teaching order: the contrasting pair
 * first, then the major modes, the minors, the dark modes, the five-note
 * scales, the symmetrical ones, and the modes of the two minor parents last.
 * Cumulative: each level adds its scales to everything below it.
 *
 * Dorian sits with Lydian and Mixolydian: the three are the major-ish modes
 * one note from a parent the learner already knows.
 */
export const SCALE_LEVELS = [
  ['major', 'minor'],
  ['dorian', 'lydian', 'mixolydian'],
  ['harmonicMinor', 'melodicMinor'],
  ['phrygian', 'locrian'],
  ['majorPent', 'minorPent', 'minorBlues'],
  ['wholeTone', 'lydianDominant', 'lydianAugmented', 'mixolydianFlat6'],
  ['wholeHalf', 'halfWhole'],
  ['dorianFlat2', 'locrianSharp2', 'altered'],
  ['locrianSharp6', 'ionianSharp5', 'dorianSharp4', 'phrygianDominant', 'lydianSharp2', 'alteredDim'],
  ['bhairav', 'hungarianMinor', 'hirajoshi', 'inSen', 'iwato', 'kumoi'],
];

/* Every scale up to and including `level` (1-based). */
export function scalesAtLevel(level) {
  const n = Math.max(1, Math.min(SCALE_LEVELS.length, level | 0));
  return [].concat(...SCALE_LEVELS.slice(0, n));
}

/* ---- The pool ------------------------------------------------------------- */

/*
 * Every scale line a prompt may be: for each root that leaves room for an
 * octave inside `range`, each of `ids`, as pitches from the root up through
 * the octave. Root outer, scale inner — the order the ear course has always
 * drawn in, so a seeded round asks what it asked before.
 *
 * `spell(root, semis, letters)`, when given, writes the line on the staff
 * (read_course.spellLine) and a root it cannot write is skipped; the entry
 * then carries `notes`.
 */
export function scalePool({ ids, range, spell = null }) {
  const out = [];
  for (let root = range.lo; root + 12 <= range.hi; root++) {
    for (const id of ids) {
      const sc = scaleById(id);
      const semis = sc.steps.concat([12]);
      const entry = { id, root, pitches: semis.map((x) => root + x) };
      if (spell) {
        const notes = spell(root, semis, lettersOf(id).concat([7]));
        if (!notes || notes.some((n) => n.pitch < range.lo || n.pitch > range.hi)) continue;
        entry.notes = notes;
      }
      out.push(entry);
    }
  }
  return out;
}

/* ---- The judge ------------------------------------------------------------ */

/*
 * A scale played note by note against the line asked for.
 *
 *   exact      the written pitches, in order
 *   any        the same notes in any octave — what a name ("D Dorian")
 *              asks for, since a name carries no octave; the line still has
 *              to go the way it was asked
 *
 * Correct once the whole line is down, incomplete while what was played is
 * the start of it, wrong at the first note that is not the next one.
 */
export function matchScale(played, line, how = 'exact') {
  const same = how === 'any'
    ? (a, b) => (((a - b) % 12) + 12) % 12 === 0
    : (a, b) => a === b;
  if (played.length > line.length) return WRONG;
  for (let i = 0; i < played.length; i++) if (!same(played[i], line[i])) return WRONG;
  return played.length === line.length ? CORRECT : INCOMPLETE;
}
