// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * notation.mjs — pitch spelling and staff placement. Pure; no host calls.
 *
 * The module never draws a key signature: at 128x64 there is no room, and for
 * a reading trainer an explicit accidental on the note is more useful than one
 * inferred from a signature the beginner has to remember. So `alter` here is
 * always what gets drawn next to the head.
 *
 * The key signature still matters for *spelling*: sharp keys spell the black
 * notes as sharps, flat keys as flats, which is what makes an F major scale
 * read Bb rather than A#.
 *
 * A key is either a signature (fifths, -7..7) or { fifths, map }: a scale that
 * names its own degrees. C minor is Eb Ab Bb by its signature; C harmonic
 * minor's raised 7th is B natural and F# minor's is E# — letters no signature
 * gives, so the scale's map does (scaleKey, below).
 */

import { scaleById } from './scales.mjs';
import { ANCHOR_DIATONIC, ANCHOR_Y, STEP_PX, STAFF_LINE_YS } from './layout.mjs';

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
/* Pitch class of each natural letter, indexed as LETTERS. */
export const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];

/* Lowest and highest pitch the staff area can show (2 ledger steps each way):
 * A3 (57) on the second ledger below, C6 (84) on the second ledger above. */
export const MIN_PITCH = 57;
export const MAX_PITCH = 84;

const mod12 = (n) => ((n % 12) + 12) % 12;
const ACCIDENTAL = { '-2': 'bb', '-1': 'b', 0: '', 1: '#', 2: 'x' };

/* A key's signature, whichever form it comes in. */
export function keyFifths(key) {
  return key && typeof key === 'object' ? key.fifths || 0 : key || 0;
}

/* Sharps are added F C G D A E B, flats B E A D G C F. */
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];

/* What the signature does to a letter: +1, -1 or 0. */
export function signatureAlter(letterIndex, fifths) {
  if (fifths > 0) return SHARP_ORDER.indexOf(letterIndex) < fifths ? 1 : 0;
  if (fifths < 0) return FLAT_ORDER.indexOf(letterIndex) < -fifths ? -1 : 0;
  return 0;
}

/*
 * Spell a MIDI pitch in a key: a signature (fifths, -7..7, positive = sharps)
 * or { fifths, map } for a scale that names its own degrees.
 * Returns { letter, letterIndex, alter, octave, diatonic, label, name }.
 *   alter    -1 flat, 0 natural, +1 sharp (±2 only from a scale's map)
 *   diatonic octave*7 + letterIndex — the staff-step ordinal, C4 = 28
 *   label    "F#"   — what scrolls in the name lane
 *   name     "F#5"  — with octave, for the screen reader
 *
 * In order: the scale's own letter for its degree; the letter the signature
 * makes it (which is how F# major gets its E# and Gb major its Cb); a white
 * key as itself; and a black key as a sharp in a sharp key, a flat in a flat
 * one.
 */
export function spell(pitch, key = 0) {
  const pc = mod12(pitch);
  const fifths = keyFifths(key);
  const mapped = key && typeof key === 'object' && key.map ? key.map[pc] : null;

  let letterIndex;
  let alter;
  if (mapped) {
    ({ letterIndex, alter } = mapped);
  } else {
    letterIndex = -1;
    for (let l = 0; l < 7 && fifths !== 0; l++) {
      const a = signatureAlter(l, fifths);
      if (a !== 0 && mod12(NATURAL_PC[l] + a) === pc) { letterIndex = l; alter = a; }
    }
    if (letterIndex < 0) {
      letterIndex = NATURAL_PC.indexOf(pc);
      alter = 0;
      if (letterIndex < 0) {
        alter = fifths >= 0 ? 1 : -1;
        letterIndex = NATURAL_PC.indexOf(pc - alter);
      }
    }
  }

  /* B#3 is the pitch of C4 written a letter lower: the octave is the letter's. */
  const octave = Math.floor((pitch - alter) / 12) - 1;
  const letter = LETTERS[letterIndex];
  const accidental = ACCIDENTAL[alter] ?? '';
  return {
    letter,
    letterIndex,
    alter,
    octave,
    diatonic: octave * 7 + letterIndex,
    label: letter + accidental,
    name: letter + accidental + octave,
  };
}

