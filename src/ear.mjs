// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * ear.mjs — the Hearing exercises: you hear something, you name it. Pure.
 *
 * The other drills show you a prompt and ask you to find it. These withhold
 * everything but the sound, which is the one skill the staff and the lit pads
 * can never teach: telling a major third from a minor one, or a finished
 * phrase from one left hanging, with nothing to read.
 *
 * The list is ordered by difficulty, the way aural-skills courses run it:
 *
 *   - two answers and big differences first, more answers later
 *   - melodic before harmonic, ascending before descending
 *   - a contrasting pair (major / minor third) before the full set
 *   - answers in a FIXED order, so where an answer sits becomes habit
 *   - a random root every time, so nobody answers by absolute pitch
 *
 * An exercise is data plus one generator. A generator returns every prompt it
 * could ask over a range, naively; buildEarPool keeps the ones the pads and the
 * staff can show. A prompt is a list of timed note events, so one shape covers
 * a melodic interval, a block chord, an arpeggio and a cadence with a note
 * after it — the player only ever has to schedule events.
 *
 * Two entries are not naming drills: Play it back sends you to the existing
 * Hear drills, which ask you to find what you heard on the pads. They sit in
 * this list so the track is numbered in one place.
 */

import { MODES, scalePitches, playableRange } from './generator.mjs';
import { MIN_PITCH, MAX_PITCH, majorKeyFifths } from './notation.mjs';
import { qualityById, buildChord, chordSymbol } from './chords.mjs';
import { DEFAULT_TRANSPOSE } from './padmap.mjs';
import {
  NOTE_LEN, ev, melodic, together, broken, pcOf, rootName, noteNames,
} from './ear_core.mjs';
import { COURSES } from './ear_course.mjs';
import { READ_COURSES } from './read_course.mjs';

export { NOTE_GAP, INTERVALS, promptLength, slowed } from './ear_core.mjs';

const CADENCE_STEP = 750;

/* ---- Chords ----------------------------------------------------------------- */

/* Answers are the qualities' own names (chords.mjs), keyed by their ids. */
const chordAnswers = (ids) => ids.map((id) => ({ key: id, label: qualityById(id).name }));

/* Root position, then the first and second inversions: the same chord with
 * its lowest note moved up an octave, once and twice. */
function inversions(pitches) {
  const out = [pitches];
  let cur = pitches;
  for (let i = 1; i < pitches.length; i++) {
    cur = cur.slice(1).concat([cur[0] + 12]);
    out.push(cur);
  }
  return out;
}

function chordPrompts(ids, voicing) {
  return ({ lo, hi }) => {
    const out = [];
    for (let root = lo; root <= hi; root++) {
      for (let q = 0; q < ids.length; q++) {
        const quality = qualityById(ids[q]);
        const label = chordSymbol(root, quality, majorKeyFifths(pcOf(root)));
        const shapes = voicing === 'inversions' ? inversions(buildChord(root, quality)) : [buildChord(root, quality)];
        for (let s = 0; s < shapes.length; s++) {
          const events = voicing === 'broken' ? broken(shapes[s]) : together(shapes[s]);
          out.push({ answer: ids[q], events, label });
        }
      }
    }
    return out;
  };
}

/* ---- Keys ------------------------------------------------------------------- */

const MAJOR = MODES.major;

/* Scale degree `d` (0 = tonic, may be negative or past 6) above `tonic`. */
function degree(tonic, mode, d) {
  const ivs = MODES[mode];
  const oct = Math.floor(d / 7);
  return tonic + 12 * oct + ivs[d - oct * 7];
}

const keyName = (tonic, mode) => rootName(tonic).label + (mode === 'minor' ? ' minor' : ' major');

/* The tonic chord, so the phrase after it has a home to be heard against. */
const tonicChord = (t) => together([t, t + 4, t + 7], 0, 1000);
const PHRASE_AT = 1300;

/* I – IV – V – I, voiced close around the tonic so it sits in reach. */
function cadence(t) {
  const chords = [[t, t + 4, t + 7], [t, t + 5, t + 9], [t - 1, t + 2, t + 7], [t, t + 4, t + 7]];
  const out = [];
  for (let i = 0; i < chords.length; i++) out.push(...together(chords[i], i * CADENCE_STEP, 700));
  return out;
}
const AFTER_CADENCE = 4 * CADENCE_STEP + 500;

