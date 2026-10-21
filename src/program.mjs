// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * program.mjs — the Learning Program: what to practise next. Pure.
 *
 * Four tracks run side by side, because reading, harmony, repertoire and ear
 * are different skills and a session that mixes them beats one that grinds a
 * single list:
 *
 *   Reading   scales, intervals and random lines, then the first tunes
 *   Chords    triads to altered dominants, and the progressions they make
 *   Songs     every bundled piece, rung by rung, easy to hard
 *   Hearing   name what you hear: pitch, intervals, chords, keys
 *
 * A track is units of steps, and a step is only a pointer at a row of the
 * lesson tree, by the same id progress.mjs files its results under. That is
 * what keeps the program from being a second, parallel record: play Ode to Joy
 * from Classics and its step in the program is done too.
 *
 * Nothing is ever locked. The program only recommends: a track's next step is
 * its first one not finished and not explicitly skipped, and Continue picks
 * the track you have left longest.
 */

import { drillId, drillLabel } from './stats.mjs';
import { availableLevels } from './levels.mjs';
import { item, isFinished } from './progress.mjs';
import { EXERCISES, TOPICS, exerciseByKey, isNaming, resolveLegacy } from './ear.mjs';
import { COURSES } from './ear_course.mjs';
import { READ_COURSES } from './read_course.mjs';
import { folder } from './catalog.mjs';

const SCALES = 'basics/scales/';
const CHORDS = 'basics/chords/';
const PROGS = 'basics/progressions/';
const RANDOM = 'basics/random/';

const scale = (mode, drill, label) => ({ id: SCALES + mode + '/' + drill, label });
const chord = (family, lesson, level, label) => ({
  id: CHORDS + family + '/' + lesson + '/' + level, label,
});
const prog = (id, level, label) => ({ id: PROGS + id + '/' + level, label });
const random = (row, label) => ({ id: RANDOM + row, label });
const tune = (song, level, label) => ({ id: 'song:' + song + '/' + level, label });

/* A quiz step pins its options for the round, whatever the settings say, so
 * the step asks the same thing for everyone who reaches it. */
function quiz(opts) {
  const q = opts.kind === EAR ? {
    kind: EAR, exercise: opts.exercise, level: opts.level, hear: true, pick: true,
  } : {
    kind: opts.kind,
    hear: Boolean(opts.hear),
    pick: Boolean(opts.pick),
    halfTones: Boolean(opts.halfTones),
    chordSet: opts.chordSet || 'triads',
  };
  const id = 'quiz:' + drillId(q);
  return { id, label: drillLabel(drillId(q)), quiz: q };
}

const N = 'notes';
const C = 'chords';
const EAR = 'ear';

const READING = [
  { name: 'First notes', steps: [
    scale('major', 'up-down', 'Major up & down'),
    scale('major', 'up', 'Major up'),
    scale('major', 'down', 'Major down'),
  ] },
  { name: 'Leaps', steps: [
    scale('major', 'thirds', 'Major thirds'),
    scale('major', 'fifths', 'Major fifths'),
    random('in-key', 'Random in key'),
  ] },
  /* Finding a pitch on the grid, and naming a lit pad: reading the
   * instrument rather than the staff. */
  { name: 'Find the note', steps: [
    quiz({ kind: N }), quiz({ kind: N, pick: true }),
  ] },
  { name: 'First tunes', steps: [
    tune('mary-had-a-lamb', '1r', 'Marys Lamb melody'),
    tune('ode-to-joy', '1r', 'Ode to Joy melody'),
    tune('twinkle', '1r', 'Twinkle melody'),
    tune('frere-jacques', '1r', 'Frere Jacques melody'),
  ] },
  { name: 'Minor and modes', steps: [
    scale('minor', 'up-down', 'Minor up & down'),
    scale('minor', 'thirds', 'Minor thirds'),
    scale('dorian', 'up-down', 'Dorian up & down'),
    scale('mixolydian', 'up-down', 'Mixolydian up & down'),
  ] },
  { name: 'Faster', steps: [
    random('in-key-fast', 'Random in key, fast'),
    scale('majorPent', 'up-down', 'Maj pentatonic'),
    scale('minorPent', 'up-down', 'Min pentatonic'),
    scale('minorBlues', 'up-down', 'Minor blues'),
  ] },
  { name: 'Every note', steps: [
    scale('harmonicMinor', 'up-down', 'Harmonic minor'),
    scale('chromatic', 'up-down', 'Chromatic'),
    random('all-notes', 'Random, all notes'),
    quiz({ kind: N, halfTones: true }), quiz({ kind: N, halfTones: true, pick: true }),
  ] },
];