/* ---- A scale's own spelling --------------------------------------------------- */

/*
 * The letter each note of a scale sits on, counted from the root's. Seven-note
 * scales take one letter a degree. The others are written as players write
 * them: the pentatonics skip two letters, the blues' b5 shares the 5th's
 * letter, whole tone uses six, the diminished scales repeat one.
 */
/* The letters are the scale list's own (scales.mjs); a set of steps it does
 * not name is written nearest: a step of s semitones is about s * 7/12 letters. */
export function scaleLetters(steps, name) {
  const known = scaleById(name);
  if (known && known.letters) return known.letters;
  if (steps.length === 7) return [0, 1, 2, 3, 4, 5, 6];
  return steps.map((s) => Math.floor((s * 7) / 12 + 0.5));
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];

/* The steps as a set of pitch classes, for comparing two scales. */
const pcSet = (rootPc, steps) => steps.map((s) => mod12(rootPc + s)).sort((a, b) => a - b).join();

/* One spelling of the scale from a root written on `rootLetter`, or null when
 * a degree would need more than one sharp or flat. */
function spellFrom(rootPc, rootLetter, steps, letters) {
  const out = [];
  for (let i = 0; i < steps.length; i++) {
    const letterIndex = (rootLetter + letters[i]) % 7;
    let alter = mod12(rootPc + steps[i] - NATURAL_PC[letterIndex]);
    if (alter > 6) alter -= 12;
    if (Math.abs(alter) > 1) return null;
    out.push({ letterIndex, alter });
  }
  return out;
}

const sumAlter = (degrees) => degrees.reduce((n, d) => n + d.alter, 0);

/*
 * A scale's key: { fifths, map, root }.
 *
 *   root    its tonic's name, spelled the way the scale needs: Eb minor's root
 *           is Eb, F# major's F# — the one with fewest accidentals, `prefer`
 *           (+1 sharp, -1 flat) on a tie
 *   map     pitch class -> { letterIndex, alter } for every note of the scale
 *   nearest true when no one-letter-a-degree spelling fits single accidentals
 *   fifths  the signature it is written in: a mode of the major scale takes
 *           its parent's (D Dorian 0, C minor -3); a scale with a minor 3rd
 *           and no major one takes its tonic minor's (C harmonic minor -3,
 *           its raised 7th an accidental); any other its tonic major's
 *
 * A chromatic scale has no degrees to name: no map, the tonic major's
 * signature. Null steps likewise.
 */
export function scaleKey(rootPc, steps, name, prefer = 1) {
  rootPc = mod12(rootPc);
  if (!steps || steps.length >= 12) {
    const fifths = majorKeyFifths(rootPc);
    return { fifths, map: null, root: spell(rootPc + 60, fifths).label };
  }
  const letters = scaleLetters(steps, name);
  let best = null;
  let cost = Infinity;
  for (let l = 0; l < 7; l++) {
    const rootAlter = mod12(rootPc - NATURAL_PC[l]) > 6 ? mod12(rootPc - NATURAL_PC[l]) - 12 : mod12(rootPc - NATURAL_PC[l]);
    if (Math.abs(rootAlter) > 1) continue;
    /* A white key is its own letter: a scale on B# is a scale on C. */
    if (rootAlter !== 0 && NATURAL_PC.indexOf(rootPc) >= 0) continue;
    const degrees = spellFrom(rootPc, l, steps, letters);
    if (!degrees) continue;
    const c = degrees.reduce((n, d) => n + Math.abs(d.alter), 0);
    if (c < cost || (c === cost && Math.sign(rootAlter) === prefer)) { best = degrees; cost = c; }
  }
  /* A scale that needs a double sharp or flat on every root's spelling (the
   * altered scale on F would need Bbb) is written with single accidentals and
   * a letter used twice, as jazz players write it. */
  const nearest = !best;
  if (nearest) best = nearestDegrees(rootPc, steps);

  const map = new Array(12).fill(null);
  steps.forEach((s, i) => { map[mod12(rootPc + s)] = best[i]; });
  const root = LETTERS[best[0].letterIndex] + ACCIDENTAL[best[0].alter];

  const has = (s) => steps.indexOf(s) >= 0;
  let fifths;
  const mode = steps.length === 7 && [0, 1, 2, 3, 4, 5, 6].some((d) => pcSet(rootPc - MAJOR[d], MAJOR) === pcSet(rootPc, steps));
  if (mode) {
    fifths = sumAlter(best);
  } else {
    const tonic = has(3) && !has(4) ? NATURAL_MINOR : MAJOR;
    const parent = spellFrom(rootPc, best[0].letterIndex, tonic, [0, 1, 2, 3, 4, 5, 6]);
    fifths = parent ? sumAlter(parent) : majorKeyFifths(rootPc);
  }
  return { fifths: Math.max(-7, Math.min(7, fifths)), map, root, nearest };
}

