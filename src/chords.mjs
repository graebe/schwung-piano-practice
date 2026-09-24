/*
 * chords.mjs — chord qualities by name. Pure.
 *
 * The existing chord drill asks for triads built on scale degrees, which are
 * diatonic by construction and never produce an augmented, a sus or a seventh.
 * This is the other half: a quality chosen deliberately, spelled from a root.
 *
 * Intervals are semitones from the root, in close root position. Kept in one
 * table so the pitches and the symbol can never disagree about what a chord is.
 */

import { spell } from './notation.mjs';

export const QUALITIES = [
  { id: 'maj',  suffix: '',     intervals: [0, 4, 7] },
  { id: 'min',  suffix: 'm',    intervals: [0, 3, 7] },
  { id: 'dim',  suffix: 'dim',  intervals: [0, 3, 6] },
  { id: 'aug',  suffix: 'aug',  intervals: [0, 4, 8] },
  { id: 'sus2', suffix: 'sus2', intervals: [0, 2, 7] },
  { id: 'sus4', suffix: 'sus4', intervals: [0, 5, 7] },
  { id: '6',    suffix: '6',    intervals: [0, 4, 7, 9] },
  { id: 'm6',   suffix: 'm6',   intervals: [0, 3, 7, 9] },
  { id: '7',    suffix: '7',    intervals: [0, 4, 7, 10] },
  { id: 'maj7', suffix: 'maj7', intervals: [0, 4, 7, 11] },
  { id: 'm7',   suffix: 'm7',   intervals: [0, 3, 7, 10] },
  { id: 'm7b5', suffix: 'm7b5', intervals: [0, 3, 6, 10] },
  { id: 'dim7', suffix: 'dim7', intervals: [0, 3, 6, 9] },
  { id: 'add9', suffix: 'add9', intervals: [0, 4, 7, 14] },
];

export function qualityById(id) {
  for (let i = 0; i < QUALITIES.length; i++) {
    if (QUALITIES[i].id === id) return QUALITIES[i];
  }
  return null;
}

/* The pitches of `quality` rooted on `rootPitch`, low to high. */
export function buildChord(rootPitch, quality) {
  const out = [];
  for (let i = 0; i < quality.intervals.length; i++) {
    out.push(rootPitch + quality.intervals[i]);
  }
  return out;
}

/*
 * How the chord is written: the root spelled by the key signature, plus the
 * quality's suffix. F# in a sharp key, Gb in a flat one — the same decision
 * `spell` already makes for a single note, so a chord symbol and a notehead
 * can never contradict each other.
 */
export function chordSymbol(rootPitch, quality, fifths = 0) {
  return spell(rootPitch, fifths).label + quality.suffix;
}

/* The widest interval a quality reaches, for deciding whether it fits. */
export function qualitySpan(quality) {
  return quality.intervals[quality.intervals.length - 1];
}
