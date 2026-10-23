// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * chord_lessons.mjs — the Basics chord and progression lessons. Pure.
 *
 * Generated rather than written as files, because a chord lesson is a rule and
 * not a piece: "maj7 on every root" is twelve chords that follow from one row
 * of chords.mjs, and writing them out by hand forty times over would be forty
 * chances for a lesson and the name lane to disagree about what a maj7 is.
 *
 * What comes out is a SONG in the shape exercise_io produces — events tagged
 * by hand — so levels.mjs cuts the same four-rung ladder out of it as out of
 * any tune: the bass line, the top voice, the shapes, then both hands.
 *
 * THE VOICING. Both hands live inside the 23 semitones the pads reach, so a
 * chord cannot simply be stacked in root position over a bass note — at the top
 * of the cycle there is no room above it. The left hand takes the root in the
 * bottom octave of the grid, and the right hand takes the chord in whichever
 * close position sits above it and moves least from the chord before. That is
 * voice leading, which is how a keyboard player actually changes chords, and it
 * is what guarantees every chord of every lesson fits the pads.
 */

import { qualityById, chordSymbol, closeVoicings, ALL_QUALITIES } from './chords.mjs';

export { closeVoicings };
import { majorKeyFifths, spell } from './notation.mjs';
import { pitchRange, DEFAULT_TRANSPOSE } from './padmap.mjs';
import { rng } from './generator.mjs';

/* Roots in falling fifths, the order the cycle is practised in: C F Bb Eb ... */
export const CIRCLE = [0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7];

/*
 * What the right hand plays when the whole chord is too much for it, as
 * semitones above the root. Only the six-note chords need one: C11 is Bb/C, and
 * a thirteenth leaves out the fifth and the eleventh the way every pianist
 * voices it — E A Bb D over C.
 */
export const SHELLS = {
  11: [10, 14, 17],
  m11: [3, 10, 14, 17],
  13: [4, 9, 10, 14],
  maj13: [4, 9, 11, 14],
  m13: [3, 9, 10, 14],
};

/*
 * The right hand's pitch classes for `quality`, relative to its root.
 *
 * Up to four notes the root stays in the right hand too, so the hand learns the
 * whole shape. From five it drops out, because the left hand already has it and
 * five pads in one hand is the limit of what is comfortable.
 */
export function rightHandTones(quality) {
  const ivs = SHELLS[quality.id] || (quality.intervals.length >= 5
    ? quality.intervals.slice(1)
    : quality.intervals);
  const out = [];
  for (let i = 0; i < ivs.length; i++) {
    const pc = ((ivs[i] % 12) + 12) % 12;
    if (out.indexOf(pc) < 0) out.push(pc);
  }
  return out;
}

/*
 * Which key a chord is spelled in, as semitones from its root. A minor chord
 * reads in its relative major (Cm has an Eb), a dominant in the key it is the
 * fifth of (C7 has a Bb), a diminished one in the key a semitone up (Bdim is
 * the seventh degree of C). Everything else reads in its own major.
 */
function homeOffset(quality) {
  const ivs = quality.intervals.map((i) => i % 12);
  const has = (pc) => ivs.indexOf(pc) >= 0;
  if (has(3) && has(6) && !has(7)) return 1;
  if (has(3) && !has(4)) return 3;
  if (has(4) && has(10)) return 5;
  return 0;
}

export function spellingFor(rootPc, quality) {
  return majorKeyFifths(rootPc + homeOffset(quality));
}

/* How far a voicing moves from the last one: each note to its nearest. */
function motion(from, to) {
  let cost = 0;
  for (let i = 0; i < to.length; i++) {
    let best = Infinity;
    for (let j = 0; j < from.length; j++) best = Math.min(best, Math.abs(to[i] - from[j]));
    cost += best;
  }
  return cost;
}

/*
 * The voicing to play: the one nearest the previous chord, or for the first
 * chord the one centred nearest `home`. Ties go to the lower voicing, so the
 * answer never depends on the order candidates were generated in.
 */
export function chooseVoicing(candidates, prev, home) {
  let best = null;
  let bestCost = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const v = candidates[i];
    const cost = prev
      ? motion(prev, v)
      : Math.abs((v[0] + v[v.length - 1]) / 2 - home);
    if (cost < bestCost || (cost === bestCost && v[0] < best[0])) {
      best = v;
      bestCost = cost;
    }
  }
  return best;
}