/* Each degree on its own: a white key as itself, a black key as the sharp or
 * flat whose letter the degree before has not taken — and where either would
 * do, the way the last accidental went — starting the way the tonic's major
 * key leans — so a line does not swap from flats to sharps halfway up. */
function nearestDegrees(rootPc, steps) {
  const out = [];
  let lean = majorKeyFifths(rootPc) > 0 ? 1 : -1;
  for (let i = 0; i < steps.length; i++) {
    const pc = mod12(rootPc + steps[i]);
    const white = NATURAL_PC.indexOf(pc);
    if (white >= 0) { out.push({ letterIndex: white, alter: 0 }); continue; }
    const sharp = { letterIndex: NATURAL_PC.indexOf(pc - 1), alter: 1 };
    const flat = { letterIndex: NATURAL_PC.indexOf(mod12(pc + 1)), alter: -1 };
    const before = out.length ? out[out.length - 1].letterIndex : -1;
    let d;
    if (sharp.letterIndex === before) d = flat;
    else if (flat.letterIndex === before) d = sharp;
    else d = lean > 0 ? sharp : flat;
    lean = d.alter;
    out.push(d);
  }
  return out;
}

/* Staff y for a diatonic step ordinal. Higher pitch = smaller y. */
export function diatonicToY(diatonic) {
  return ANCHOR_Y - (diatonic - ANCHOR_DIATONIC) * STEP_PX;
}

/* Staff y for a MIDI pitch in a key. */
export function pitchToY(pitch, key = 0) {
  return diatonicToY(spell(pitch, key).diatonic);
}

/*
 * Ledger-line positions a note needs: the y of every staff line the note
 * sits beyond, walking outward from the staff to (and including) the note.
 * A note in the space just outside the staff gets none; a note two steps out
 * gets one, and so on.
 */
export function ledgerYs(y) {
  const top = STAFF_LINE_YS[0];
  const bottom = STAFF_LINE_YS[STAFF_LINE_YS.length - 1];
  const out = [];
  if (y > bottom) {
    for (let ly = bottom + STEP_PX * 2; ly <= y; ly += STEP_PX * 2) out.push(ly);
  } else if (y < top) {
    for (let ly = top - STEP_PX * 2; ly >= y; ly -= STEP_PX * 2) out.push(ly);
  }
  return out;
}

/* True when the pitch lands inside the drawable staff area. */
export function inStaffRange(pitch) {
  return pitch >= MIN_PITCH && pitch <= MAX_PITCH;
}

/* Space-joined labels for a chord, low to high: [66,72,76] -> "F# C E". */
export function chordLabel(pitches, key = 0) {
  return pitches
    .slice()
    .sort((a, b) => a - b)
    .map((p) => spell(p, key).label)
    .join(' ');
}

/* Key signature (fifths) for a major key given its tonic pitch class. */
const MAJOR_FIFTHS = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: -6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1 };

export function majorKeyFifths(tonicPc) {
  return MAJOR_FIFTHS[((tonicPc % 12) + 12) % 12] ?? 0;
}