/* Every line touches the third: that is the note that makes it major or minor. */
const MELODIES = [[0, 1, 2, 1, 0], [0, 2, 4, 2, 0], [4, 3, 2, 1, 0], [0, 2, 1, 3, 2, 0], [4, 2, 0], [0, 1, 2, 3, 4, 2, 0]];

/* Lines in major. Finished ones land on the tonic; the rest stop anywhere else. */
const FINISHED = [[2, 1, 0], [4, 3, 2, 1, 0], [4, 2, 1, 0], [1, -1, 0], [2, 4, 1, 0], [0, 2, 1, -1, 0]];
const UNFINISHED = [[0, 1, 2, 1], [2, 1, 0, 1], [0, 2, 4, 3], [0, 1, -1], [2, 3, 4], [4, 3, 2, 1], [0, 2, 3, 1]];

const SOLFEGE = ['do', 're', 'mi', 'fa', 'sol', 'la', 'ti'];
const degreeAnswers = (ds) => ds.map((d) => ({ key: String(d + 1), label: (d + 1) + ' ' + SOLFEGE[d] }));

function degreePrompts(ds) {
  return ({ lo, hi }) => {
    const out = [];
    for (let t = lo; t <= hi; t++) {
      for (let i = 0; i < ds.length; i++) {
        const target = t + MAJOR[ds[i]];
        const events = cadence(t).concat([ev(target, AFTER_CADENCE, NOTE_LEN * 2)]);
        out.push({ answer: String(ds[i] + 1), events, label: 'in ' + keyName(t, 'major') + ': ' + rootName(target).label });
      }
    }
    return out;
  };
}

/* Root position, so the bass moves the way the function does. */
const FUNCTIONS = { IV: [5, 9, 12], V: [7, 11, 14], vi: [9, 12, 16] };

function functionPrompts(keys) {
  return ({ lo, hi }) => {
    const out = [];
    for (let t = lo; t <= hi; t++) {
      for (let k = 0; k < keys.length; k++) {
        const chord = FUNCTIONS[keys[k]].map((s) => t + s);
        const events = together([t, t + 4, t + 7], 0, 900).concat(together(chord, 1000, 1300));
        out.push({ answer: keys[k], events, label: 'in ' + keyName(t, 'major') + ': ' + keys[k] });
      }
    }
    return out;
  };
}

/* ---- The list --------------------------------------------------------------- */

/*
 * `name` titles the exercise in a list and has its number in front, so it
 * stays within 18 characters; `short` + a level name is the drill's label in
 * the progress screen, within 21. `question` heads the answer list.
 */
