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
import { MIN_PITCH, MAX_PITCH, LETTERS, NATURAL_PC, spell, majorKeyFifths } from './notation.mjs';
import { qualityById, buildChord, chordSymbol } from './chords.mjs';
import { DEFAULT_TRANSPOSE } from './padmap.mjs';

/* ---- Time ------------------------------------------------------------------- */

/* Milliseconds. Slow enough to hear each note as a note, quick enough that two
 * of them are still heard as one interval. */
export const NOTE_GAP = 700;
const NOTE_LEN = 650;
const CHORD_LEN = 1400;
const ARP_GAP = 300;
const CADENCE_STEP = 750;
const SLOW = 1.5;

const ev = (pitch, at, dur) => ({ pitch, at, dur });

function melodic(pitches, at = 0) {
  return pitches.map((p, i) => ev(p, at + i * NOTE_GAP, NOTE_LEN));
}

function together(pitches, at = 0, dur = CHORD_LEN) {
  return pitches.map((p) => ev(p, at, dur));
}

/* Low to high, then all together: hear the parts, then the colour. */
function broken(pitches, at = 0) {
  const sorted = pitches.slice().sort((a, b) => a - b);
  const up = sorted.map((p, i) => ev(p, at + i * ARP_GAP, ARP_GAP));
  return up.concat(together(sorted, at + sorted.length * ARP_GAP + 150));
}

/* When the last note of a prompt stops. */
export function promptLength(events) {
  let end = 0;
  for (let i = 0; i < events.length; i++) {
    end = Math.max(end, events[i].at + events[i].dur);
  }
  return end;
}

/*
 * The first rung of help: the same prompt, slower, with every chord broken
 * into its notes before it sounds whole. Groups are the notes that start
 * together; a single note keeps its place, only further apart.
 */
export function slowed(events) {
  const onsets = [];
  for (let i = 0; i < events.length; i++) {
    if (onsets.indexOf(events[i].at) < 0) onsets.push(events[i].at);
  }
  onsets.sort((a, b) => a - b);

  const out = [];
  let t = 0;
  for (let g = 0; g < onsets.length; g++) {
    const group = events.filter((e) => e.at === onsets[g]).sort((a, b) => a.pitch - b.pitch);
    const dur = Math.max(...group.map((e) => e.dur));
    const next = g + 1 < onsets.length ? onsets[g + 1] - onsets[g] : dur;
    if (group.length > 1) {
      for (let i = 0; i < group.length; i++) out.push(ev(group[i].pitch, t + i * ARP_GAP * SLOW, ARP_GAP * SLOW));
      t += group.length * ARP_GAP * SLOW + 150;
    }
    for (let i = 0; i < group.length; i++) out.push(ev(group[i].pitch, t, dur * SLOW));
    t += next * SLOW;
  }
  return out;
}

/* ---- Spelling the answer ---------------------------------------------------- */

const pcOf = (pitch) => ((pitch % 12) + 12) % 12;
const ACCIDENTAL = { '-2': 'bb', '-1': 'b', 0: '', 1: '#', 2: 'x' };

/* A note named as the key it would be the tonic of names it: Eb, not D#. */
function rootName(pitch) {
  return spell(pitch, majorKeyFifths(pcOf(pitch)));
}

/*
 * The note `semis` above `root` with the letter `steps` on from the root's,
 * so a minor third above C reads Eb and never D#. That is what makes the
 * revealed answer agree with the interval's name.
 */
function spellAbove(root, semis, steps) {
  const r = rootName(root);
  const letterIndex = (r.letterIndex + steps - 1) % 7;
  let alter = pcOf(root + semis - NATURAL_PC[letterIndex]);
  if (alter > 6) alter -= 12;
  return LETTERS[letterIndex] + (ACCIDENTAL[alter] ?? '?');
}

function noteNames(pitches) {
  return pitches.map((p) => rootName(p).label).join('-');
}

/* ---- Intervals -------------------------------------------------------------- */

export const INTERVALS = [
  { key: 'm2', semis: 1, steps: 2, label: 'Minor 2nd' },
  { key: 'M2', semis: 2, steps: 2, label: 'Major 2nd' },
  { key: 'm3', semis: 3, steps: 3, label: 'Minor 3rd' },
  { key: 'M3', semis: 4, steps: 3, label: 'Major 3rd' },
  { key: 'P4', semis: 5, steps: 4, label: 'Perfect 4th' },
  { key: 'TT', semis: 6, steps: 4, label: 'Tritone' },
  { key: 'P5', semis: 7, steps: 5, label: 'Perfect 5th' },
  { key: 'm6', semis: 8, steps: 6, label: 'Minor 6th' },
  { key: 'M6', semis: 9, steps: 6, label: 'Major 6th' },
  { key: 'm7', semis: 10, steps: 7, label: 'Minor 7th' },
  { key: 'M7', semis: 11, steps: 7, label: 'Major 7th' },
  { key: 'P8', semis: 12, steps: 8, label: 'Octave' },
];

