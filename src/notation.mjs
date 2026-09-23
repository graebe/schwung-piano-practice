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
 */

import { ANCHOR_DIATONIC, ANCHOR_Y, STEP_PX, STAFF_LINE_YS } from './layout.mjs';

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
/* Pitch class of each natural letter, indexed as LETTERS. */
export const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];

/* Lowest and highest pitch the staff area can show (2 ledger steps each way):
 * A3 (57) on the second ledger below, C6 (84) on the second ledger above. */
export const MIN_PITCH = 57;
export const MAX_PITCH = 84;

/*
 * Spell a MIDI pitch under a key signature.
 * fifths: -7..7, positive = sharps (G=1, D=2...), negative = flats (F=-1...).
 * Returns { letter, letterIndex, alter, octave, diatonic, label, name }.
 *   alter    -1 flat, 0 natural, +1 sharp
 *   diatonic octave*7 + letterIndex — the staff-step ordinal, C4 = 28
 *   label    "F#"   — what scrolls in the name lane
 *   name     "F#5"  — with octave, for the screen reader
 */
export function spell(pitch, fifths = 0) {
  const pc = ((pitch % 12) + 12) % 12;
  const octave = Math.floor(pitch / 12) - 1;

  let letterIndex = NATURAL_PC.indexOf(pc);
  let alter = 0;
  if (letterIndex < 0) {
    if (fifths >= 0) {
      letterIndex = NATURAL_PC.indexOf(pc - 1);
      alter = 1;
    } else {
      letterIndex = NATURAL_PC.indexOf(pc + 1);
      alter = -1;
    }
  }

  const letter = LETTERS[letterIndex];
  const accidental = alter === 1 ? '#' : alter === -1 ? 'b' : '';
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

/* Staff y for a diatonic step ordinal. Higher pitch = smaller y. */
export function diatonicToY(diatonic) {
  return ANCHOR_Y - (diatonic - ANCHOR_DIATONIC) * STEP_PX;
}

/* Staff y for a MIDI pitch under a key signature. */
export function pitchToY(pitch, fifths = 0) {
  return diatonicToY(spell(pitch, fifths).diatonic);
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
export function chordLabel(pitches, fifths = 0) {
  return pitches
    .slice()
    .sort((a, b) => a - b)
    .map((p) => spell(p, fifths).label)
    .join(' ');
}

/* Key signature (fifths) for a major key given its tonic pitch class. */
const MAJOR_FIFTHS = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: -6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1 };

export function majorKeyFifths(tonicPc) {
  return MAJOR_FIFTHS[((tonicPc % 12) + 12) % 12] ?? 0;
}