export const EXERCISES = [
  {
    key: 'direction', topic: 'pitch', name: 'Higher or lower', short: 'High/low', question: 'second note is...',
    answers: [{ key: 'higher', label: 'Higher' }, { key: 'same', label: 'Same' }, { key: 'lower', label: 'Lower' }],
    levels: [{ key: 'wide', name: 'wide', gaps: [5, 7, 9, 12] }, { key: 'narrow', name: 'close', gaps: [1, 2, 3, 4] }],
    prompts: ({ lo, hi }, level) => {
      const out = [];
      for (let root = lo; root <= hi; root++) {
        out.push({ answer: 'same', events: melodic([root, root]), label: noteNames([root, root]) });
        for (let i = 0; i < level.gaps.length; i++) {
          const g = level.gaps[i];
          out.push({ answer: 'higher', events: melodic([root, root + g]), label: noteNames([root, root + g]) });
          out.push({ answer: 'lower', events: melodic([root, root - g]), label: noteNames([root, root - g]) });
        }
      }
      return out;
    },
  },
  {
    key: 'playback-notes', topic: 'pitch', name: 'Play it back', short: 'Play back',
    levels: [
      { key: 'key', name: 'in key', quiz: { kind: 'notes', hear: true, halfTones: false } },
      { key: 'half', name: 'chromatic', quiz: { kind: 'notes', hear: true, halfTones: true } },
    ],
  },
  {
    key: 'steps', topic: 'pitch', name: 'Step or leap', short: 'Step/leap', question: 'step or leap?',
    answers: [{ key: 'step', label: 'Step' }, { key: 'leap', label: 'Leap' }],
    levels: [{ key: 'key', name: 'in key' }],
    prompts: ({ lo, hi }) => {
      const out = [];
      for (let pc = 0; pc < 12; pc++) {
        const s = scalePitches(pc, 'major', lo, hi);
        for (let i = 0; i < s.length; i++) {
          for (let d = 1; d <= 4; d++) {
            if (i + d >= s.length) continue;
            const answer = d === 1 ? 'step' : 'leap';
            const pair = [s[i], s[i + d]];
            out.push({ answer, events: melodic(pair), label: noteNames(pair) });
            out.push({ answer, events: melodic([pair[1], pair[0]]), label: noteNames([pair[1], pair[0]]) });
          }
        }
      }
      return out;
    },
  },
  {
    key: 'contour', topic: 'pitch', name: 'Melody shape', short: 'Shape', question: 'which way?',
    answers: [
      { key: 'uu', label: 'Up, up' }, { key: 'ud', label: 'Up, down' },
      { key: 'du', label: 'Down, up' }, { key: 'dd', label: 'Down, down' },
    ],
    levels: [{ key: 'key', name: 'in key' }],
    prompts: ({ lo, hi }) => {
      const out = [];
      const moves = [-2, -1, 1, 2];
      for (let pc = 0; pc < 12; pc++) {
        const s = scalePitches(pc, 'major', lo, hi);
        for (let i = 0; i < s.length; i++) {
          for (const a of moves) {
            for (const b of moves) {
              const j = i + a;
              const k = j + b;
              if (j < 0 || k < 0 || j >= s.length || k >= s.length) continue;
              const line = [s[i], s[j], s[k]];
              const answer = (a > 0 ? 'u' : 'd') + (b > 0 ? 'u' : 'd');
              out.push({ answer, events: melodic(line), label: noteNames(line) });
            }
          }
        }
      }
      return out;
    },
  },
  {
    key: 'triads', topic: 'chords', name: 'Major/minor chord', short: 'Maj/min', question: 'major or minor?',
    answers: chordAnswers(['maj', 'min']),
    levels: [
      { key: 'broken', name: 'broken', prompts: chordPrompts(['maj', 'min'], 'broken') },
      { key: 'block', name: 'block', prompts: chordPrompts(['maj', 'min'], 'block') },
      { key: 'inversions', name: 'inverted', prompts: chordPrompts(['maj', 'min'], 'inversions') },
    ],
  },
  {
    key: 'four-triads', topic: 'chords', name: 'Four triads', short: '4 triads', question: 'which chord?',
    answers: chordAnswers(['maj', 'min', 'dim', 'aug']),
    levels: [
      { key: 'broken', name: 'broken', prompts: chordPrompts(['maj', 'min', 'dim', 'aug'], 'broken') },
      { key: 'block', name: 'block', prompts: chordPrompts(['maj', 'min', 'dim', 'aug'], 'block') },
    ],
  },
  {
    key: 'key-quality', topic: 'keys', name: 'Major or minor key', short: 'Key', question: 'major or minor?',
    answers: [{ key: 'major', label: 'Major key' }, { key: 'minor', label: 'Minor key' }],
    /* Its scale level is Identify scales › 1 Minor and major now (LEGACY). */
    levels: [{ key: 'melody', name: 'melody', lines: MELODIES }],
    prompts: ({ lo, hi }, level) => {
      const out = [];
      for (let t = lo; t <= hi; t++) {
        for (const mode of ['major', 'minor']) {
          for (const line of level.lines) {
            out.push({ answer: mode, events: melodic(line.map((d) => degree(t, mode, d))), label: keyName(t, mode) });
          }
        }
      }
      return out;
    },
  },
  {
    key: 'home', topic: 'keys', name: 'Home or away', short: 'Home/away', question: 'did it end at home?',
    answers: [{ key: 'home', label: 'Finished' }, { key: 'away', label: 'Unfinished' }],
    levels: [{ key: 'major', name: 'major' }],
    prompts: ({ lo, hi }) => {
      const out = [];
      for (let t = lo; t <= hi; t++) {
        for (const [answer, lines] of [['home', FINISHED], ['away', UNFINISHED]]) {
          for (const line of lines) {
            const last = line[line.length - 1];
            const d = ((last % 7) + 7) % 7;
            const events = tonicChord(t).concat(melodic(line.map((x) => degree(t, 'major', x)), PHRASE_AT));
            out.push({ answer, events, label: 'ends on ' + (d + 1) + ' ' + SOLFEGE[d] });
          }
        }
      }
      return out;
    },
  },
  {
    key: 'degrees', topic: 'keys', name: 'Scale degrees', short: 'Degrees', question: 'which degree?',
    levels: [
      { key: '135', name: '1 3 5', answers: degreeAnswers([0, 2, 4]), prompts: degreePrompts([0, 2, 4]) },
      { key: 'all', name: 'all', answers: degreeAnswers([0, 1, 2, 3, 4, 5, 6]), prompts: degreePrompts([0, 1, 2, 3, 4, 5, 6]) },
    ],
  },
  {
    key: 'sevenths', topic: 'chords', name: 'Seventh chords', short: '7ths', question: 'which chord?',
    levels: [
      { key: 'three', name: '3 types', answers: chordAnswers(['maj7', '7', 'm7']), prompts: chordPrompts(['maj7', '7', 'm7'], 'broken') },
      { key: 'four', name: '4 types', answers: chordAnswers(['maj7', '7', 'm7', 'm7b5']), prompts: chordPrompts(['maj7', '7', 'm7', 'm7b5'], 'broken') },
    ],
  },
  {
    key: 'functions', topic: 'keys', name: 'Chords in a key', short: 'Chords', question: 'after I comes...',
    levels: [
      { key: 'iv-v', name: 'IV V', answers: [{ key: 'IV', label: 'IV' }, { key: 'V', label: 'V' }], prompts: functionPrompts(['IV', 'V']) },
      { key: 'iv-v-vi', name: 'IV V vi', answers: [{ key: 'IV', label: 'IV' }, { key: 'V', label: 'V' }, { key: 'vi', label: 'vi' }], prompts: functionPrompts(['IV', 'V', 'vi']) },
    ],
  },
  {
    key: 'playback-chords', topic: 'chords', name: 'Play the chord', short: 'Play chord',
    levels: [
      { key: 'triads', name: 'triads', quiz: { kind: 'chords', hear: true, chordSet: 'triads' } },
      { key: 'types', name: 'types', quiz: { kind: 'chords', hear: true, chordSet: 'types' } },
      { key: 'advanced', name: 'advanced', quiz: { kind: 'chords', hear: true, chordSet: 'advanced' } },
    ],
  },
];