const interval = (key) => INTERVALS.find((i) => i.key === key);
const intervalAnswers = (keys) => keys.map((k) => ({ key: k, label: interval(k).label }));

/* Every root, every interval, played the way the level says. */
function intervalPrompts(keys, way) {
  return ({ lo, hi }) => {
    const out = [];
    for (let root = lo; root <= hi; root++) {
      for (let k = 0; k < keys.length; k++) {
        const iv = interval(keys[k]);
        const top = root + iv.semis;
        const names = rootName(root).label + '-' + spellAbove(root, iv.semis, iv.steps);
        let events;
        if (way === 'down') events = melodic([top, root]);
        else if (way === 'together') events = together([root, top]);
        else events = melodic([root, top]);
        out.push({ answer: iv.key, events, label: names + ' ' + iv.key });
      }
    }
    return out;
  };
}

const SECONDS_THIRDS = ['m2', 'M2', 'm3', 'M3'];
const GROUP_1 = ['m2', 'M2', 'm3', 'M3', 'P4', 'P5', 'P8'];
const GROUP_2 = ['m2', 'M2', 'm3', 'M3', 'P4', 'P5', 'm6', 'M6', 'P8'];
const GROUP_3 = INTERVALS.map((i) => i.key);

/* The three staged levels the full interval exercises share. */
function groupLevels(way) {
  return [
    { key: 'g1', name: '2-5,8', answers: intervalAnswers(GROUP_1), prompts: intervalPrompts(GROUP_1, way) },
    { key: 'g2', name: '+6ths', answers: intervalAnswers(GROUP_2), prompts: intervalPrompts(GROUP_2, way) },
    { key: 'g3', name: 'all', answers: intervalAnswers(GROUP_3), prompts: intervalPrompts(GROUP_3, way) },
  ];
}

/* ---- Chords ----------------------------------------------------------------- */