/* `2r` is the shapes in the right hand; `3` is the shapes over their roots. */
const CHORD_TRACK = [
  { name: 'Triads', steps: [
    chord('triads', 'chord-maj', '2r', 'Major triad'),
    chord('triads', 'chord-min', '2r', 'Minor triad'),
    /* Hearing the difference belongs next to playing it: the Hearing track's
     * Major or minor chord, block chords, is the same item here. */
    { ...quiz({ kind: EAR, exercise: 'triads', level: 'block' }), label: 'Hear major or minor' },
    chord('triads', 'chord-maj', '3', 'Major, both hands'),
    chord('triads', 'chord-min', '3', 'Minor, both hands'),
    chord('triads', 'chord-dim', '2r', 'Diminished triad'),
    chord('triads', 'chord-aug', '2r', 'Augmented triad'),
  ] },
  { name: 'Inversions and sus', steps: [
    chord('inversions', 'inversions-maj', '2r', 'Major inversions'),
    chord('inversions', 'inversions-min', '2r', 'Minor inversions'),
    chord('sus-power', 'chord-sus2', '2r', 'Sus2'),
    chord('sus-power', 'chord-sus4', '2r', 'Sus4'),
    chord('sus-power', 'chord-5', '3', 'Power chords'),
  ] },
  { name: 'Progressions', steps: [
    prog('I-IV-V-I', '2r', 'I-IV-V-I shapes'),
    prog('I-IV-V-I', '3', 'I-IV-V-I both hands'),
    prog('I-V-vi-IV', '3', 'I-V-vi-IV'),
    prog('vi-IV-I-V', '3', 'vi-IV-I-V'),
    prog('i-iv-V-i', '3', 'i-iv-V-i'),
    random('triads/2r', 'Random triads'),
  ] },
  { name: 'Sevenths', steps: [
    chord('sevenths', 'chord-maj7', '2r', 'Major 7th'),
    chord('sevenths', 'chord-7', '2r', 'Dominant 7th'),
    chord('sevenths', 'chord-m7', '2r', 'Minor 7th'),
    chord('sevenths', 'chord-m7b5', '2r', 'Half-dim 7th'),
    prog('ii-V-I', '3', 'ii-V-I'),
    random('sevenths/2r', 'Random sevenths'),
  ] },
  { name: 'Name the chord', steps: [
    quiz({ kind: C }), quiz({ kind: C, pick: true }),
    quiz({ kind: C, chordSet: 'types' }), quiz({ kind: C, chordSet: 'types', pick: true }),
  ] },
  { name: 'Colours', steps: [
    chord('sixths', 'chord-6', '2r', 'Major 6th'),
    chord('added-tones', 'chord-add9', '2r', 'Add 9'),
    chord('ninths', 'chord-m9', '2r', 'Minor 9th'),
    prog('vi-ii-V-I', '3', 'vi-ii-V-I'),
    prog('12-bar-blues', '3', '12-bar blues'),
  ] },
  { name: 'Advanced', steps: [
    chord('suspended-7ths', 'chord-7sus4', '2r', '7sus4'),
    chord('elevenths', 'chord-m11', '2r', 'Minor 11th'),
    chord('thirteenths', 'chord-13', '2r', 'Thirteenth'),
    chord('lydian', 'chord-maj7#11', '2r', 'Lydian maj7'),
    chord('altered', 'chord-7alt', '2r', 'Altered 7th'),
    chord('slash-chords', 'slash-chords', '3', 'Slash chords'),
    prog('ii-V-i-minor', '3', 'ii-V-i minor'),
    random('all-chords/3', 'Random chords'),
    quiz({ kind: C, chordSet: 'advanced' }), quiz({ kind: C, chordSet: 'advanced', pick: true }),
  ] },
];