/*
 * The right hand's voicing, thinned only if it has to be.
 *
 * With the bass at the top of its octave — Ab, the highest root the left hand
 * can take — eleven semitones are left above it, and a four-note chord whose
 * tones fall the wrong way round the octave does not fit in them. Abmaj7 is the
 * first casualty. The right hand then lets go of the note the left hand is
 * already playing — the root, or a slash chord's bass (F/C lets go of the C) —
 * and after that of the fifth, which is the order a pianist drops notes in for
 * the same reason. A slash chord's bass is also as high as a bass gets with an
 * Octave setting off the default, so it needs the same room. An inversion
 * drill never thins: there the lowest note is the whole point and there is no
 * left hand to cover it.
 */
export function voiceRightHand(tones, rootPc, bassPc, bassBelow, floor, hi, bottomPc, prev) {
  const attempts = [tones];
  if (bassBelow && bottomPc == null) {
    const noBass = tones.filter((pc) => pc !== bassPc);
    /* A power chord thins to its fifth alone; the left hand is the root. */
    if (noBass.length >= 1 && noBass.length < tones.length) attempts.push(noBass);
    const noFifth = noBass.filter((pc) => pc !== (rootPc + 7) % 12);
    if (noFifth.length >= 2 && noFifth.length < noBass.length) attempts.push(noFifth);
  }
  for (let i = 0; i < attempts.length; i++) {
    const v = chooseVoicing(closeVoicings(attempts[i], floor, hi, bottomPc), prev, (floor + hi) / 2);
    if (v) return v;
  }
  return null;
}

/*
 * A song from a list of chords.
 *
 *   step = { root, quality, bass?, inversion?, symbol? }
 *     root, bass   pitch classes; bass defaults to the root
 *     inversion    0, 1, 2 — which chord tone the right hand puts lowest
 *
 * opts.hands 'lr' puts the bass in the left hand; 'r' leaves the left hand out
 * (the inversion drills, where the bass IS the right hand's lowest note).
 * opts.keySig fixes the spelling for the whole song, which a progression in one
 * key wants; without it each chord is spelled in its own key, by key change.
 */
export function chordSong({
  id, name, steps, bpm = 60, beatsPer = 2, hands = 'lr', keySig = null, spelling = null,
  transpose = DEFAULT_TRANSPOSE,
}) {
  const { lo, hi } = pitchRange(transpose);
  const events = [];
  const keyChanges = [];
  let prev = null;
  let lastFifths = null;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const quality = typeof step.quality === 'string' ? qualityById(step.quality) : step.quality;
    if (!quality) throw new Error(`${id}: unknown quality ${step.quality}`);
    const beat = i * beatsPer;
    const fifths = keySig == null ? spellingFor(step.root, quality) : (spelling ? { fifths: keySig, map: spelling } : keySig);
    if (keySig == null && fifths !== lastFifths) keyChanges.push({ beat, keySig: fifths });
    lastFifths = fifths;

    const bassPc = step.bass == null ? step.root : step.bass;
    const bass = lo + ((((bassPc - lo) % 12) + 12) % 12);
    const tones = rightHandTones(quality).map((pc) => (pc + step.root) % 12);
    const bottomPc = step.inversion == null
      ? null
      : (step.root + quality.intervals[step.inversion]) % 12;
    const floor = hands === 'lr' ? bass + 1 : lo;
    const rh = voiceRightHand(tones, step.root, bassPc, hands === 'lr', floor, hi, bottomPc, prev);
    if (!rh) throw new Error(`${id}: no voicing of ${quality.id} on ${step.root} fits`);
    prev = rh;

    let symbol = step.symbol || chordSymbol(step.root + 60, quality, fifths);
    const lowest = hands === 'lr' ? bassPc : rh[0] % 12;
    if (!step.symbol && lowest !== step.root) symbol += '/' + spell(lowest + 60, fifths).label;

    if (hands === 'lr') events.push({ beat, durBeats: beatsPer, hand: 'l', pitches: [bass] });
    events.push({ beat, durBeats: beatsPer, hand: 'r', pitches: rh, symbol });
  }
  const song = {
    id,
    name,
    bpm,
    timeSig: [4, 4],
    keySig: keySig == null ? (keyChanges[0] ? keyChanges[0].keySig : 0) : keySig,
    events,
    source: 'file',
  };
  if (keyChanges.length > 1) song.keyChanges = keyChanges;
  if (spelling) song.spelling = spelling;
  return song;
}

/* ---- The lessons -------------------------------------------------------- */

/* What each quality is called in the list and in the header: chords.mjs's
 * names, by id. */
export const LESSON_NAMES = Object.fromEntries(ALL_QUALITIES.map((q) => [q.id, q.name]));