const CHORD_LABELS = {
  maj: 'Major', min: 'Minor', dim: 'Diminished', aug: 'Augmented',
  maj7: 'Major 7th', 7: 'Dominant 7th', m7: 'Minor 7th', m7b5: 'Half-dim 7th',
};
const chordAnswers = (ids) => ids.map((id) => ({ key: id, label: CHORD_LABELS[id] }));

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
    key: 'direction', name: 'Higher or lower', short: 'High/low', question: 'second note is...',
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
    key: 'playback-notes', name: 'Play it back', short: 'Play back',
    levels: [
      { key: 'key', name: 'in key', quiz: { kind: 'notes', hear: true, halfTones: false } },
      { key: 'half', name: 'chromatic', quiz: { kind: 'notes', hear: true, halfTones: true } },
    ],
  },
  {
    key: 'steps', name: 'Step or leap', short: 'Step/leap', question: 'step or leap?',
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
    key: 'contour', name: 'Melody shape', short: 'Shape', question: 'which way?',
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
    key: 'thirds', name: 'Major or minor 3rd', short: '3rds', question: 'major or minor?',
    answers: intervalAnswers(['M3', 'm3']),
    levels: [
      { key: 'up', name: 'up', prompts: intervalPrompts(['M3', 'm3'], 'up') },
      { key: 'down', name: 'down', prompts: intervalPrompts(['M3', 'm3'], 'down') },
      { key: 'together', name: 'together', prompts: intervalPrompts(['M3', 'm3'], 'together') },
    ],
  },
  {
    key: 'triads', name: 'Major or minor', short: 'Maj/min', question: 'major or minor?',
    answers: chordAnswers(['maj', 'min']),
    levels: [
      { key: 'broken', name: 'broken', prompts: chordPrompts(['maj', 'min'], 'broken') },
      { key: 'block', name: 'block', prompts: chordPrompts(['maj', 'min'], 'block') },
      { key: 'inversions', name: 'inverted', prompts: chordPrompts(['maj', 'min'], 'inversions') },
    ],
  },
  {
    key: 'perfect', name: 'Perfect intervals', short: '4/5/8', question: 'which interval?',
    answers: intervalAnswers(['P4', 'P5', 'P8']),
    levels: [
      { key: 'up', name: 'up', prompts: intervalPrompts(['P4', 'P5', 'P8'], 'up') },
      { key: 'together', name: 'together', prompts: intervalPrompts(['P4', 'P5', 'P8'], 'together') },
    ],
  },
  {
    key: 'seconds-thirds', name: '2nds and 3rds', short: '2nds/3rds', question: 'which interval?',
    answers: intervalAnswers(SECONDS_THIRDS),
    levels: [
      { key: 'up', name: 'up', prompts: intervalPrompts(SECONDS_THIRDS, 'up') },
      { key: 'down', name: 'down', prompts: intervalPrompts(SECONDS_THIRDS, 'down') },
    ],
  },
  { key: 'intervals-up', name: 'Intervals up', short: 'Int up', question: 'which interval?', levels: groupLevels('up') },
  { key: 'intervals-down', name: 'Intervals down', short: 'Int down', question: 'which interval?', levels: groupLevels('down') },
  { key: 'intervals-together', name: 'Intervals together', short: 'Int tog', question: 'which interval?', levels: groupLevels('together') },
  {
    key: 'four-triads', name: 'Four triads', short: '4 triads', question: 'which chord?',
    answers: chordAnswers(['maj', 'min', 'dim', 'aug']),
    levels: [
      { key: 'broken', name: 'broken', prompts: chordPrompts(['maj', 'min', 'dim', 'aug'], 'broken') },
      { key: 'block', name: 'block', prompts: chordPrompts(['maj', 'min', 'dim', 'aug'], 'block') },
    ],
  },
  {
    key: 'key-quality', name: 'Major or minor key', short: 'Key', question: 'major or minor?',
    answers: [{ key: 'major', label: 'Major key' }, { key: 'minor', label: 'Minor key' }],
    levels: [
      { key: 'scale', name: 'scale', lines: [[0, 1, 2, 3, 4, 5, 6, 7]] },
      { key: 'melody', name: 'melody', lines: MELODIES },
    ],
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
    key: 'home', name: 'Home or away', short: 'Home/away', question: 'did it end at home?',
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
    key: 'degrees', name: 'Scale degrees', short: 'Degrees', question: 'which degree?',
    levels: [
      { key: '135', name: '1 3 5', answers: degreeAnswers([0, 2, 4]), prompts: degreePrompts([0, 2, 4]) },
      { key: 'all', name: 'all', answers: degreeAnswers([0, 1, 2, 3, 4, 5, 6]), prompts: degreePrompts([0, 1, 2, 3, 4, 5, 6]) },
    ],
  },
  {
    key: 'sevenths', name: 'Seventh chords', short: '7ths', question: 'which chord?',
    levels: [
      { key: 'three', name: '3 types', answers: chordAnswers(['maj7', '7', 'm7']), prompts: chordPrompts(['maj7', '7', 'm7'], 'broken') },
      { key: 'four', name: '4 types', answers: chordAnswers(['maj7', '7', 'm7', 'm7b5']), prompts: chordPrompts(['maj7', '7', 'm7', 'm7b5'], 'broken') },
    ],
  },
  {
    key: 'functions', name: 'Chords in a key', short: 'Chords', question: 'after I comes...',
    levels: [
      { key: 'iv-v', name: 'IV V', answers: [{ key: 'IV', label: 'IV' }, { key: 'V', label: 'V' }], prompts: functionPrompts(['IV', 'V']) },
      { key: 'iv-v-vi', name: 'IV V vi', answers: [{ key: 'IV', label: 'IV' }, { key: 'V', label: 'V' }, { key: 'vi', label: 'vi' }], prompts: functionPrompts(['IV', 'V', 'vi']) },
    ],
  },
  {
    key: 'playback-chords', name: 'Play the chord', short: 'Play chord',
    levels: [
      { key: 'triads', name: 'triads', quiz: { kind: 'chords', hear: true, chordSet: 'triads' } },
      { key: 'types', name: 'types', quiz: { kind: 'chords', hear: true, chordSet: 'types' } },
      { key: 'advanced', name: 'advanced', quiz: { kind: 'chords', hear: true, chordSet: 'advanced' } },
    ],
  },
];

export function exerciseByKey(key) {
  return EXERCISES.find((e) => e.key === key) || null;
}

/* 1-based, from the list's order, so the numbering cannot drift from it. */
export function exerciseNumber(exercise) {
  return EXERCISES.indexOf(exercise) + 1;
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

/* Every prompt the level can ask at this transpose: { answer, events, pitches, label }. */
export function buildEarPool(exercise, levelKey, transpose = DEFAULT_TRANSPOSE) {
  if (!isNaming(exercise)) return [];
  const level = levelByKey(exercise, levelKey);
  const range = earRange(transpose);
  const make = level.prompts || exercise.prompts;
  const pool = [];
  const raw = make(range, level);
  for (let i = 0; i < raw.length; i++) {
    const pitches = pitchesOf(raw[i].events);
    if (pitches.some((p) => p < range.lo || p > range.hi)) continue;
    pool.push({ answer: raw[i].answer, events: raw[i].events, pitches, label: raw[i].label });
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
export function pickEntry(groups, rand, previous = null) {
  if (!groups.length) return null;
  let chosen = null;
  for (let guard = 8; guard >= 0; guard--) {
    const group = groups[Math.floor(rand() * groups.length)];
    chosen = group[Math.floor(rand() * group.length)];
    if (chosen !== previous) break;
  }
  return chosen;
}