/*
 * A level of a hearing or reading exercise, as a step. Inside its unit's
 * folder the path already says which drill it is, so the row is the level
 * alone — "up", "fix down" — or, where heard and read sit side by side, the
 * medium and the level: "Hear up", "Read up". The full drill label is its
 * title, for Continue, Skip and Progress, where it stands on its own.
 */
function levelStep(ex, lv, medium) {
  const step = quiz(isNaming(ex) ? { kind: EAR, exercise: ex.key, level: lv.key } : lv.quiz);
  return { ...step, title: step.label, label: medium ? medium + ' ' + lv.name : lv.name };
}

const levelSteps = (ex, medium) => ex.levels.map((lv) => levelStep(ex, lv, medium));

/* Hearing: the exercises of ear.mjs in their order, easiest first, one unit
 * each and one step per level. */
const HEARING = EXERCISES.map((ex, i) => ({ name: (i + 1) + ' ' + ex.name, exercise: ex.key, steps: levelSteps(ex) }));

/*
 * The courses, heard and read: one unit per course unit, its heard levels and
 * then the same levels read, so one skill is trained from both sides in one
 * place. A unit read is its Hear twin with "rd-" in front.
 */
const twinOf = (ex) => exerciseByKey('rd-' + ex.key);
const pairedSteps = (ex) => levelSteps(ex, 'Hear').concat(levelSteps(twinOf(ex), 'Read'));
const courseUnit = (key) => COURSES.flatMap((c) => c.exercises).find((e) => e.key === key);

/*
 * Intervals: identifying and comparing, interleaved by size — a pair of
 * intervals is named, then compared, before the next ones come in; the
 * compound intervals are compared once both of a pair have been named.
 */
const INTERVAL_ORDER = [
  'id-2nds', 'cmp-2nds', 'id-3rds', 'cmp-3rds', 'id-2-3', 'cmp-M2-m3',
  'id-4-5-8', 'cmp-4-5', 'cmp-4-TT', 'cmp-5-TT', 'cmp-4-TT-5', 'id-to-5', 'cmp-to-5',
  'id-6ths', 'cmp-6ths', 'id-7ths', 'cmp-7ths', 'cmp-M6-m7', 'id-6-7-8', 'cmp-6-7',
  'id-to-8', 'cmp-to-8',
  'id-8-M9-M10', 'id-8-m9-M10-11-12', 'cmp-9ths', 'id-8-m9-m10', 'cmp-10ths', 'cmp-M9-m10',
  'id-8-m9-m10-11-12', 'cmp-11-12', 'id-11-d12-12', 'id-8-12',
  'id-M13-M14-15', 'id-m13-m14-15', 'id-13-15',
];

export { INTERVAL_ORDER };

const INTERVALS_TRACK = INTERVAL_ORDER.map((key, i) => {
  const ex = courseUnit(key);
  const name = key.indexOf('cmp-') === 0 ? 'Compare ' + ex.short : ex.name;
  return { name: (i + 1) + ' ' + name, exercise: ex.key, steps: pairedSteps(ex) };
});

const SCALES_TRACK = COURSES.find((c) => c.key === 'scales').exercises
  .map((ex, i) => ({ name: (i + 1) + ' ' + ex.name, exercise: ex.key, steps: pairedSteps(ex) }));