/* The hearing exercises, then every unit of every course: one namespace of
 * keys, so an id like ear:cmp-6ths:fix-up resolves wherever it was filed. */
const ALL = EXERCISES.concat(...COURSES.concat(READ_COURSES).map((c) => c.exercises));

export function exerciseByKey(key) {
  return ALL.find((e) => e.key === key) || null;
}

/*
 * The topics Quiz › Hear is grouped by, in order. Every exercise and course
 * names one; within a topic the courses come first, then the exercises.
 */
export const TOPICS = [
  { key: 'pitch', name: 'Pitch & melody' },
  { key: 'intervals', name: 'Intervals' },
  { key: 'chords', name: 'Chords' },
  { key: 'keys', name: 'Scales & keys' },
];

/*
 * Exercises the courses replaced, and where their ids lead now, so a
 * repetition or a Next filed under an old id still opens the same drill.
 * The interval groups map onto the course's spans: 2nds to the 5th, and to
 * the octave.
 */
const GROUP = { g1: 'id-to-5', g2: 'id-to-8', g3: 'id-to-8' };
/* A level the old exercise never had stays as it was, and so stays unknown. */
const groups = (way) => (lv) => (GROUP[lv] ? [GROUP[lv], way] : ['id-to-8', lv]);
const LEGACY = {
  thirds: (lv) => ['id-3rds', lv],
  perfect: (lv) => ['id-4-5-8', lv],
  'seconds-thirds': (lv) => ['id-2-3', lv],
  'intervals-up': groups('up'),
  'intervals-down': groups('down'),
  'intervals-together': groups('together'),
  'key-quality': (lv) => (lv === 'scale' ? ['sc-maj-min', 'up'] : ['key-quality', lv]),
};

