// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
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

import { spell, inStaffRange } from './notation.mjs';
import { playableRange, scalePitches, MODES } from './generator.mjs';
import { DEFAULT_TRANSPOSE, padsForPitch, ABS_SEMI_LO, ABS_SEMI_HI } from './padmap.mjs';
import { CORRECT, WRONG, INCOMPLETE } from './verdict.mjs';

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

/*
 * The rest of the vocabulary: what the chord lessons teach beyond the quizzes.
 *
 * No quiz draws from this tier, and the reason is the same one that stops
 * `advanced` at the ninth: an eleventh or a thirteenth in close root position
 * is six notes over a span the grid barely reaches. The lessons can still teach
 * them, because a lesson chooses the VOICING — the left hand takes the root and
 * the right hand a shell (chord_lessons.mjs) — where a quiz would have to ask
 * for the chord as built here.
 *
 * The intervals are the full chord, not the voicing, so naming still has the
 * real shape to compare against.
 */
export const EXTENDED_QUALITIES = [
  { id: '5',       suffix: '5',       intervals: [0, 7] },
  { id: 'maj7#5',  suffix: 'maj7#5',  intervals: [0, 4, 8, 11] },
  { id: 'add11',   suffix: 'add11',   intervals: [0, 4, 7, 17] },
  { id: 'madd11',  suffix: 'madd11',  intervals: [0, 3, 7, 17] },
  { id: '7sus2',   suffix: '7sus2',   intervals: [0, 2, 7, 10] },
  { id: '11',      suffix: '11',      intervals: [0, 4, 7, 10, 14, 17] },
  { id: 'm11',     suffix: 'm11',     intervals: [0, 3, 7, 10, 14, 17] },
  { id: 'maj7#11', suffix: 'maj7#11', intervals: [0, 4, 7, 11, 18] },
  { id: '7#11',    suffix: '7#11',    intervals: [0, 4, 7, 10, 18] },
  { id: '13',      suffix: '13',      intervals: [0, 4, 7, 10, 14, 21] },
  { id: 'maj13',   suffix: 'maj13',   intervals: [0, 4, 7, 11, 14, 21] },
  { id: 'm13',     suffix: 'm13',     intervals: [0, 3, 7, 10, 14, 21] },
  { id: '7alt',    suffix: '7alt',    intervals: [0, 4, 8, 10, 15] },
];

/* Every quality a chord may be NAMED as, basic first so the plain reading
 * wins. Naming always searches all of them: a drill restricted to triads
 * should still say "Em", not fail to recognise its own chord. */
export const ALL_QUALITIES = QUALITIES.concat(ADVANCED_QUALITIES, EXTENDED_QUALITIES);

/*
 * What each quality is called in a list, a header and an answer: one name,
 * whether a lesson teaches it or a quiz asks for it. Kept to thirteen
 * characters, the most the reading header fits with " L3" after it.
 */
const NAMES = {
  maj: 'Major', min: 'Minor', dim: 'Diminished', aug: 'Augmented',
  sus2: 'Sus2', sus4: 'Sus4', 5: 'Power chord',
  6: 'Major 6th', m6: 'Minor 6th', 69: '6/9',
  maj7: 'Major 7th', 7: 'Dominant 7th', m7: 'Minor 7th', m7b5: 'Half-dim 7th',
  dim7: 'Dim 7th', mMaj7: 'Minor-maj 7th', '7#5': 'Aug 7th', 'maj7#5': 'Aug major 7th',
  add9: 'Add 9', madd9: 'Minor add 9', add11: 'Add 11', madd11: 'Minor add 11',
  9: 'Dominant 9th', maj9: 'Major 9th', m9: 'Minor 9th',
  '7sus2': '7sus2', '7sus4': '7sus4', '9sus4': '9sus4',
  11: 'Eleventh', m11: 'Minor 11th',
  13: 'Thirteenth', maj13: 'Major 13th', m13: 'Minor 13th',
  'maj7#11': 'Lydian maj7', '7#11': 'Lydian dom 7',
  '7b5': '7b5', '7b9': '7b9', '7#9': '7#9', '7alt': 'Altered 7th',
};
for (const q of ALL_QUALITIES) q.name = NAMES[q.id];

