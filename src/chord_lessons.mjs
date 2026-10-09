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

import { qualityById, chordSymbol } from './chords.mjs';
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
 * first casualty. The right hand then lets go of the root, which the left hand
 * is already playing, and after that of the fifth, which is the order a pianist
 * drops notes in for the same reason. An inversion drill never thins: there
 * the lowest note is the whole point and there is no left hand to cover it.
 */
function voiceRightHand(tones, rootPc, bassBelow, floor, hi, bottomPc, prev) {
  const attempts = [tones];
  if (bassBelow && bottomPc == null) {
    const noRoot = tones.filter((pc) => pc !== rootPc);
    /* A power chord thins to its fifth alone; the left hand is the root. */
    if (noRoot.length >= 1 && noRoot.length < tones.length) attempts.push(noRoot);
    const noFifth = noRoot.filter((pc) => pc !== (rootPc + 7) % 12);
    if (noFifth.length >= 2 && noFifth.length < noRoot.length) attempts.push(noFifth);
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
  id, name, steps, bpm = 60, beatsPer = 2, hands = 'lr', keySig = null,
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
    const fifths = keySig == null ? spellingFor(step.root, quality) : keySig;
    if (keySig == null && fifths !== lastFifths) keyChanges.push({ beat, keySig: fifths });
    lastFifths = fifths;

    const bassPc = step.bass == null ? step.root : step.bass;
    const bass = lo + ((((bassPc - lo) % 12) + 12) % 12);
    const tones = rightHandTones(quality).map((pc) => (pc + step.root) % 12);
    const bottomPc = step.inversion == null
      ? null
      : (step.root + quality.intervals[step.inversion]) % 12;
    const floor = hands === 'lr' ? bass + 1 : lo;
    const rh = voiceRightHand(tones, step.root, hands === 'lr', floor, hi, bottomPc, prev);
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
  return song;
}

/* ---- The lessons -------------------------------------------------------- */

/*
 * What each quality is called in the list and in the header. Kept to thirteen
 * characters, the most the reading header fits with " L3" after it.
 */
export const LESSON_NAMES = {
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

/*
 * Progressions, as semitones above the tonic, in the key the Key setting
 * names. A minor progression is spelled in its relative major, the same rule
 * homeOffset applies to a single minor chord.
 */
export const PROGRESSIONS = [
  { id: 'I-IV-V-I', steps: [[0, 'maj'], [5, 'maj'], [7, 'maj'], [0, 'maj']] },
  { id: 'I-V-vi-IV', steps: [[0, 'maj'], [7, 'maj'], [9, 'min'], [5, 'maj']] },
  { id: 'vi-IV-I-V', steps: [[9, 'min'], [5, 'maj'], [0, 'maj'], [7, 'maj']] },
  { id: 'I-vi-IV-V', steps: [[0, 'maj'], [9, 'min'], [5, 'maj'], [7, 'maj']] },
  { id: 'ii-V-I', steps: [[2, 'm7'], [7, '7'], [0, 'maj7'], [0, 'maj7']] },
  { id: 'vi-ii-V-I', steps: [[9, 'm7'], [2, 'm7'], [7, '7'], [0, 'maj7']] },
  { id: 'i-iv-v-i', minor: true, steps: [[0, 'min'], [5, 'min'], [7, 'min'], [0, 'min']] },
  { id: 'i-VI-III-VII', minor: true, steps: [[0, 'min'], [8, 'maj'], [3, 'maj'], [10, 'maj']] },
  { id: 'ii-V-i minor', minor: true, steps: [[2, 'm7b5'], [7, '7b9'], [0, 'm7'], [0, 'm7']] },
  {
    id: '12-bar blues',
    beatsPer: 4,
    repeat: 1,
    steps: [[0, '7'], [0, '7'], [0, '7'], [0, '7'], [5, '7'], [5, '7'],
      [0, '7'], [0, '7'], [7, '7'], [5, '7'], [0, '7'], [7, '7']],
  },
];

/* A four-chord progression is over in two bars, so it goes round twice. */
export function progressionLesson(prog, tonicPc = 0, transpose = DEFAULT_TRANSPOSE) {
  const once = prog.steps.map(([offset, quality]) => ({ root: (tonicPc + offset) % 12, quality }));
  const repeat = prog.repeat || 2;
  let steps = [];
  for (let r = 0; r < repeat; r++) steps = steps.concat(once);
  const keySig = majorKeyFifths(tonicPc + (prog.minor ? 3 : 0));
  const keyed = spell(tonicPc + 60, keySig).label + ' ' + prog.id;
  return chordSong({
    id: 'prog-' + prog.id.replace(/\s+/g, '-') + '-' + tonicPc,
    name: keyed.length <= 13 ? keyed : prog.id,
    steps,
    bpm: 70,
    beatsPer: prog.beatsPer || 2,
    keySig,
    transpose,
  });
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