/* [exercise key, level key] for an id's parts, followed through LEGACY. */
export function resolveLegacy(exKey, levelKey) {
  const move = LEGACY[exKey];
  return move ? move(levelKey) : [exKey, levelKey];
}

/* 1-based, from its list's order, so the numbering cannot drift from it. */
export function exerciseNumber(exercise) {
  const course = COURSES.concat(READ_COURSES).find((c) => c.exercises.indexOf(exercise) >= 0);
  return (course ? course.exercises : EXERCISES).indexOf(exercise) + 1;
}

export function levelByKey(exercise, key) {
  if (!exercise) return null;
  return exercise.levels.find((l) => l.key === key) || exercise.levels[0];
}

/* A naming drill asks for an answer; the others send you to the pads. */
export function isNaming(exercise) {
  return Boolean(exercise && !exercise.levels[0].quiz);
}

export function answersFor(exercise, level) {
  return (level && level.answers) || exercise.answers || [];
}

/* ---- The pool --------------------------------------------------------------- */

/* The pitches the pads AND the staff reach: everything asked can be played
 * back and shown once it is answered. */
export function earRange(transpose = DEFAULT_TRANSPOSE) {
  const { lo, hi } = playableRange(transpose);
  return { lo: Math.max(lo, MIN_PITCH), hi: Math.min(hi, MAX_PITCH) };
}

/* The distinct pitches of a prompt, in the order they first sound. */
function pitchesOf(events) {
  const out = [];
  const sorted = events.slice().sort((a, b) => a.at - b.at || a.pitch - b.pitch);
  for (let i = 0; i < sorted.length; i++) {
    if (out.indexOf(sorted[i].pitch) < 0) out.push(sorted[i].pitch);
  }
  return out;
}

/*
 * Where a level's prompts may sit. On the pads when its widest prompt fits
 * there with a few roots to spare, so what you heard can be played back; over
 * the whole staff when it does not — a two-octave interval is wider than the
 * grid, and hearing it needs no pad.
 */
export function levelRange(level, transpose = DEFAULT_TRANSPOSE) {
  /* A reading level is drawn, not played back: the whole staff, always. */
  if (level.staffOnly) return { lo: MIN_PITCH, hi: MAX_PITCH };
  const pads = earRange(transpose);
  if (!level.span || pads.hi - pads.lo >= level.span + 2) return pads;
  return { lo: MIN_PITCH, hi: MAX_PITCH };
}

/* Every prompt the level can ask at this transpose: { answer, events, pitches, label }. */
export function buildEarPool(exercise, levelKey, transpose = DEFAULT_TRANSPOSE) {
  if (!isNaming(exercise)) return [];
  const level = levelByKey(exercise, levelKey);
  const range = levelRange(level, transpose);
  const make = level.prompts || exercise.prompts;
  const pool = [];
  const raw = make(range, level);
  for (let i = 0; i < raw.length; i++) {
    const pitches = pitchesOf(raw[i].events);
    if (pitches.some((p) => p < range.lo || p > range.hi)) continue;
    const entry = { answer: raw[i].answer, events: raw[i].events, pitches, label: raw[i].label };
    if (raw[i].staff) entry.staff = raw[i].staff;
    pool.push(entry);
  }
  return pool;
}

/* The pool split by answer, in the answers' order, empty answers dropped. */
export function groupByAnswer(pool, answers) {
  return answers
    .map((a) => pool.filter((e) => e.answer === a.key))
    .filter((g) => g.length > 0);
}

/*
 * The next prompt: an answer first, uniformly, then a prompt for it. Picking
 * straight from the pool would ask "leap" four times as often as "step",
 * and always answering leap would score 80%.
 */
export function pickEntry(groups, rand, previous = null, weights = null) {
  if (!groups.length) return null;
  let total = 0;
  if (weights) for (const w of weights) total += w;
  const pickGroup = () => {
    if (!weights) return groups[Math.floor(rand() * groups.length)];
    let r = rand() * total;
    for (let i = 0; i < groups.length; i++) {
      r -= weights[i];
      if (r < 0) return groups[i];
    }
    return groups[groups.length - 1];
  };
  let chosen = null;
  for (let guard = 8; guard >= 0; guard--) {
    const group = pickGroup();
    chosen = group[Math.floor(rand() * group.length)];
    if (chosen !== previous) break;
  }
  return chosen;
}
