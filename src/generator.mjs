// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * generator.mjs — procedural exercises. Pure and seeded, so the same seed
 * always yields the same exercise (which is what makes it testable, and lets
 * you re-attempt the drill you just fluffed instead of a different one).
 *
 * Every builder returns the same chart shape exercise_io.mjs validates, so
 * generated and hand-written material are interchangeable downstream.
 */

import { scaleKey } from './notation.mjs';
import { MODES, MODE_LABELS, scaleById } from './scales.mjs';
import { DEFAULT_TRANSPOSE, MIDI_BASE_NOTE, ABS_SEMI_LO, ABS_SEMI_HI } from './padmap.mjs';

/*
 * Move's own scales, all twenty-two, and what the settings row prints for
 * each: one list with the ear course's scales now, in scales.mjs. Re-exported
 * here because everything that generates from a scale already imports this.
 *
 * NOT all of these are seven-note scales, and the chord drills notice:
 * triadOn stacks every other degree, which is a real augmented triad in whole
 * tone and three adjacent semitones in chromatic. nameChord returns null
 * there, so the drill shows notes without claiming a name.
 */
export { MODES, MODE_LABELS };

/* A scale's steps and its short name, by id: Move's scales and the course's
 * alike (a scale trainer asks for Lydian dominant too); major for an unknown
 * id, as the Scale setting has always fallen back. */
function stepsOf(mode) {
  return (scaleById(mode) || scaleById('major')).steps;
}

function labelOf(mode) {
  const sc = scaleById(mode);
  return sc ? sc.short : mode;
}

export const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/* The pitches both the staff and the pad grid can reach at a given transpose. */
export function playableRange(transpose = DEFAULT_TRANSPOSE) {
  return {
    lo: ABS_SEMI_LO + MIDI_BASE_NOTE + transpose,
    hi: ABS_SEMI_HI + MIDI_BASE_NOTE + transpose,
  };
}

/* mulberry32 — small, fast, and identical across runs. */
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Ascending scale pitches of `mode` rooted on `rootPc`, inside [lo, hi]. */
export function scalePitches(rootPc, mode, lo, hi) {
  const ivs = stepsOf(mode);
  const out = [];
  for (let pitch = lo; pitch <= hi; pitch++) {
    const rel = (((pitch - rootPc) % 12) + 12) % 12;
    if (ivs.indexOf(rel) >= 0) out.push(pitch);
  }
  return out;
}

/* The scale degree `steps` on from `index`, clamped to the ends of the range. */
function stepInScale(pitches, index, steps) {
  const i = index + steps;
  return pitches[Math.max(0, Math.min(pitches.length - 1, i))];
}

/*
 * The triad rooted on scale degree `index`: stacked thirds of the scale, so it
 * is diatonic by construction and comes out major, minor or diminished
 * according to where in the scale it sits.
 *
 * Shared with the note guesser rather than copied — one definition of what a
 * chord on a degree is.
 */
export function triadOn(pitches, index) {
  const notes = [
    stepInScale(pitches, index, 0),
    stepInScale(pitches, index, 2),
    stepInScale(pitches, index, 4),
  ];
  return notes.filter((p, i, arr) => arr.indexOf(p) === i);
}

/* Highest root index that still leaves room for the whole chord above it. */
export function fitsTriad(pitches, index) {
  return index >= 0 && index + 4 <= pitches.length - 1;
}

/*
 * The key a generated drill is written in: the scale's own spelling (C minor
 * is Eb Ab Bb, F# major has its E#) and the signature it would carry.
 */
export function keyForScale(rootPc, mode) {
  return scaleKey(rootPc, stepsOf(mode), mode);
}

function makeChart(id, name, bpm, key, events, extra = {}) {
  return { id, name, bpm, timeSig: [4, 4], keySig: key.fifths, spelling: key.map, events, ...extra };
}

/*
 * A scale run, one note per beat.
 * direction: 'up' | 'down' | 'updown'
 */
export function scaleRun({
  rootPc = 0,
  mode = 'major',
  octaves = 1,
  direction = 'updown',
  bpm = 80,
  transpose = DEFAULT_TRANSPOSE,
  startPitch = null,
} = {}) {
  const { lo, hi } = playableRange(transpose);
  const all = scalePitches(rootPc, mode, lo, hi);
  const degrees = stepsOf(mode).length;
  let start = 0;
  if (startPitch != null) {
    start = all.findIndex((p) => p >= startPitch);
    if (start < 0) start = 0;
  } else {
    /* Start on the lowest root that leaves room for the whole run. */
    const need = degrees * octaves + 1;
    for (let i = 0; i < all.length; i++) {
      if ((((all[i] - rootPc) % 12) + 12) % 12 === 0 && i + need <= all.length) {
        start = i;
        break;
      }
    }
  }
  const count = Math.min(degrees * octaves + 1, all.length - start);
  const up = [];
  for (let i = 0; i < count; i++) up.push(all[start + i]);

  let seq;
  if (direction === 'up') seq = up;
  else if (direction === 'down') seq = up.slice().reverse();
  else seq = up.concat(up.slice(0, -1).reverse());

  const events = seq.map((pitch, i) => ({ beat: i, durBeats: 1, pitches: [pitch] }));
  /* The display label, not the id: the header has room for "C# Phryg Dom",
   * and "C# phrygianDominant scale" ran off the end of it. */
  const key = keyForScale(rootPc, mode);
  const name = `${key.root} ${labelOf(mode)}`;
  return makeChart(`scale-${rootPc}-${mode}-${direction}-${octaves}`, name, bpm, key, events);
}