/* Families in teaching order: each one assumes the ones above it. */
export const CHORD_FAMILIES = [
  { name: 'Triads', qualities: ['maj', 'min', 'dim', 'aug'] },
  { name: 'Sus & power', qualities: ['sus2', 'sus4', '5'] },
  { name: 'Inversions', inversions: ['maj', 'min'] },
  { name: 'Sixths', qualities: ['6', 'm6', '69'] },
  { name: 'Sevenths', qualities: ['maj7', '7', 'm7', 'm7b5', 'dim7', 'mMaj7', '7#5', 'maj7#5'] },
  { name: 'Added tones', qualities: ['add9', 'madd9', 'add11', 'madd11'] },
  { name: 'Ninths', qualities: ['9', 'maj9', 'm9'] },
  { name: 'Suspended 7ths', qualities: ['7sus2', '7sus4', '9sus4'] },
  { name: 'Elevenths', qualities: ['11', 'm11'] },
  { name: 'Thirteenths', qualities: ['13', 'maj13', 'm13'] },
  { name: 'Lydian', qualities: ['maj7#11', '7#11'] },
  { name: 'Altered', qualities: ['7b5', '7b9', '7#9', '7alt'] },
  { name: 'Slash chords', slash: true },
];

/*
 * The slash chords a player actually meets, in C: a triad over its own third
 * or fifth (an inversion with the bass in the other hand), over a passing bass
 * note, and the two "chord over a foreign bass" shapes pop and gospel lean on.
 */
const SLASH = [
  { root: 0, quality: 'maj', bass: 4 },    /* C/E */
  { root: 0, quality: 'maj', bass: 7 },    /* C/G */
  { root: 2, quality: 'maj', bass: 6 },    /* D/F# */
  { root: 7, quality: 'maj', bass: 11 },   /* G/B */
  { root: 9, quality: 'min', bass: 7 },    /* Am/G */
  { root: 5, quality: 'maj', bass: 0 },    /* F/C */
  { root: 10, quality: 'maj', bass: 0 },   /* Bb/C */
  { root: 2, quality: 'maj', bass: 0 },    /* D/C */
];

/* One quality, every root, falling fifths. */
export function qualityLesson(qualityId, transpose = DEFAULT_TRANSPOSE) {
  return chordSong({
    id: 'chord-' + qualityId,
    name: LESSON_NAMES[qualityId],
    steps: CIRCLE.map((root) => ({ root, quality: qualityId })),
    transpose,
  });
}

/* Root position, first, second — then the next root. Right hand only. */
export function inversionLesson(qualityId, transpose = DEFAULT_TRANSPOSE) {
  const steps = [];
  for (let i = 0; i < CIRCLE.length; i++) {
    for (let inv = 0; inv < 3; inv++) steps.push({ root: CIRCLE[i], quality: qualityId, inversion: inv });
  }
  return chordSong({
    id: 'inversions-' + qualityId,
    name: LESSON_NAMES[qualityId] + ' inv',
    steps,
    hands: 'r',
    transpose,
  });
}

export function slashLesson(transpose = DEFAULT_TRANSPOSE) {
  return chordSong({ id: 'slash-chords', name: 'Slash chords', steps: SLASH, transpose });
}

/* ---- Random chords ------------------------------------------------------ */

/* What the random drills draw from: every quality a lesson teaches, or a tier. */
export const RANDOM_POOLS = {
  all: CHORD_FAMILIES.reduce((all, f) => all.concat(f.qualities || []), []),
  triads: ['maj', 'min', 'dim', 'aug'],
  sevenths: ['maj7', '7', 'm7', 'm7b5', 'dim7', 'mMaj7', '7#5', 'maj7#5'],
};

/*
 * Sixteen chords, any root, any quality in the pool — never the same chord
 * twice running, which would read as one long chord. Seeded like every other
 * generated drill, so the same seed is the same set; the list asks for a new
 * seed each time it is opened, and a restart replays the set you just missed.
 */
export function randomChordSong({ seed = 1, pool = RANDOM_POOLS.all, count = 16, transpose = DEFAULT_TRANSPOSE } = {}) {
  const rand = rng(seed);
  const steps = [];
  while (steps.length < count) {
    const step = { root: Math.floor(rand() * 12), quality: pool[Math.floor(rand() * pool.length)] };
    const last = steps[steps.length - 1];
    if (last && last.root === step.root && last.quality === step.quality) continue;
    steps.push(step);
  }
  return chordSong({ id: 'random-chords-' + seed, name: 'Random chords', steps, transpose });
}
