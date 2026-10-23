// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * progressions.mjs — chord progressions, written once as numerals. Pure.
 *
 * A progression is a shape, not a list of chords: ii–V–I is the same thing
 * in every key. So each one is written the way a musician writes it — "ii7 V7
 * Imaj7" — and parseNumerals turns that into semitones above the tonic and a
 * chord quality, in whatever key it is asked in. The Learn charts, the
 * trainer's prompts and its answer names all come from the one line.
 *
 * THE NUMERALS. A degree in roman numerals, counted in the item's own mode:
 * in a minor progression VI is the minor key's sixth (Ab in C minor), as
 * every common-practice text writes it — i–VI–III–VII, and the Andalusian
 * i–VII–VI–V.
 *
 *   case        upper = a major chord, lower = a minor one
 *   b, #        before the numeral: the degree lowered or raised (bVII, bII)
 *   suffix      after it: the chord's own suffix from chords.mjs (V7, Imaj7,
 *               V7b9, Isus4); on a lower-case numeral the minor forms — ii7 is
 *               m7, ii7b5 half-diminished, iimaj7 minor-major — and o is
 *               diminished (viio), o7 a diminished seventh
 *   /X          a secondary chord: V/V is the V of the key whose tonic is V
 *
 * SPELLING follows the rule the progression charts have always had, now in
 * one place (progressionKey): a major progression in its major key, a minor
 * one in harmonic minor, so F# minor's V is C# E# G#, not C# F G#.
 */

import { ALL_QUALITIES, matchChord } from './chords.mjs';
import { chordSong, CIRCLE } from './chord_lessons.mjs';
import { majorKeyFifths, spell, scaleKey } from './notation.mjs';
import { DEFAULT_TRANSPOSE } from './padmap.mjs';
import { MODES } from './scales.mjs';
import { CORRECT, WRONG, INCOMPLETE } from './verdict.mjs';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const DEGREES = { major: MODES.major, minor: MODES.minor };

/* Lower-case suffixes: the minor form of a chord, by what is written. */
const MINOR_SUFFIX = { '': 'min', 7: 'm7', 9: 'm9', 6: 'm6', '7b5': 'm7b5', maj7: 'mMaj7', o: 'dim', o7: 'dim7', add9: 'madd9' };
const MAJOR_SUFFIX = { '': 'maj', '+': 'aug', o: 'dim', o7: 'dim7' };

function qualityOfSuffix(upper, suffix) {
  if (!upper) return MINOR_SUFFIX[suffix] || null;
  if (MAJOR_SUFFIX[suffix]) return MAJOR_SUFFIX[suffix];
  const q = ALL_QUALITIES.find((x) => x.suffix === suffix);
  return q ? q.id : null;
}