/* What the songs track calls a rung, short enough to follow a song's name. */
const RUNG = { '1r': 'L1 RH', '1l': 'L1 LH', '2r': 'L2', '3': 'L3' };

/*
 * The songs track is made from the files rather than written out, so a song
 * added to the manifest joins the program in its category's place. Categories
 * run in the order given — easy material first — and songs in manifest order,
 * which within a category is already easy to hard.
 */
function songUnits(songs, categoryOrder) {
  const units = [];
  for (let c = 0; c < categoryOrder.length; c++) {
    for (let i = 0; i < songs.length; i++) {
      const s = songs[i];
      if (s.category !== categoryOrder[c]) continue;
      const levels = availableLevels(s.chart);
      const steps = levels.length > 1
        ? levels.map((lv) => ({
          id: 'song:' + s.chart.id + '/' + lv.id,
          label: lv.step + ' ' + lv.label,
          title: s.chart.name + ' ' + RUNG[lv.id],
        }))
        : [{ id: 'song:' + s.chart.id, label: s.chart.name }];
      units.push({ name: s.chart.name, steps });
    }
  }
  return units;
}

export const SONG_ORDER = ['classics', 'styles', 'electronic', 'techno'];

/* The whole program. `songs` is [{ chart, category }], as catalog.mjs takes it. */
export function buildProgram({ songs = [], categoryOrder = SONG_ORDER } = {}) {
  return [
    { key: 'reading', name: 'Reading', units: READING },
    { key: 'chords', name: 'Chords', units: CHORD_TRACK },
    { key: 'songs', name: 'Songs', units: songUnits(songs, categoryOrder) },
    { key: 'hearing', name: 'Hearing', units: HEARING },
    { key: 'intervals', name: 'Intervals', units: INTERVALS_TRACK },
    { key: 'scales', name: 'Scales', units: SCALES_TRACK },
  ];
}

/* ---- Following it --------------------------------------------------------- */

export function trackSteps(track) {
  const out = [];
  for (let u = 0; u < track.units.length; u++) {
    for (let s = 0; s < track.units[u].steps.length; s++) out.push(track.units[u].steps[s]);
  }
  return out;
}

/* What a step is called on its own, outside its unit's folder. */
export function stepTitle(step) {
  return step.title || step.label;
}

/* The first step neither finished nor skipped, or null when the track is done. */
export function nextStep(progress, track) {
  const steps = trackSteps(track);
  for (let i = 0; i < steps.length; i++) {
    const it = item(progress, steps[i].id);
    if (isFinished(it)) continue;
    if (it && it.skip) continue;
    return steps[i];
  }
  return null;
}

/* When the track was last practised, by any of its steps, in unix seconds. */
export function trackActivity(progress, track) {
  const steps = trackSteps(track);
  let latest = 0;
  for (let i = 0; i < steps.length; i++) {
    const it = item(progress, steps[i].id);
    if (it && it.t > latest) latest = it.t;
  }
  return latest;
}

/*
 * Continue: the next step of the track left longest. Ties go to the earlier
 * track, so on a fresh start it is Reading first — and the first session
 * then walks Reading, Chords, Songs, Hearing in turn.
 */
export function continueStep(progress, tracks) {
  let best = null;
  let bestAt = Infinity;
  for (let i = 0; i < tracks.length; i++) {
    const step = nextStep(progress, tracks[i]);
    if (!step) continue;
    const at = trackActivity(progress, tracks[i]);
    if (at < bestAt) {
      best = { track: tracks[i], step };
      bestAt = at;
    }
  }
  return best;
}

/* The first track a step id belongs to — a tune can sit in two. */
export function trackOf(tracks, id) {
  for (let i = 0; i < tracks.length; i++) {
    const steps = trackSteps(tracks[i]);
    for (let s = 0; s < steps.length; s++) if (steps[s].id === id) return tracks[i];
  }
  return null;
}