export function qualityById(id) {
  for (let i = 0; i < ALL_QUALITIES.length; i++) {
    if (ALL_QUALITIES[i].id === id) return ALL_QUALITIES[i];
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

/* ---- The ladder ------------------------------------------------------------ */

/*
 * The chord trainer's levels, each adding to the ones below it: the major
 * triad alone, then minor, the other two triads, the suspended and power
 * chords, the three common sevenths, the rest of the sevenths and sixths, the
 * added tones and ninths, and the altered dominants last.
 */
export const CHORD_LEVELS = [
  ['maj'],
  ['min'],
  ['dim', 'aug'],
  ['sus2', 'sus4', '5'],
  ['7', 'maj7', 'm7'],
  ['m7b5', 'dim7', '6', 'm6'],
  ['add9', 'madd9', '9', 'maj9', 'm9', '69'],
  ['7b5', '7#5', '7b9', '7#9', '7sus4', '9sus4', 'mMaj7'],
];

/* Every quality up to and including `level` (1-based). */
export function chordsAtLevel(level) {
  const n = Math.max(1, Math.min(CHORD_LEVELS.length, level | 0));
  return [].concat(...CHORD_LEVELS.slice(0, n));
}

/* The grid reaches this many semitones from its lowest pad to its highest. */
export const PAD_SPAN = ABS_SEMI_HI - ABS_SEMI_LO;

/* The qualities a quiz may ask for: the ladder's, each one that fits the pads
 * in close root position with a few roots to spare. */
export const QUIZ_QUALITIES = [].concat(...CHORD_LEVELS)
  .filter((id) => qualitySpan(qualityById(id)) <= PAD_SPAN - 4);

/* ---- Naming ------------------------------------------------------------------ */

/* The quality whose shape these pitch classes, read from `root`, are. */
function qualityOfShape(pcs, root) {
  const shape = pcShape(pcs.map((p) => p - root));
  for (let i = 0; i < SHAPES.length; i++) {
    if (SHAPES[i].shape === shape) return SHAPES[i].quality;
  }
  return null;
}

/* Distinct pitch classes in the order their lowest pitches sound, low first. */
function pcsLowFirst(pitches) {
  const sorted = pitches.slice().sort((a, b) => a - b);
  const out = [];
  for (const p of sorted) if (out.indexOf(((p % 12) + 12) % 12) < 0) out.push(((p % 12) + 12) % 12);
  return out;
}

/*
 * Name a chord from its pitches: [64,67,71] -> "Em".
 *
 * The root is first taken to be the LOWEST note, which is true by
 * construction wherever a drill builds a chord — triadOn and buildChord both
 * produce close root position — and is the plain reading of anything else:
 * C E G A is C6 before it is Am7 over C. Comparing pitch classes rather than
 * raw intervals is what lets an add9 be recognised whether its ninth is
 * written as 14 or as 2.
 *
 * With `inversions`, a stack that is not a chord over its lowest note is
 * tried over each of its other notes ("C/E" for E G C), and then as a chord
 * over a bass that is not one of its tones ("D/C"). Off by default: the name
 * lane of a song reads its chords as they have always been read.
 *
 * `null` when nothing matches, and that is a real answer rather than a
 * failure: in a chromatic or whole-tone scale the triad drill stacks scale
 * degrees that are not a chord, and showing the notes with no name is honest
 * where inventing the nearest symbol would not be.
 */
export function nameChord(pitches, fifths = 0, { inversions = false } = {}) {
  if (!pitches || pitches.length < 2) return null;
  let low = pitches[0];
  for (let i = 1; i < pitches.length; i++) {
    if (pitches[i] < low) low = pitches[i];
  }
  const plain = qualityOfShape(pitches, low);
  if (plain) return chordSymbol(low, plain, fifths);
  if (!inversions) return null;
  const pcs = pcsLowFirst(pitches);
  const bass = '/' + spell(low, fifths).label;
  for (let i = 1; i < pcs.length; i++) {
    const q = qualityOfShape(pcs, pcs[i]);
    if (q) return chordSymbol(pcs[i] + 60, q, fifths) + bass;
  }
  const upper = pcs.slice(1);
  if (upper.length < 3) return null;
  for (let i = 0; i < upper.length; i++) {
    const q = qualityOfShape(upper, upper[i]);
    if (q) return chordSymbol(upper[i] + 60, q, fifths) + bass;
  }
  return null;
}

/* ---- Voicings ------------------------------------------------------------- */

/*
 * Every close-position voicing of `pcs` that fits between `lo` and `hi`, as
 * ascending pitch arrays. `bottomPc`, if given, fixes which tone is lowest —
 * that is how an inversion is asked for.
 */
export function closeVoicings(pcs, lo, hi, bottomPc = null) {
  const sorted = pcs.slice().sort((a, b) => a - b);
  const out = [];
  for (let k = 0; k < sorted.length; k++) {
    if (bottomPc != null && sorted[k] !== bottomPc) continue;
    /* Offsets above the bottom tone, each the next chord tone up. */
    const shape = [0];
    for (let n = 1; n < sorted.length; n++) {
      const pc = sorted[(k + n) % sorted.length];
      shape.push((((pc - sorted[k]) % 12) + 12) % 12);
    }
    const span = shape[shape.length - 1];
    for (let b = lo; b + span <= hi; b++) {
      if ((((b - sorted[k]) % 12) + 12) % 12 !== 0) continue;
      out.push(shape.map((s) => b + s));
    }
  }
  return out;
}

/* ---- The pool ------------------------------------------------------------- */

/* Drawable on the staff and reachable on a pad, every note of it. */
export function playable(pitches, transpose = DEFAULT_TRANSPOSE) {
  for (let i = 0; i < pitches.length; i++) {
    if (!inStaffRange(pitches[i])) return false;
    if (!padsForPitch(pitches[i], transpose).length) return false;
  }
  return true;
}

const pcOf = (p) => ((p % 12) + 12) % 12;

/*
 * Every chord a prompt may be: { pitches, root, qualityId, inversion, label }.
 *
 *   qualities   ids, in the order to ask them
 *   roots       'chromatic'  every pitch in reach
 *               'key'        the notes of the key (rootPc, mode)
 *               'diatonic'   the notes of the key, and only the chords whose
 *                            every tone is in it too: in A minor, the chords
 *                            of A minor
 *   inversions  also each inversion: the same tones in close position over
 *               its 3rd, 5th or 7th, the lowest such voicing above the root
 *
 * Root outer, quality inner, inversion innermost: the order the chord drill
 * has always drawn in, so a seeded round asks what it asked before. Every
 * entry fits the pads and the staff; one that does not is left out.
 */
export function chordPool({
  qualities, roots = 'key', rootPc = 0, mode = 'major', transpose = DEFAULT_TRANSPOSE,
  fifths = 0, inversions = false,
}) {
  const { lo, hi } = playableRange(transpose);
  const scaleMode = MODES[mode] ? mode : 'major';
  const rootPitches = [];
  if (roots === 'chromatic') {
    for (let pitch = lo; pitch <= hi; pitch++) rootPitches.push(pitch);
  } else {
    rootPitches.push(...scalePitches(rootPc, scaleMode, lo, hi));
  }
  const inKey = MODES[scaleMode].map((s) => (rootPc + s) % 12);
  const out = [];
  for (const root of rootPitches) {
    for (const id of qualities) {
      const quality = qualityById(id);
      if (root + qualitySpan(quality) > hi) continue;
      const pitches = buildChord(root, quality);
      if (roots === 'diatonic' && pitches.some((p) => inKey.indexOf(pcOf(p)) < 0)) continue;
      const symbol = chordSymbol(root, quality, fifths);
      if (playable(pitches, transpose)) {
        out.push({ pitches, root, qualityId: id, inversion: 0, label: symbol });
      }
      if (!inversions) continue;
      const pcs = pitches.map(pcOf).filter((pc, i, a) => a.indexOf(pc) === i);
      for (let k = 1; k < quality.intervals.length && quality.intervals[k] < 12; k++) {
        const bottomPc = pcOf(root + quality.intervals[k]);
        const shape = closeVoicings(pcs, root + 1, hi, bottomPc)[0];
        if (!shape || !playable(shape, transpose)) continue;
        out.push({
          pitches: shape, root, qualityId: id, inversion: k,
          label: symbol + '/' + spell(shape[0], fifths).label,
        });
      }
    }
  }
  return out;
}

/* ---- The judge ------------------------------------------------------------ */

/*
 * The pads held against the chord asked for.
 *
 *   exact   the written pitches, every one, and nothing else
 *   name    a name has no octave, so the answer is its pitch classes: any F
 *           for "F", and A, C and E in any octave or inversion for "Am". A
 *           doubled note is fine, a stray one is not
 *
 * Held together either way: a chord is a chord, not an arpeggio.
 */
export function matchChord(held, prompt, how = 'exact') {
  if (how === 'name') {
    const wanted = prompt.map(pcOf);
    const have = [];
    for (let i = 0; i < held.length; i++) {
      const p = pcOf(held[i]);
      if (wanted.indexOf(p) < 0) return WRONG;
      if (have.indexOf(p) < 0) have.push(p);
    }
    for (let i = 0; i < wanted.length; i++) {
      if (have.indexOf(wanted[i]) < 0) return INCOMPLETE;
    }
    return CORRECT;
  }
  for (let i = 0; i < held.length; i++) {
    if (prompt.indexOf(held[i]) < 0) return WRONG;
  }
  /* Deduplicated on the way in, so equal lengths means the whole chord is
   * down — which is what makes a chord a chord rather than an arpeggio. */
  return held.length === prompt.length ? CORRECT : INCOMPLETE;
}
