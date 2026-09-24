/*
 * generator.mjs — procedural exercises. Pure and seeded, so the same seed
 * always yields the same exercise (which is what makes it testable, and lets
 * you re-attempt the drill you just fluffed instead of a different one).
 *
 * Every builder returns the same chart shape exercise_io.mjs validates, so
 * generated and hand-written material are interchangeable downstream.
 */

import { majorKeyFifths } from './notation.mjs';
import { DEFAULT_TRANSPOSE, MIDI_BASE_NOTE, ABS_SEMI_LO, ABS_SEMI_HI } from './padmap.mjs';

/*
 * Move's own scales, all twenty-two of them.
 *
 * Not a list I chose: these are the names in the device's firmware
 * (`strings /opt/move/MoveOriginal`), so the module highlights the same pads
 * Move would for the same setting. Ordered familiar-first, because the jog
 * walks the list and major is the default; chromatic sits last as the
 * "no filtering" end of it.
 *
 * `pentatonic` was renamed `majorPent` when the rest arrived — see the v6
 * settings migration in ui.js, which exists because a stored value that is no
 * longer in the list is dropped silently.
 *
 * NOT all of these are seven-note scales, and the chord drills notice:
 * triadOn stacks every other degree, which is a real augmented triad in whole
 * tone and three adjacent semitones in chromatic. nameChord returns null
 * there, so the drill shows notes without claiming a name.
 */
export const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  majorPent: [0, 2, 4, 7, 9],
  minorPent: [0, 3, 5, 7, 10],
  minorBlues: [0, 3, 5, 6, 7, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  wholeTone: [0, 2, 4, 6, 8, 10],
  superLocrian: [0, 1, 3, 4, 6, 8, 10],
  phrygianDominant: [0, 1, 4, 5, 8, 10],
  bhairav: [0, 1, 4, 5, 7, 8, 11],
  hungarianMinor: [0, 2, 3, 6, 7, 8, 11],
  hirajoshi: [0, 2, 3, 7, 8],
  inSen: [0, 1, 5, 7, 10],
  iwato: [0, 1, 5, 6, 10],
  kumoi: [0, 2, 3, 7, 9],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

/*
 * What the settings row prints. Three of the real names are too wide: the row
 * leaves ~90px beside its label, and "Minor Pentatonic" and "Phrygian
 * Dominant" are past it, which would truncate the LABEL rather than the value.
 */
export const MODE_LABELS = {
  major: 'Major', minor: 'Minor', dorian: 'Dorian', mixolydian: 'Mixolydian',
  lydian: 'Lydian', phrygian: 'Phrygian', locrian: 'Locrian',
  majorPent: 'Maj Pentatonic', minorPent: 'Min Pentatonic', minorBlues: 'Minor Blues',
  harmonicMinor: 'Harmonic Min', melodicMinor: 'Melodic Min',
  wholeTone: 'Whole Tone', superLocrian: 'Super Locrian',
  phrygianDominant: 'Phryg Dom', bhairav: 'Bhairav',
  hungarianMinor: 'Hungarian Min', hirajoshi: 'Hirajoshi',
  inSen: 'In-Sen', iwato: 'Iwato', kumoi: 'Kumoi', chromatic: 'Chromatic',
};

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
  const ivs = MODES[mode] || MODES.major;
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

function makeChart(id, name, bpm, keySig, events, extra = {}) {
  return { id, name, bpm, timeSig: [4, 4], keySig, events, ...extra };
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
  const degrees = (MODES[mode] || MODES.major).length;
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
  const name = `${PC_NAMES[rootPc]} ${mode} scale`;
  return makeChart(`scale-${rootPc}-${mode}-${direction}-${octaves}`, name, bpm, majorKeyFifths(rootPc), events);
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
  return makeChart(`iv-${rootPc}-${mode}-${steps}-${seed}`, `${PC_NAMES[rootPc]} ${label}`, bpm, majorKeyFifths(rootPc), events);
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
  const size = (MODES[mode] || MODES.major).length;
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
  return makeChart(`triad-${rootPc}-${mode}-${degrees.join('')}`, `${PC_NAMES[rootPc]} ${roman}`, bpm, majorKeyFifths(rootPc), events);
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
  return makeChart(`rnd-${rootPc}-${mode}-${seed}`, `${PC_NAMES[rootPc]} reading`, bpm, majorKeyFifths(rootPc), events);
}

/* The generated exercises offered in the menu, in order. */
export function builtins(opts = {}) {
  const { rootPc = 0, mode = 'major', bpm = 80, transpose = DEFAULT_TRANSPOSE, seed = 1 } = opts;
  const base = { rootPc, mode, bpm, transpose };
  return [
    { label: 'Scale up/down', build: () => scaleRun({ ...base, direction: 'updown' }) },
    { label: 'Scale up', build: () => scaleRun({ ...base, direction: 'up' }) },
    { label: 'Thirds', build: () => intervalDrill({ ...base, steps: 2, seed }) },
    { label: 'Fifths', build: () => intervalDrill({ ...base, steps: 4, seed }) },
    { label: 'Triads I-IV-V-I', build: () => triadDrill({ ...base, degrees: [0, 3, 4, 0] }) },
    { label: 'Reading (easy)', build: () => randomInKey({ ...base, bars: 4, density: 1, seed }) },
    { label: 'Reading (fast)', build: () => randomInKey({ ...base, bars: 4, density: 2, seed }) },
  ];
}