/*
 * Interval drill: a root, then the note `steps` scale degrees above it, over
 * and over. steps 2 = thirds, 4 = fifths, and so on.
 */
export function intervalDrill({
  rootPc = 0,
  mode = 'major',
  steps = 2,
  count = 8,
  bpm = 80,
  transpose = DEFAULT_TRANSPOSE,
  seed = 1,
} = {}) {
  const { lo, hi } = playableRange(transpose);
  const all = scalePitches(rootPc, mode, lo, hi);
  const rand = rng(seed);
  const events = [];
  for (let i = 0; i < count; i++) {
    const base = Math.floor(rand() * Math.max(1, all.length - steps));
    events.push({ beat: i * 2, durBeats: 1, pitches: [all[base]] });
    events.push({ beat: i * 2 + 1, durBeats: 1, pitches: [stepInScale(all, base, steps)] });
  }
  const label = { 1: '2nds', 2: '3rds', 3: '4ths', 4: '5ths', 5: '6ths', 6: '7ths' }[steps] || `${steps + 1}ths`;
  const key = keyForScale(rootPc, mode);
  return makeChart(`iv-${rootPc}-${mode}-${steps}-${seed}`, `${key.root} ${label}`, bpm, key, events);
}

/*
 * Triads built on scale degrees, one chord every two beats.
 * `degrees` are 0-based: [0,3,4,0] is I-IV-V-I.
 */
export function triadDrill({
  rootPc = 0,
  mode = 'major',
  degrees = [0, 3, 4, 0],
  bpm = 70,
  transpose = DEFAULT_TRANSPOSE,
} = {}) {
  const { lo, hi } = playableRange(transpose);
  const all = scalePitches(rootPc, mode, lo, hi);
  const size = stepsOf(mode).length;
  /* Root the set as high as the range allows while still leaving room for the
   * top tone of the highest chord — otherwise stepInScale() clamps and IV and
   * V collapse into unisons. */
  const need = Math.max(...degrees) + 4;
  let base = -1;
  for (let i = 0; i < all.length; i++) {
    if ((((all[i] - rootPc) % 12) + 12) % 12 !== 0) continue;
    if (i + need <= all.length - 1) base = i;
  }
  if (base < 0) base = 0;
  const events = degrees.map((deg, i) => ({
    beat: i * 2,
    durBeats: 2,
    pitches: triadOn(all, base + deg),
  }));
  const roman = degrees.map((d) => ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][d % size]).join('-');
  const key = keyForScale(rootPc, mode);
  return makeChart(`triad-${rootPc}-${mode}-${degrees.join('')}`, `${key.root} ${roman}`, bpm, key, events);
}

/*
 * Random reading practice inside a key. `density` is notes per beat: 1 gives
 * quarters, 2 gives eighths.
 */
export function randomInKey({
  rootPc = 0,
  mode = 'major',
  bars = 4,
  density = 1,
  bpm = 80,
  transpose = DEFAULT_TRANSPOSE,
  span = 8,
  seed = 1,
} = {}) {
  const { lo, hi } = playableRange(transpose);
  const all = scalePitches(rootPc, mode, lo, hi);
  const rand = rng(seed);
  const notes = Math.max(1, Math.round(bars * 4 * density));
  const step = 1 / density;
  const centre = Math.floor(all.length / 2);
  const half = Math.floor(span / 2);
  const events = [];
  let idx = centre;
  for (let i = 0; i < notes; i++) {
    /* Random walk, so the line is playable rather than a pitch lottery. */
    idx += Math.round((rand() - 0.5) * 5);
    idx = Math.max(centre - half, Math.min(centre + half, idx));
    idx = Math.max(0, Math.min(all.length - 1, idx));
    events.push({ beat: i * step, durBeats: step, pitches: [all[idx]] });
  }
  const key = keyForScale(rootPc, mode);
  return makeChart(`rnd-${rootPc}-${mode}-${seed}`, `${key.root} reading`, bpm, key, events);
}

/*
 * The drills one scale offers, in order. The scale is the caller's: each of
 * the Basics scale folders passes its own, so the list under Dorian is Dorian
 * whatever the Scale setting says. The key still comes from the settings.
 */
export function scaleDrills(opts = {}) {
  const { rootPc = 0, mode = 'major', bpm = 80, transpose = DEFAULT_TRANSPOSE, seed = 1 } = opts;
  const base = { rootPc, mode, bpm, transpose };
  return [
    { label: 'Up & down', build: () => scaleRun({ ...base, direction: 'updown' }) },
    { label: 'Up', build: () => scaleRun({ ...base, direction: 'up' }) },
    { label: 'Down', build: () => scaleRun({ ...base, direction: 'down' }) },
    { label: 'Thirds', build: () => intervalDrill({ ...base, steps: 2, seed }) },
    { label: 'Fifths', build: () => intervalDrill({ ...base, steps: 4, seed }) },
  ];
}

/* Random reading lines in the key and scale the settings name. */
export function readingDrills(opts = {}) {
  const { rootPc = 0, mode = 'major', bpm = 80, transpose = DEFAULT_TRANSPOSE, seed = 1 } = opts;
  const base = { rootPc, mode, bpm, transpose };
  return [
    { label: 'Easy', build: () => randomInKey({ ...base, bars: 4, density: 1, seed }) },
    { label: 'Fast', build: () => randomInKey({ ...base, bars: 4, density: 2, seed }) },
  ];
}
