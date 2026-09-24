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

/*
 * The basic set: triads and sevenths, what the `types` drill asks for.
 *
 * Order matters. nameChord walks this table in order and takes the first
 * match, so the plainer spelling of an ambiguous set of intervals has to come
 * first — 0,4,7,9 is a sixth far more often than it is a minor seventh on the
 * sixth, and calling it the latter would be technically defensible and useless
 * to read.
 */
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

/*
 * What `advanced` adds: ninths, and the dominants you alter on the way to one.
 *
 * It stops at the ninth, and the pads are why. The grid reaches 22 semitones,
 * so a 9th chord (span 14) fits at nine different roots, an 11th (17) at six,
 * and a 13th (21) at two — past the ninth the pool is nearly empty and you are
 * holding down seven pads. Five notes is where it stays playable.
 */
export const ADVANCED_QUALITIES = [
  { id: '9',      suffix: '9',     intervals: [0, 4, 7, 10, 14] },
  { id: 'maj9',   suffix: 'maj9',  intervals: [0, 4, 7, 11, 14] },
  { id: 'm9',     suffix: 'm9',    intervals: [0, 3, 7, 10, 14] },
  { id: '69',     suffix: '6/9',   intervals: [0, 4, 7, 9, 14] },
  { id: '7b5',    suffix: '7b5',   intervals: [0, 4, 6, 10] },
  { id: '7#5',    suffix: '7#5',   intervals: [0, 4, 8, 10] },
  { id: '7b9',    suffix: '7b9',   intervals: [0, 4, 7, 10, 13] },
  { id: '7#9',    suffix: '7#9',   intervals: [0, 4, 7, 10, 15] },
  { id: '7sus4',  suffix: '7sus4', intervals: [0, 5, 7, 10] },
  { id: '9sus4',  suffix: '9sus4', intervals: [0, 5, 7, 10, 14] },
  { id: 'mMaj7',  suffix: 'mMaj7', intervals: [0, 3, 7, 11] },
  { id: 'madd9',  suffix: 'madd9', intervals: [0, 3, 7, 14] },
];

/* Every quality a chord may be NAMED as, basic first so the plain reading
 * wins. Naming always searches all of them: a drill restricted to triads
 * should still say "Em", not fail to recognise its own chord. */
export const ALL_QUALITIES = QUALITIES.concat(ADVANCED_QUALITIES);

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

/* The pitch classes a quality occupies, sorted — the shape naming compares. */
function pcShape(intervals) {
  const seen = [];
  for (let i = 0; i < intervals.length; i++) {
    const pc = ((intervals[i] % 12) + 12) % 12;
    if (seen.indexOf(pc) < 0) seen.push(pc);
  }
  return seen.sort((a, b) => a - b).join(',');
}

const SHAPES = ALL_QUALITIES.map((q) => ({ quality: q, shape: pcShape(q.intervals) }));

/*
 * Name a chord from its pitches: [64,67,71] -> "Em".
 *
 * The root is the LOWEST note, which is true by construction everywhere this
 * is called — triadOn and buildChord both produce close root position — and is
 * what makes this a table lookup instead of an inversion solver. Comparing
 * pitch classes rather than raw intervals is what lets an add9 be recognised
 * whether its ninth is written as 14 or as 2.
 *
 * `null` when nothing matches, and that is a real answer rather than a
 * failure: in a chromatic or whole-tone scale the triad drill stacks scale
 * degrees that are not a chord, and showing the notes with no name is honest
 * where inventing the nearest symbol would not be.
 */
export function nameChord(pitches, fifths = 0) {
  if (!pitches || pitches.length < 2) return null;
  let root = pitches[0];
  for (let i = 1; i < pitches.length; i++) {
    if (pitches[i] < root) root = pitches[i];
  }
  const shape = pcShape(pitches.map((p) => p - root));
  for (let i = 0; i < SHAPES.length; i++) {
    if (SHAPES[i].shape === shape) return chordSymbol(root, SHAPES[i].quality, fifths);
  }
  return null;
}