const TOKEN = /^(b|#)?(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)([^/]*)(?:\/(.+))?$/;

/* Semitones above the tonic of a numeral's degree, accidental included. */
function degreeOffset(roman, accidental, mode) {
  const d = ROMAN.indexOf(roman.toUpperCase());
  const shift = accidental === 'b' ? -1 : accidental === '#' ? 1 : 0;
  return (DEGREES[mode][d] + shift + 12) % 12;
}

/* One numeral -> [offset, quality id]; throws on anything it cannot read, so
 * a typo in the table fails the tests rather than a chart. */
export function parseNumeral(token, mode = 'major') {
  const m = TOKEN.exec(token);
  if (!m) throw new Error('not a numeral: ' + token);
  const [, accidental, roman, suffix, target] = m;
  const upper = roman === roman.toUpperCase();
  const quality = qualityOfSuffix(upper, suffix);
  if (!quality) throw new Error('unknown chord in ' + token);
  let offset = degreeOffset(roman, accidental, mode);
  if (target) {
    /* The secondary chord's degree is read in the major key of its target. */
    const [base] = parseNumeral(target, mode);
    offset = (base + degreeOffset(roman, accidental, 'major')) % 12;
  }
  return [offset, quality];
}

/* "ii7 V7 Imaj7" -> [[2, 'm7'], [7, '7'], [0, 'maj7']]. */
export function parseNumerals(numerals, mode = 'major') {
  return numerals.trim().split(/\s+/).map((t) => parseNumeral(t, mode));
}

/* ---- The vocabulary ------------------------------------------------------- */

const p = (id, name, numerals, extra = {}) => ({ id, name, numerals, mode: 'major', ...extra });
const minor = { mode: 'minor' };
const blues = { beatsPer: 4, repeat: 1 };

/*
 * The ladder, easiest first; each level adds its progressions to those below.
 * `name` is what an answer list shows, within 13 characters. `lesson` marks
 * the eleven that were Practice › Progressions before the trainer, in the
 * order they were listed — their ids are the Learn charts' ids, and with
 * them every Learning Path step built on one.
 */
export const PROGRESSION_LEVELS = [
  /* 1 Cadences: how a phrase ends, before whole patterns. */
  [
    p('V-I', 'Authentic', 'V I'),
    p('IV-I', 'Plagal', 'IV I'),
    p('I-V', 'Half cadence', 'I V'),
    p('V-vi', 'Deceptive', 'V vi'),
  ],
  /* 2 Foundations. */
  [
    p('I-IV-V-I', 'I-IV-V-I', 'I IV V I', { lesson: 0 }),
    p('I-V-vi-IV', 'Axis', 'I V vi IV', { lesson: 1 }),
  ],
  /* 3 Pop. */
  [
    p('vi-IV-I-V', 'vi-IV-I-V', 'vi IV I V', { lesson: 2 }),
    p('I-vi-IV-V', '50s', 'I vi IV V', { lesson: 3 }),
    p('IV-V-iii-vi', 'Royal Road', 'IV V iii vi'),
  ],
  /* 4 Minor. The cadence is i-iv-V-i: the V is major, its 3rd the leading
   * tone that pulls home. The minor v is a modal colour, taught after it. */
  [
    p('i-iv-V-i', 'Minor cadence', 'i iv V i', { ...minor, lesson: 6 }),
    p('i-VI-III-VII', 'i-VI-III-VII', 'i VI III VII', { ...minor, lesson: 8 }),
    p('i-VII-VI-V', 'Andalusian', 'i VII VI V', minor),
    p('i-iv-v-i modal', 'Modal minor', 'i iv v i', { ...minor, lesson: 7 }),
  ],
  /* 5 Jazz basics. */
  [
    p('ii-V-I', 'ii-V-I', 'ii7 V7 Imaj7 Imaj7', { lesson: 4 }),
    p('vi-ii-V-I', 'vi-ii-V-I', 'vi7 ii7 V7 Imaj7', { lesson: 5 }),
    p('I-vi-ii-V', 'Turnaround', 'Imaj7 vi7 ii7 V7'),
    p('iii-vi-ii-V-I', 'iii-vi-ii-V-I', 'iii7 vi7 ii7 V7 Imaj7'),
  ],
  /* 6 Blues: twelve bars, a chord a bar, once through. */
  [
    p('12-bar blues', '12-bar blues', 'I7 I7 I7 I7 IV7 IV7 I7 I7 V7 IV7 I7 V7', { ...blues, lesson: 10 }),
    p('quick-change blues', 'Quick-change', 'I7 IV7 I7 I7 IV7 IV7 I7 I7 V7 IV7 I7 V7', blues),
    p('minor blues', 'Minor blues', 'i7 i7 i7 i7 iv7 iv7 i7 i7 VI7 V7 i7 V7', { ...blues, ...minor }),
  ],
  /* 7 Borrowed and modal. */
  [
    p('I-bVII-IV', 'Mixo rock', 'I bVII IV'),
    p('bVI-bVII-I', 'bVI-bVII-I', 'bVI bVII I'),
    p('I-iv-I', 'Minor plagal', 'I iv I'),
    p('i-bII', 'Phrygian vamp', 'i bII', minor),
  ],
  /* 8 Secondary dominants and jazz substitutes. */
  [
    p('I-V/V-V-I', 'Secondary dom', 'I V/V V I'),
    p('ii-V-i minor', 'ii-V-i minor', 'ii7b5 V7b9 i7 i7', { ...minor, lesson: 9 }),
    p('ii-bII7-I', 'Tritone sub', 'ii7 bII7 Imaj7'),
    p('iv7-bVII7-I', 'Backdoor', 'iv7 bVII7 Imaj7'),
    p('Pachelbel', 'Pachelbel', 'I V vi iii IV I IV V'),
  ],
];

/* Every progression, in ladder order, each with its steps parsed. */
export const PROGRESSIONS = [].concat(...PROGRESSION_LEVELS);
for (const item of PROGRESSIONS) item.steps = parseNumerals(item.numerals, item.mode);

/* The Learn charts, in the order Practice › Progressions has always listed them. */
export const LESSON_PROGRESSIONS = PROGRESSIONS
  .filter((x) => x.lesson != null)
  .sort((a, b) => a.lesson - b.lesson);

export function progressionById(id) {
  return PROGRESSIONS.find((x) => x.id === id) || null;
}

/* Every progression up to and including `level` (1-based). */
export function progressionsAtLevel(level) {
  const n = Math.max(1, Math.min(PROGRESSION_LEVELS.length, level | 0));
  return [].concat(...PROGRESSION_LEVELS.slice(0, n));
}

/* The numerals as a reader sees them: "ii7 V7 Imaj7" -> "ii7-V7-Imaj7". */
export function numeralsLabel(item) {
  return item.numerals.trim().split(/\s+/).join('-');
}

/* ---- Keys ----------------------------------------------------------------- */

/*
 * The key a progression is written in on `tonicPc`: { fifths, map } for a
 * minor one (harmonic minor, its raised 7th on its own letter), or the
 * major key's fifths. The same rule the charts have always used.
 */
export function progressionKey(item, tonicPc) {
  if (item.mode === 'minor') return scaleKey(tonicPc, MODES.harmonicMinor, 'harmonicMinor');
  return majorKeyFifths(tonicPc);
}

/* The chords on `tonicPc`: [{ root, quality }], root a pitch class. */
export function progressionChords(item, tonicPc) {
  return item.steps.map(([offset, quality]) => ({ root: (tonicPc + offset) % 12, quality }));
}

/* The key after `tonicPc` on the walk round the circle of fifths (C F Bb
 * Eb ...), the order Key = all 12 walks. */
export function nextOnCircle(tonicPc) {
  return CIRCLE[(CIRCLE.indexOf(((tonicPc % 12) + 12) % 12) + 1) % 12];
}

/* ---- The Learn chart ------------------------------------------------------ */

/* A four-chord progression is over in two bars, so it goes round twice. */
export function progressionLesson(item, tonicPc = 0, transpose = DEFAULT_TRANSPOSE) {
  const once = progressionChords(item, tonicPc);
  const repeat = item.repeat || 2;
  let steps = [];
  for (let r = 0; r < repeat; r++) steps = steps.concat(once);
  const key = progressionKey(item, tonicPc);
  const minorKey = typeof key === 'object' ? key : null;
  const keySig = minorKey ? minorKey.fifths : key;
  const keyed = spell(tonicPc + 60, minorKey || keySig).label + ' ' + item.id;
  return chordSong({
    id: 'prog-' + item.id.replace(/\s+/g, '-') + '-' + tonicPc,
    name: keyed.length <= 13 ? keyed : item.id,
    steps,
    bpm: 70,
    beatsPer: item.beatsPer || 2,
    keySig,
    spelling: minorKey ? minorKey.map : null,
    transpose,
  });
}

/* ---- The judge ------------------------------------------------------------ */

/*
 * A progression played chord by chord: `played` is what was held for each
 * chord so far, the last one perhaps still going down; `chords` the pitches
 * asked for. Each chord is judged by matchChord — `exact` for a chart's own
 * voicing, `name` for any voicing of it — and the progression is correct
 * once every chord is, wrong at the first wrong chord.
 */
export function matchProgression(played, chords, how = 'exact') {
  if (played.length > chords.length) return WRONG;
  for (let i = 0; i < played.length; i++) {
    const r = matchChord(played[i], chords[i], how);
    if (r === WRONG) return WRONG;
    if (r === INCOMPLETE) return INCOMPLETE;
  }
  return played.length === chords.length ? CORRECT : INCOMPLETE;
}