export function findStep(tracks, id) {
  for (let i = 0; i < tracks.length; i++) {
    const steps = trackSteps(tracks[i]);
    for (let s = 0; s < steps.length; s++) if (steps[s].id === id) return steps[s];
  }
  return null;
}

/*
 * The quiz options behind a quiz id, so a repetition or a step can be opened
 * without a row of the Quiz folder to read them from.
 */
export function quizFromId(id) {
  const parts = String(id).replace(/^quiz:/, '').split(':');
  if (parts.length !== 3) return null;
  const [mode, kind, set] = parts;
  if (mode === EAR) {
    /* An exercise the courses replaced opens its course twin. */
    const [exKey, level] = resolveLegacy(kind, set);
    const ex = exerciseByKey(exKey);
    if (!isNaming(ex) || !ex.levels.some((l) => l.key === level)) return null;
    return { kind: EAR, exercise: exKey, level, hear: true, pick: true };
  }
  if (kind !== N && kind !== C) return null;
  return {
    kind,
    hear: mode === 'hear',
    pick: mode === 'pick',
    read: mode === 'staff' ? 'staff' : null,
    halfTones: kind === N ? set === 'half' : false,
    chordSet: kind === C ? set : 'triads',
  };
}

/* ---- As rows of the lesson list ------------------------------------------- */

/*
 * The Learning Program folder. Steps are leaves carrying their own id, so the
 * folder sums the same items the rest of the tree does. Continue, Skip and
 * Repetition are rows ui.js gives meaning to; Repetition's rows depend on the
 * day, so the caller supplies them as a function and the folder sums leave
 * them out.
 */
/* A step as a row of a list: a leaf under its own id, so it is summed and
 * marked wherever it appears. */
export function stepRow(step) {
  return { label: step.label, value: '', key: step.id, absolute: true, step };
}

/* ---- Quiz › Hear and Quiz › Read ----------------------------------------- */

/* An exercise in a list: a folder of its levels, or — with one level — the
 * level itself, named as the exercise. */
function exerciseRow(ex, name = ex.name) {
  const steps = levelSteps(ex);
  if (steps.length === 1) return stepRow({ ...steps[0], label: name });
  return folder(name, steps.map(stepRow), ex.key);
}

/* A course: its units, numbered, since a course is a sequence. */
function courseFolder(course) {
  return folder(course.name, course.exercises.map((ex, i) => exerciseRow(ex, (i + 1) + ' ' + ex.name)), course.key);
}

/*
 * Quiz › Hear, by topic — pitch and melody, intervals, chords, scales and
 * keys — each with its courses first and then its exercises, easiest first.
 */
export function hearMenu() {
  return folder('Hear', TOPICS.map((t) => folder(t.name,
    COURSES.filter((c) => c.topic === t.key).map(courseFolder)
      .concat(EXERCISES.filter((e) => e.topic === t.key).map((e) => exerciseRow(e))),
    t.key)), 'hear');
}

/* Quiz › Read: the courses again, on the staff, under the same names. */
export function readMenu() {
  return folder('Read', READ_COURSES.map(courseFolder), 'read');
}

export function programFolder(tracks, repetitionRows = () => []) {
  return {
    label: 'Learning Program',
    value: '>',
    key: 'program',
    children: [
      { label: 'Continue', value: '', continueRow: true },
      { label: 'Skip next', value: '', skipRow: true },
      ...tracks.map((t) => ({
        label: t.name,
        value: '>',
        key: t.key,
        track: t,
        /* A unit of one step is that step, named as the unit: a folder of
         * one row is a click that shows nothing new. */
        children: t.units.map((u) => (u.steps.length === 1
          ? stepRow({ ...u.steps[0], label: u.name })
          : { label: u.name, value: '>', children: u.steps.map(stepRow) })),
      })),
      {
        label: 'Repetition',
        value: '>',
        key: 'repetition',
        untracked: true,
        /* Asked for each time: what is due changes with the day. */
        get children() { return repetitionRows(); },
      },
    ],
  };
}
