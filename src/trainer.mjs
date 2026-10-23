// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * trainer.mjs — one way to practise every subject. Pure.
 *
 * Practice › Chords (and in time Notes, Intervals, Scales, Progressions) is a
 * ring of the same five circles: Read, Hear, Play, Learn, Stats. The first
 * three open a setup page and then a round; the subject changes, the way to
 * practise it never does. This module is the part that is the same: what a
 * setup holds, the rows of its page, the item id a round is filed under, and
 * the spec that runs it on the engines that already exist —
 *
 *   play an answer   guess.mjs's rounds: the staff (read), the sound (hear)
 *                    or the name (play), judged exactly or by name
 *   name an answer   the ear/read option engine, with this subject's answers
 *
 * A setup is plain data, remembered per subject and circle in the progress
 * file (progress.trainers), so the page opens as it was left.
 *
 * ITEM IDS. A round is filed as `<subject>:<circle>:<answer>:<level>` — the
 * drill id; with `quiz:` in front, the progress id — e.g. chord:read:name:L3.
 * Play has no answer to choose, so its answer slot is `play`. A Custom pick is
 * `C-` and six characters hashed from its sorted set, so two picks keep their
 * own progress. What else a round was asked in (the key, the roots) is on its
 * stats record, not in the id: those change the prompts, not the task.
 */

import {
  CHORD_LEVELS, chordsAtLevel, qualityById, chordPool,
} from './chords.mjs';
import {
  MODES, MODE_LABELS, SCALE_LEVELS, scaleById, scalePool, lettersOf,
} from './scales.mjs';
import { scaleKey, spell, MIN_PITCH, MAX_PITCH } from './notation.mjs';
import { together, broken, ev, NOTE_GAP, rootName } from './ear_core.mjs';
import { rng, PC_NAMES, playableRange, scalePitches, keyForScale } from './generator.mjs';
import {
  spellLine, noteLabel, identifyPrompts, comparePrompts as readComparePrompts,
} from './read_course.mjs';
import { SCALE_GAP, comparePrompts as hearComparePrompts } from './ear_course.mjs';
import { INTERVALS, interval, intervalPrompts, intervalEvents, melodic } from './ear_core.mjs';
import { inStaffRange } from './notation.mjs';
import {
  PROGRESSION_LEVELS, progressionById, progressionChords, progressionKey, keyName, numeralsLabel,
  progressionDistance,
} from './progressions.mjs';
import { CIRCLE } from './chord_lessons.mjs';
import {
  voiceChords, compEvents, beatsOf, VOICINGS, RHYTHMS, VOICING_TEXT, RHYTHM_TEXT,
} from './comping.mjs';
import { chordSymbol } from './chords.mjs';
import { DEFAULT_TRANSPOSE } from './padmap.mjs';

export const CIRCLES = ['read', 'hear', 'play'];
export const CIRCLE_LABEL = { read: 'Read', hear: 'Hear', play: 'Play' };
export const MAX_CHOICES = 8;

/* ---- The subjects --------------------------------------------------------- */

/*
 * What a subject brings: its items in ladder order, its levels and what each
 * adds (`levelText`, for the Level row), the setup rows each circle shows,
 * its defaults, and `spec`: how a round of it runs (below).
 */
const CHORD = {
  key: 'chord',
  name: 'Chords',
  noun: ['chord', 'chords'],
  levels: CHORD_LEVELS,
  levelText: ['major', '+ minor', '+ dim aug', '+ sus 5', '+ 7 maj7 m7', '+ m7b5 6ths', '+ 9ths add9',
    '+ altered'],
  itemLabel: (id) => qualityById(id).name,
  fields: {
    read: ['answer', 'level', 'key', 'scale', 'roots', 'inversions', 'round'],
    hear: ['answer', 'level', 'key', 'scale', 'roots', 'inversions', 'sound', 'round'],
    play: ['level', 'key', 'scale', 'roots', 'inversions', 'round'],
  },
  defaults: { answer: 'play', level: 1, roots: 'diatonic', inversions: false, sound: 'block', round: 10 },
  spec: (...a) => chordSpec(...a),
};

/*
 * Scales: the ear course's teaching order. A scale is asked on a root —
 * the Key's, or any — and played as a line, up, down or both; read and
 * played, it is a chart with a pattern (straight, in 3rds, in 5ths).
 */
const SCALE = {
  key: 'scale',
  name: 'Scales',
  noun: ['scale', 'scales'],
  levels: SCALE_LEVELS,
  levelText: ['major minor', '+ modes', '+ harm mel', '+ phr loc', '+ pent', '+ whole', '+ dim',
    '+ melodic', '+ harmonic', '+ world'],
  itemLabel: (id) => scaleById(id).label,
  fields: {
    read: ['answer', 'level', 'key', 'direction', 'pattern', 'round'],
    hear: ['answer', 'level', 'key', 'direction', 'round'],
    play: ['level', 'key', 'direction', 'round'],
  },
  defaults: { answer: 'play', level: 1, direction: 'up', pattern: 'straight', round: 10 },
  /* Read and played, a round is one chart: no Round; named, no Pattern. */
  hidden: (f, circle, setup) => circle === 'read'
    && ((f === 'round' && setup.answer === 'play') || (f === 'pattern' && setup.answer === 'name')),
  spec: (...a) => scaleSpec(...a),
};

/*
 * Progressions: cadences first, then whole patterns. A progression is in a
 * key — the Key's, any, or all twelve round the circle of fifths — and its
 * own mode (each item is major or minor); voiced and in a rhythm when it is
 * read and played, voiced when it is read or heard.
 */
const PROG = {
  key: 'prog',
  name: 'Progressions',
  /* A round's header holds the title and its score: PROGS PLAY 10/10. */
  short: 'Progs',
  noun: ['progression', 'progressions'],
  levels: PROGRESSION_LEVELS.map((lv) => lv.map((p) => p.id)),
  levelText: ['cadences', '+ basics', '+ pop', '+ minor', '+ jazz', '+ blues', '+ modal', '+ jazz subs'],
  itemLabel: (id) => progressionById(id).name,
  allKeys: true,
  fields: {
    read: ['answer', 'level', 'key', 'voicing', 'rhythm', 'round'],
    hear: ['answer', 'level', 'key', 'voicing', 'round'],
    play: ['level', 'key', 'round'],
  },
  defaults: { answer: 'play', level: 1, voicing: 'smooth', rhythm: 'block', round: 10 },
  /* Read and played, a round is one chart: no Round; read and named, no Rhythm. */
  hidden: (f, circle, setup) => circle === 'read'
    && ((f === 'round' && setup.answer === 'play') || (f === 'rhythm' && setup.answer === 'name')),
  spec: (...a) => progSpec(...a),
};

/*
 * Notes: the smallest unit, so reading and finding it come first. The ladder
 * widens the range and then the spellings: five white keys round middle C,
 * the octave, two octaves with ledger lines, the sharps and flats, and last
 * the enharmonic white keys (E#, Fb, B#, Cb). Heard, a note is played back or
 * compared with the one before it: naming an absolute pitch is not a sensible
 * exercise (owner, 2026-10-23).
 */
const NOTE = {
  key: 'note',
  name: 'Notes',
  noun: ['note', 'notes'],
  levels: [['C', 'D', 'E', 'F', 'G'], ['A', 'B'], [],
    ['C#', 'Db', 'D#', 'Eb', 'F#', 'Gb', 'G#', 'Ab', 'A#', 'Bb'], ['E#', 'Fb', 'B#', 'Cb']],
  levelText: ['C to G', '+ A B', '+ 2 octaves', '+ sharps', '+ E# Fb'],
  itemLabel: (id) => id,
  answers: { read: ['play', 'name'], hear: ['play', 'hilo'] },
  fields: {
    read: ['answer', 'level', 'round'],
    hear: ['answer', 'level', 'round'],
    play: ['level', 'round'],
  },
  defaults: { answer: 'play', level: 1, round: 10 },
  spec: (...a) => noteSpec(...a),
};

/*
 * Intervals: the course's order, each level a set of its own (a contrasting
 * pair, then the pair with its neighbours) rather than everything below it.
 * Asked up, down or together; named, compared (which of two is bigger), or
 * played: both notes, the second the interval's distance from the first.
 */
const INT = {
  key: 'int',
  name: 'Intervals',
  noun: ['interval', 'intervals'],
  cumulative: false,
  levels: [['m2', 'M2'], ['m3', 'M3'], ['m2', 'M2', 'm3', 'M3'], ['P4', 'P5', 'P8'],
    ['m2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5'], ['m6', 'M6', 'm7', 'M7', 'P8'],
    INTERVALS.filter((i) => i.semis <= 12).map((i) => i.key),
    INTERVALS.filter((i) => i.semis > 12).map((i) => i.key)],
  levelText: ['2nds', '3rds', '2nds 3rds', '4 5 octave', 'to the 5th', '6ths 7ths', 'to octave', 'compound'],
  itemLabel: (id) => interval(id).label,
  answers: { read: ['name', 'compare', 'play'], hear: ['name', 'compare', 'play'] },
  directions: ['up', 'down', 'together'],
  fields: {
    read: ['answer', 'level', 'direction', 'round'],
    hear: ['answer', 'level', 'direction', 'round'],
    play: ['level', 'direction', 'round'],
  },
  defaults: { answer: 'name', level: 1, direction: 'up', round: 10 },
  spec: (...a) => intSpec(...a),
};

export const SUBJECTS = { note: NOTE, int: INT, scale: SCALE, chord: CHORD, prog: PROG };

export function subjectOf(key) {
  return SUBJECTS[key] || null;
}

/* A level's items: everything up to it, or — for a subject whose levels are
 * sets of their own, as the interval course's units are — just its own. */
export function levelItems(s, n) {
  if (s.cumulative === false) return s.levels[n - 1].slice();
  return [].concat(...s.levels.slice(0, n));
}

/* Every item of a subject, in ladder order, each once. */
export function allItems(subject) {
  return [].concat(...subjectOf(subject).levels).filter((x, i, all) => all.indexOf(x) === i);
}

/* ---- The rows ------------------------------------------------------------- */

const SCALE_IDS = Object.keys(MODES).filter((m) => m !== 'chromatic');

/*
 * Each field's values and how they read. Level is the subject's ladder plus
 * Custom; naming needs something to tell apart, so a naming level starts
 * where there are two answers.
 */
const FIELDS = {
  answer: {
    label: 'Answer',
    values: (s, setup) => answersOf(s, setup.circle),
    text: (v, s, setup) => (v === 'play' && s.key === 'note' && setup.circle === 'hear' ? 'play back' : ANSWER_TEXT[v]),
  },
  level: {
    label: 'Level',
    values: (s, setup) => {
      const from = needsTwo(setup) ? firstNamingLevel(s) : 1;
      const out = [];
      for (let n = from; n <= s.levels.length; n++) out.push(n);
      return out.concat(['custom']);
    },
    text: (v, s) => (v === 'custom' ? 'custom' : v + ' ' + s.levelText[v - 1]),
  },
  key: {
    label: 'Key',
    values: (s) => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 'random'].concat(s.allKeys ? ['all'] : []),
    text: (v) => (v === 'random' ? 'random' : v === 'all' ? 'all 12' : PC_NAMES[v]),
  },
  voicing: { label: 'Voicing', values: () => VOICINGS, text: (v) => VOICING_TEXT[v] },
  rhythm: { label: 'Rhythm', values: () => RHYTHMS, text: (v) => RHYTHM_TEXT[v] },
  scale: { label: 'Scale', values: () => SCALE_IDS, text: (v) => MODE_LABELS[v] || v },
  roots: {
    label: 'Roots',
    values: () => ['diatonic', 'key', 'chromatic'],
    text: (v) => ({ diatonic: 'diatonic', key: 'in key', chromatic: 'chromatic' })[v],
  },
  inversions: { label: 'Inversions', values: () => [false, true], text: (v) => (v ? 'on' : 'off') },
  sound: { label: 'Sound', values: () => ['block', 'broken'], text: (v) => v },
  direction: { label: 'Direction', values: (s) => s.directions || ['up', 'down', 'both'], text: (v) => v },
  pattern: {
    label: 'Pattern',
    values: () => ['straight', '3rds', '5ths'],
    text: (v) => ({ straight: 'straight', '3rds': 'in 3rds', '5ths': 'in 5ths' })[v],
  },
  round: {
    label: 'Round',
    values: () => [10, 20, 30, 0],
    text: (v) => (v ? String(v) : 'endless'),
  },
};

function firstNamingLevel(s) {
  for (let n = 1; n <= s.levels.length; n++) if (levelItems(s, n).length >= 2) return n;
  return 1;
}

/* What a circle's Answer row offers: play or name, unless the subject says.
 * (Notes heard: play back, or higher or lower; intervals: name, compare,
 * play.) Everything but playing tells answers apart, so needs two. */
function answersOf(s, circle) {
  if (circle === 'play') return ['play'];
  return (s.answers && s.answers[circle]) || ['play', 'name'];
}
const ANSWER_TEXT = { play: 'play', name: 'name', compare: 'compare', hilo: 'higher/lower' };
const needsTwo = (setup) => setup.answer !== 'play';

/*
 * A setup as stored, made whole: every field this circle shows, each a value
 * its row offers. `ctx` gives the Key and Scale settings, which a setup starts
 * from the first time.
 */
export function coerceSetup(subject, circle, stored, ctx = {}) {
  const s = subjectOf(subject);
  const src = stored && typeof stored === 'object' ? stored : {};
  /* `circle` rides along: which answers a row offers depends on it. */
  const setup = { ...s.defaults, key: ctx.rootPc == null ? 0 : ctx.rootPc, circle };
  if (answersOf(s, circle).indexOf(setup.answer) < 0) setup.answer = answersOf(s, circle)[0];
  if (s.fields.read.indexOf('scale') >= 0) {
    setup.scale = MODES[ctx.mode] && ctx.mode !== 'chromatic' ? ctx.mode : 'major';
  }
  if (circle === 'play') setup.answer = 'play';
  for (const f of s.fields[circle]) {
    if (src[f] !== undefined && valuesOf(s, setup, f).indexOf(src[f]) >= 0) setup[f] = src[f];
  }
  const all = allItems(subject);
  setup.custom = Array.isArray(src.custom) ? all.filter((id) => src.custom.indexOf(id) >= 0) : [];
  if (setup.level !== 'custom' && valuesOf(s, setup, 'level').indexOf(setup.level) < 0) {
    setup.level = valuesOf(s, setup, 'level')[0];
  }
  return setup;
}

function valuesOf(s, setup, field) {
  return FIELDS[field].values(s, setup);
}

/*
 * The setup page: one row a field, edited in place with the jog as Settings
 * rows are; with Custom, a row that opens the tick list; Start last.
 *
 *   { label, value, edit: 'trainer', field }
 *   { label, value, act: 'custom' | 'start' }
 */
export function setupRows(subject, circle, setup) {
  const s = subjectOf(subject);
  const rows = [];
  for (const f of s.fields[circle]) {
    if (s.hidden && s.hidden(f, circle, setup)) continue;
    rows.push({ label: FIELDS[f].label, value: FIELDS[f].text(setup[f], s, setup), edit: 'trainer', field: f });
    if (f === 'level' && setup.level === 'custom') {
      rows.push({ label: s.name, value: setup.custom.length + ' >', act: 'custom' });
    }
  }
  const blocked = startBlock(subject, circle, setup);
  rows.push(blocked
    ? { label: 'Start', value: blocked, act: 'start', disabled: true }
    : { label: 'Start', value: '>', act: 'start' });
  return rows;
}

/*
 * Why a round cannot start yet, or null when it can: a Custom pick needs
 * something to ask, and naming needs two things to tell apart. The same rule
 * for every trainer; the Start row says it ("tick 2 chords").
 */
export function startBlock(subject, circle, setup) {
  const s = subjectOf(subject);
  const need = circle !== 'play' && needsTwo(setup) ? 2 : 1;
  if (itemSet(subject, setup).length >= need) return null;
  return 'tick ' + need + ' ' + s.noun[need === 1 ? 0 : 1];
}

/* The jog on a row: the next or previous value, clamped. True when it moved. */
export function applySetup(subject, setup, field, delta) {
  const s = subjectOf(subject);
  if (!FIELDS[field] || !delta) return false;
  const values = valuesOf(s, setup, field);
  const at = Math.max(0, values.indexOf(setup[field]));
  const to = Math.max(0, Math.min(values.length - 1, at + (delta > 0 ? 1 : -1)));
  if (to === at && values.indexOf(setup[field]) >= 0) return false;
  const before = setup[field];
  setup[field] = values[to];
  /* A new Custom pick starts as the level it was chosen from: the jog came
   * from there, and an empty pick asks nothing. */
  if (field === 'level' && setup.level === 'custom' && !setup.custom.length && before !== 'custom') {
    setup.custom = levelItems(s, before);
  }
  /* Naming needs two answers: a level of one moves up to the first that has. */
  if (field === 'answer') {
    const levels = valuesOf(s, setup, 'level');
    if (levels.indexOf(setup.level) < 0) setup.level = levels[0];
  }
  return true;
}

/* The Custom page: every item, ticked or not. */
export function customRows(subject, setup) {
  const s = subjectOf(subject);
  return allItems(subject).map((id) => ({
    label: s.itemLabel(id), value: setup.custom.indexOf(id) >= 0 ? 'on' : 'off', act: 'tick', item: id,
  }));
}

/* Tick or untick an item; the set stays in ladder order. */
export function toggleCustom(subject, setup, item) {
  const on = new Set(setup.custom);
  if (on.has(item)) on.delete(item);
  else on.add(item);
  setup.custom = allItems(subject).filter((id) => on.has(id));
}

/* What a round asks: the level's items, or the Custom pick. */
export function itemSet(subject, setup) {
  if (setup.level === 'custom') return setup.custom.slice();
  return levelItems(subjectOf(subject), setup.level);
}

/* ---- Ids ------------------------------------------------------------------ */

/* Six characters from a set, the same for the same set in any order. */
export function customHash(ids) {
  const text = ids.slice().sort().join(',');
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ('00000' + (h >>> 0).toString(36)).slice(-6);
}

/* The drill id of a round with this setup (without `quiz:`). */
export function trainerId(subject, circle, setup) {
  const answer = circle === 'play' ? 'play' : setup.answer;
  const level = setup.level === 'custom' ? 'C-' + customHash(setup.custom) : 'L' + setup.level;
  return [subject, circle, answer, level].join(':');
}

/* An id's parts, or null when it is not a trainer id. */
export function parseTrainerId(id) {
  const parts = String(id).replace(/^quiz:/, '').split(':');
  if (parts.length !== 4 || !SUBJECTS[parts[0]] || CIRCLES.indexOf(parts[1]) < 0) return null;
  const [subject, circle, answer, lv] = parts;
  const m = /^L(\d+)$/.exec(lv);
  if (m) {
    const level = Number(m[1]);
    if (level < 1 || level > subjectOf(subject).levels.length) return null;
    return { subject, circle, answer, level };
  }
  if (/^C-[0-9a-z]{6}$/.test(lv)) return { subject, circle, answer, level: 'custom', hash: lv.slice(2) };
  return null;
}

const SUBJECT_WORD = { note: 'Note', int: 'Int', scale: 'Scale', chord: 'Chord', prog: 'Prog' };

/* "Chord read name L3": within the 21 characters a progress row fits. */
export function trainerLabel(id) {
  const t = parseTrainerId(id);
  if (!t) return null;
  const how = t.circle === 'play' ? '' : ' ' + t.answer;
  return SUBJECT_WORD[t.subject] + ' ' + t.circle + how + ' ' + (t.level === 'custom' ? 'Cust' : 'L' + t.level);
}

/* ---- The round ------------------------------------------------------------ */

/* Of `set`, the answers to offer for `right`: all of them up to eight, else
 * the right one and its nearest near misses — in the set's own order, so an
 * answer keeps its place relative to the others. */
export function choicesFor(set, right, distance) {
  if (set.length <= MAX_CHOICES) return set.slice();
  const others = set.filter((id) => id !== right)
    .map((id, i) => ({ id, d: distance(right, id), i }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .slice(0, MAX_CHOICES - 1)
    .map((x) => x.id);
  return set.filter((id) => id === right || others.indexOf(id) >= 0);
}

/* How far apart two qualities sound: the tones one has and the other lacks. */
export function qualityDistance(a, b) {
  const pcs = (id) => new Set(qualityById(id).intervals.map((i) => i % 12));
  const x = pcs(a);
  const y = pcs(b);
  let d = 0;
  for (const p of x) if (!y.has(p)) d++;
  for (const p of y) if (!x.has(p)) d++;
  return d;
}

/* A chord written on the staff, in the key: one column, every note. */
function staffColumn(pitches, key) {
  return [{
    part: 0,
    notes: pitches.map((p) => {
      const s = spell(p, key);
      return { pitch: p, diatonic: s.diatonic, alter: s.alter };
    }),
  }];
}

/*
 * The spec session.startQuiz runs: the guess engine's options, the pool, and
 * `trainer` — what it is filed under. `ctx` = { transpose, seed }. A random
 * key is drawn here, once a round: the scale keeps its type, the root moves.
 */
export function trainerSpec(subject, circle, setup, ctx = {}) {
  const s = subjectOf(subject);
  const id = trainerId(subject, circle, setup);
  const base = {
    trainer: { subject, circle, answer: circle === 'play' ? 'play' : setup.answer, id, setup },
    subject,
    roundSize: setup.round,
    label: s.name + ' ' + CIRCLE_LABEL[circle],
  };
  return s.spec(s, circle, setup, ctx, base);
}

/*
 * Naming, for any subject: the option engine with the items the pool can ask
 * as its answers — an answer that is never right teaches nothing (in C major
 * with diatonic roots no chord is augmented) — at most eight a prompt, the
 * nearest near misses, in ladder order.
 */
function namingSpec(s, circle, set, prompts, distance, mark, question, base) {
  const raw = prompts();
  const asked = set.filter((q) => raw.some((e) => e.answer === q));
  const answers = asked.map((q) => ({ key: q, label: s.itemLabel(q), short: mark(q) }));
  const read = circle === 'read';
  const exercise = {
    key: 'trainer-' + s.key + '-' + circle,
    name: s.name,
    short: s.name,
    question,
    read,
    answers,
    levels: [{ key: 'trainer', name: '', staffOnly: read, prompts: () => raw }],
  };
  const choices = (entry) => {
    const keep = choicesFor(asked, entry.answer, distance);
    return answers.filter((a) => keep.indexOf(a.key) >= 0);
  };
  return { ...base, kind: 'ear', exercise, level: 'trainer', hear: !read, pick: true, choicesFor: choices };
}

/* ---- Chords ---- */

function chordSpec(s, circle, setup, ctx, base0) {
  const rand = rng(ctx.seed || 1);
  const rootPc = setup.key === 'random' ? Math.floor(rand() * 12) : setup.key;
  const key = scaleKey(rootPc, MODES[setup.scale], setup.scale);
  const set = itemSet(s.key, setup);
  const pool = chordPool({
    qualities: set, roots: setup.roots, rootPc, mode: setup.scale,
    transpose: ctx.transpose, fifths: key, inversions: setup.inversions,
  });
  const base = {
    ...base0,
    gen: { rootPc, mode: setup.scale },
    context: { k: rootPc, r: setup.roots, i: setup.inversions ? 1 : 0 },
  };
  const entries = pool.map((e) => ({
    pitches: e.pitches, label: e.label, qualityId: e.qualityId, root: e.root,
  }));
  if (circle === 'play') return { ...base, kind: 'chords', read: 'name', how: 'name', pool: entries };
  if (setup.answer === 'play') {
    if (circle === 'read') return { ...base, kind: 'chords', read: 'staff', how: 'exact', pool: entries };
    /* Hear, play it back: by name, any voicing (owner, 2026-10-23). */
    return { ...base, kind: 'chords', hear: true, how: 'name', pool: entries };
  }
  const read = circle === 'read';
  const prompts = () => pool.map((e) => {
    const entry = {
      answer: e.qualityId,
      events: setup.sound === 'broken' && !read ? broken(e.pitches) : together(e.pitches),
      label: e.label,
      root: e.root,
    };
    if (read) entry.staff = staffColumn(e.pitches, key);
    return entry;
  });
  return namingSpec(s, circle, set, prompts, qualityDistance, (q) => qualityById(q).short, 'which chord?', base);
}

/* ---- Scales ---- */

/* How far apart two scales sound: the degrees one has and the other lacks. */
export function scaleDistance(a, b) {
  const x = new Set(scaleById(a).steps);
  const y = new Set(scaleById(b).steps);
  let d = 0;
  for (const p of x) if (!y.has(p)) d++;
  for (const p of y) if (!x.has(p)) d++;
  return d;
}

/* A line from a scale pool entry, the way the setup says: up through the
 * octave, down from it, or up and back down. */
function directed(line, direction) {
  if (direction === 'down') return line.slice().reverse();
  if (direction === 'both') return line.concat(line.slice(0, -1).reverse());
  return line.slice();
}

/* Quicker than an interval's notes: a scale is heard as a line. */
function lineEvents(line) {
  return line.map((p, i) => ev(p, i * SCALE_GAP, i === line.length - 1 ? NOTE_GAP : SCALE_GAP - 30));
}

/* Where a root may be: the Key's alone, or any. */
const rootOk = (setup) => (root) => setup.key === 'random' || ((root % 12) + 12) % 12 === setup.key;

/*
 * Weighted by what has been missed: a scale you get wrong comes up more often
 * (stats.items, as every trainer's drawing does), each still drawable.
 */
function drawWeighted(set, rand, history) {
  const w = set.map((id) => {
    const t = history && history[id];
    return t && t[0] > 0 ? 1 + 3 * ((t[0] - t[1]) / t[0]) : 1;
  });
  let r = rand() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < set.length; i++) {
    r -= w[i];
    if (r < 0) return set[i];
  }
  return set[set.length - 1];
}

/*
 * Read, play: a chart, one scale a round, as the Practice scale drills are —
 * the ready screen, its Knob 8 tempo and the scored run — drawn from the
 * level, the scale you miss more often. Its pattern: straight, or in 3rds or
 * 5ths, each step a degree and the one two or four above it.
 */
export function scaleChart(id, rootPc, setup, { bpm = 80, transpose = DEFAULT_TRANSPOSE } = {}) {
  const { lo, hi } = playableRange(transpose);
  const all = scalePitches(rootPc, id, lo, hi);
  const n = scaleById(id).steps.length;
  const skip = { straight: 0, '3rds': 2, '5ths': 4 }[setup.pattern] || 0;
  /* The lowest root with room for the octave and the pattern's reach above it. */
  let start = 0;
  for (let i = 0; i < all.length; i++) {
    if ((((all[i] - rootPc) % 12) + 12) % 12 === 0 && i + n + skip < all.length) { start = i; break; }
  }
  const up = [];
  for (let i = 0; i <= n; i++) {
    up.push(all[start + i]);
    if (skip && i < n) up.push(all[Math.min(all.length - 1, start + i + skip)]);
  }
  const line = directed(up, setup.direction);
  const key = keyForScale(rootPc, id);
  return {
    id: 'trainer-scale-' + id + '-' + rootPc,
    name: key.root + ' ' + scaleById(id).short,
    bpm,
    timeSig: [4, 4],
    keySig: key.fifths,
    spelling: key.map,
    events: line.map((pitch, i) => ({ beat: i, durBeats: 1, pitches: [pitch] })),
  };
}

function scaleSpec(s, circle, setup, ctx, base) {
  const rand = rng(ctx.seed || 1);
  const set = itemSet(s.key, setup);
  const ok = rootOk(setup);
  const transpose = ctx.transpose == null ? DEFAULT_TRANSPOSE : ctx.transpose;
  if (circle === 'read' && setup.answer === 'play') {
    const id = drawWeighted(set, rand, ctx.history);
    const rootPc = setup.key === 'random' ? Math.floor(rand() * 12) : setup.key;
    const chart = scaleChart(id, rootPc, setup, { bpm: ctx.bpm, transpose });
    return {
      ...base, chart, item: id, root: rootPc, gen: { rootPc, mode: id },
      /* The same scale again at a new tempo or octave (the settings). */
      remake: (c) => scaleChart(id, rootPc, setup, c),
      context: { k: rootPc, d: setup.direction, p: setup.pattern },
    };
  }
  const context = { k: setup.key === 'random' ? -1 : setup.key, d: setup.direction };
  if (setup.answer === 'play' || circle === 'play') {
    /* Played back or from the name: a line on the pads, any octave. */
    const range = playableRange(transpose);
    const pool = scalePool({ ids: set, range, spell: spellLine })
      .filter((e) => ok(e.root))
      .map((e) => {
        const line = directed(e.pitches, setup.direction);
        const notes = directed(e.notes, setup.direction);
        return {
          pitches: line, line, item: e.id, root: e.root,
          label: rootName(e.root).label + ' ' + scaleById(e.id).label,
          events: lineEvents(line),
          staff: notes.map((n) => ({ part: 0, notes: [n] })),
        };
      });
    const how = { kind: 'notes', how: 'any', pool, context, gen: { rootPc: 0, mode: 'chromatic' } };
    if (circle === 'play') return { ...base, ...how, read: 'name' };
    return { ...base, ...how, hear: true };
  }
  /* Naming. Read: written on the staff, a root it cannot be written on not
   * asked. Hear: anywhere the pads and the staff reach. */
  const read = circle === 'read';
  const range = read ? { lo: MIN_PITCH, hi: MAX_PITCH } : playableRange(transpose);
  const prompts = () => scalePool({ ids: set, range, spell: read ? spellLine : null })
    .filter((e) => ok(e.root))
    .map((e) => {
      const line = directed(e.pitches, setup.direction);
      const entry = {
        answer: e.id, events: lineEvents(line), root: e.root,
        label: rootName(e.root).label + ' ' + scaleById(e.id).label,
      };
      if (read) entry.staff = directed(e.notes, setup.direction).map((n) => ({ part: 0, notes: [n] }));
      return entry;
    });
  return namingSpec(s, circle, set, prompts, scaleDistance, (q) => scaleById(q).mark, 'which scale?',
    { ...base, context, gen: { rootPc: 0, mode: 'chromatic' } });
}

/* ---- Progressions ---- */

/* A tonic chord, then the progression, a chord at a time: the ear needs a
 * home before it can hear where a progression goes. */
function progEvents(item, tonicPc, voiced, transpose) {
  const home = voiceChords([{ root: tonicPc, quality: item.mode === 'minor' ? 'min' : 'maj' }], 'root', transpose)[0];
  const out = together(home.rh, 0, 900);
  voiced.forEach((v, i) => {
    const notes = (v.bass != null ? [v.bass] : []).concat(v.rh);
    out.push(...together(notes, 1300 + i * 900, 800));
  });
  return out;
}

/* Each chord a column on the staff, spelled in the progression's key. */
function progStaff(voiced, key) {
  return voiced.map((v) => ({
    part: 0,
    notes: (v.bass != null ? [v.bass] : []).concat(v.rh).map((p) => {
      const sp = spell(p, key);
      return { pitch: p, diatonic: sp.diatonic, alter: sp.alter };
    }),
  }));
}

/* The keys a prompt may be in: the Key's, or all twelve. */
const keysOf = (setup) => (typeof setup.key === 'number' ? [setup.key] : CIRCLE.slice());

/*
 * Read, play: a chart — the progression voiced and in its rhythm, once
 * through for a long one and twice for a short one, as the Learn charts go.
 * Its name says the key: "F#m Andalusian".
 */
export function progChart(id, tonicPc, setup, { bpm = 80, transpose = DEFAULT_TRANSPOSE } = {}) {
  const item = progressionById(id);
  const once = progressionChords(item, tonicPc);
  const times = item.steps.length <= 4 ? 2 : 1;
  let chords = [];
  for (let i = 0; i < times; i++) chords = chords.concat(once);
  const key = progressionKey(item, tonicPc);
  const voiced = voiceChords(chords, setup.voicing, transpose);
  const symbols = chords.map((c) => chordSymbol(c.root + 60, qualityById(c.quality), key));
  const minorKey = typeof key === 'object' ? key : null;
  const tonic = spell(tonicPc + 60, key).label + (item.mode === 'minor' ? 'm' : '');
  const chart = {
    id: 'trainer-prog-' + id.replace(/\s+/g, '-') + '-' + tonicPc,
    name: tonic + ' ' + item.name,
    bpm,
    timeSig: [beatsOf(setup.rhythm), 4],
    keySig: minorKey ? minorKey.fifths : key,
    events: compEvents(voiced, setup.rhythm, symbols),
  };
  if (minorKey) chart.spelling = minorKey.map;
  return chart;
}

function progSpec(s, circle, setup, ctx, base) {
  const rand = rng(ctx.seed || 1);
  const set = itemSet(s.key, setup);
  const transpose = ctx.transpose == null ? DEFAULT_TRANSPOSE : ctx.transpose;
  const context = { k: typeof setup.key === 'number' ? setup.key : setup.key === 'all' ? -2 : -1, v: setup.voicing };
  if (circle === 'read' && setup.answer === 'play') {
    /*
     * Key = all 12: the same progression, the next key round the circle of
     * fifths, every round, until all twelve are played; then another. `walk`
     * is where the last round was.
     */
    let id;
    let tonic;
    const walk = ctx.walk && set.indexOf(ctx.walk.item) >= 0 ? ctx.walk : null;
    if (setup.key === 'all' && walk && walk.at + 1 < 12) {
      id = walk.item;
      tonic = CIRCLE[walk.at + 1];
    } else {
      id = drawWeighted(set, rand, ctx.history);
      tonic = setup.key === 'all' ? CIRCLE[0] : setup.key === 'random' ? Math.floor(rand() * 12) : setup.key;
    }
    const chart = progChart(id, tonic, setup, { bpm: ctx.bpm, transpose });
    return {
      ...base, chart, item: id, root: tonic, gen: { rootPc: tonic, mode: progressionById(id).mode },
      walk: { item: id, at: CIRCLE.indexOf(tonic) },
      context: { ...context, r: setup.rhythm },
      remake: (c) => progChart(id, tonic, setup, c),
    };
  }
  const entry = (id, tonic, voicing) => {
    const item = progressionById(id);
    const chords = progressionChords(item, tonic);
    const key = progressionKey(item, tonic);
    const voiced = voiceChords(chords, voicing, transpose);
    return { item, chords, key, voiced };
  };
  if (setup.answer === 'play' || circle === 'play') {
    /* Played back, or from the numerals: each chord in any voicing. Key = all
     * 12 walks one progression round the circle, a key a prompt. */
    const make = (id, tonic) => {
      const e = entry(id, tonic, 'smooth');
      const name = keyName(e.item, tonic);
      const flat = [];
      for (const v of e.voiced) for (const p of v.rh) if (flat.indexOf(p) < 0) flat.push(p);
      return {
        pitches: flat, chords: e.voiced.map((v) => v.rh), item: id, root: tonic,
        label: e.item.name + ' in ' + name,
        tokens: e.item.numerals.trim().split(/\s+/),
        keyText: 'in ' + name,
        events: progEvents(e.item, tonic, e.voiced, transpose),
        staff: progStaff(e.voiced, e.key),
      };
    };
    let pool;
    let sequence = false;
    if (setup.key === 'all') {
      const id = drawWeighted(set, rand, ctx.history);
      pool = CIRCLE.map((tonic) => make(id, tonic));
      sequence = true;
    } else {
      pool = [];
      for (const id of set) for (const tonic of keysOf(setup)) pool.push(make(id, tonic));
    }
    const how = { kind: 'chords', how: 'name', pool, sequence, context, gen: { rootPc: 0, mode: 'chromatic' } };
    if (circle === 'play') return { ...base, ...how, read: 'name' };
    return { ...base, ...how, hear: true };
  }
  /* Naming: which progression it is, heard after its tonic or read. */
  const read = circle === 'read';
  const prompts = () => {
    const out = [];
    for (const id of set) {
      for (const tonic of keysOf(setup)) {
        const e = entry(id, tonic, setup.voicing);
        const p = {
          answer: id, root: tonic, label: e.item.name + ' in ' + keyName(e.item, tonic),
          events: progEvents(e.item, tonic, e.voiced, transpose),
        };
        if (read) p.staff = progStaff(e.voiced, e.key);
        out.push(p);
      }
    }
    return out;
  };
  return namingSpec(s, circle, set, prompts, progressionDistance, (q) => progressionById(q).mark,
    'which progression?', { ...base, context, gen: { rootPc: 0, mode: 'chromatic' } });
}

/* ---- Notes ---- */

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const noteAlter = (name) => (name[1] === '#' ? 1 : name[1] === 'b' ? -1 : 0);
export const notePc = (name) => (LETTER_PC[name[0]] + noteAlter(name) + 12) % 12;
/* The key a name is spelled in: a sharp in C# major, a flat in Cb major. */
const noteFifths = (name) => (noteAlter(name) > 0 ? 7 : noteAlter(name) < 0 ? -7 : 0);

/* Where a level's notes may be: round middle C, its octave, then the whole
 * staff the pads reach. A Custom pick has the whole range. */
function noteRange(setup, transpose) {
  const pads = playableRange(transpose);
  const all = { lo: Math.max(pads.lo, MIN_PITCH), hi: Math.min(pads.hi, MAX_PITCH) };
  if (setup.level === 1) return { lo: Math.max(all.lo, 60), hi: Math.min(all.hi, 67) };
  if (setup.level === 2) return { lo: Math.max(all.lo, 60), hi: Math.min(all.hi, 71) };
  return all;
}

/* Two names, how far apart: the semitones between them round the octave,
 * and a spelling apart counts a little — C# is near Db, not the same. */
export function noteDistance(a, b) {
  const d = Math.abs(notePc(a) - notePc(b));
  return Math.min(d, 12 - d) + (a[0] === b[0] ? 0 : 0.5);
}

function noteSpec(s, circle, setup, ctx, base0) {
  const set = itemSet(s.key, setup);
  const transpose = ctx.transpose == null ? DEFAULT_TRANSPOSE : ctx.transpose;
  const { lo, hi } = noteRange(setup, transpose);
  const pool = [];
  for (let p = lo; p <= hi; p++) {
    if (!inStaffRange(p)) continue;
    for (const name of set) {
      if (notePc(name) !== ((p % 12) + 12) % 12) continue;
      pool.push({ pitches: [p], item: name, label: name, fifths: noteFifths(name), root: p });
    }
  }
  const base = { ...base0, gen: { rootPc: 0, mode: 'major' }, context: { r: lo + '-' + hi } };
  if (circle === 'play') return { ...base, kind: 'notes', read: 'name', how: 'name', pool };
  if (setup.answer === 'play') {
    if (circle === 'read') return { ...base, kind: 'notes', read: 'staff', how: 'exact', pool };
    return { ...base, kind: 'notes', hear: true, how: 'name', pool };
  }
  if (setup.answer === 'hilo') {
    /* Two notes of the level, one after the other: is the second higher? */
    const answers = [{ key: 'higher', label: 'Higher', short: 'Hi' }, { key: 'same', label: 'Same', short: '=' },
      { key: 'lower', label: 'Lower', short: 'Lo' }];
    const prompts = () => {
      const out = [];
      for (const a of pool) {
        for (const b of pool) {
          const answer = b.root > a.root ? 'higher' : b.root < a.root ? 'lower' : 'same';
          out.push({ answer, judged: b.item, root: b.root, events: melodic([a.root, b.root]), label: a.label + ' then ' + b.label });
        }
      }
      return out;
    };
    const exercise = {
      key: 'trainer-note-hilo', name: s.name, short: s.name, question: 'second note is...', read: false, answers,
      levels: [{ key: 'trainer', name: '', prompts }],
    };
    return { ...base, kind: 'ear', exercise, level: 'trainer', hear: true, pick: true };
  }
  /* Read and name: a note on the staff, spelled as its name is. */
  const prompts = () => pool.map((e) => {
    const sp = spell(e.root, e.fifths);
    return {
      answer: e.item, root: e.root, label: e.item, events: [ev(e.root, 0, NOTE_GAP)],
      staff: [{ part: 0, notes: [{ pitch: e.root, diatonic: sp.diatonic, alter: sp.alter }] }],
    };
  });
  return namingSpec(s, circle, set, prompts, noteDistance, (q) => q, 'which note?', base);
}

/* ---- Intervals ---- */

const COMPARE = [
  { key: 'first', label: 'First bigger', short: '1' },
  { key: 'same', label: 'Same', short: '=' },
  { key: 'second', label: 'Second bigger', short: '2' },
];

/* Two characters for an interval on the answer map: its key, or for a
 * compound one the key past the octave (b9, 10, d2...). */
const INT_MARK = {
  m9: 'b9', M9: '9', m10: 'b0', M10: '10', P11: '11', d12: 'd2', P12: '12', m13: 'b3', M13: '13',
  m14: 'b4', M14: '14', P15: '15',
};
const intMark = (k) => INT_MARK[k] || k;

/* How far apart two intervals are: in semitones. */
export const intervalDistance = (a, b) => Math.abs(interval(a).semis - interval(b).semis);

/* Where intervals are heard: on the pads when the widest fits, else over the
 * whole staff — hearing needs no pad (the ear course's rule). */
function intRange(set, transpose) {
  const pads = playableRange(transpose);
  const span = Math.max(...set.map((k) => interval(k).semis));
  const reach = { lo: Math.max(pads.lo, MIN_PITCH), hi: Math.min(pads.hi, MAX_PITCH) };
  return reach.hi - reach.lo >= span + 2 ? reach : { lo: MIN_PITCH, hi: MAX_PITCH };
}

function intSpec(s, circle, setup, ctx, base0) {
  const set = itemSet(s.key, setup);
  const transpose = ctx.transpose == null ? DEFAULT_TRANSPOSE : ctx.transpose;
  const way = setup.direction;
  const base = { ...base0, gen: { rootPc: 0, mode: 'chromatic' }, context: { d: way } };
  const read = circle === 'read';
  if (circle === 'play' || setup.answer === 'play') {
    /* Both notes, played in turn — low then high for one heard together. */
    const pads = playableRange(transpose);
    const pool = [];
    for (let low = Math.max(pads.lo, MIN_PITCH); low <= Math.min(pads.hi, MAX_PITCH); low++) {
      for (const k of set) {
        const iv = interval(k);
        if (low + iv.semis > Math.min(pads.hi, MAX_PITCH)) continue;
        const pair = spellLine(low, [0, iv.semis], [0, iv.steps - 1]);
        if (!pair) continue;
        const down = way === 'down';
        const line = down ? [low + iv.semis, low] : [low, low + iv.semis];
        const anchor = down ? pair[1] : pair[0];
        const staff = way === 'together'
          ? [{ part: 0, notes: pair }]
          : (down ? [pair[1], pair[0]] : pair).map((n) => ({ part: 0, notes: [n] }));
        pool.push({
          pitches: line, line, relative: !read, item: k, root: low, way,
          label: k + (down ? ' below ' : ' above ') + noteLabel(anchor),
          itemLabel: iv.label,
          events: intervalEvents(line[0], iv.semis, way),
          staff,
        });
      }
    }
    if (circle === 'play') return { ...base, kind: 'notes', read: 'name', pool };
    if (read) return { ...base, kind: 'notes', read: 'staff', how: 'exact', pool };
    return { ...base, kind: 'notes', hear: true, pool };
  }
  if (setup.answer === 'compare') {
    /* Two intervals: which is bigger? Filed under the bigger one, the one
     * the ear had to measure (stats.mjs). */
    const unit = 'trainer-' + customHash(set);
    const make = read ? readComparePrompts(unit, set, way, false) : hearComparePrompts(unit, set, way, false);
    const range = intRange(set, transpose);
    const exercise = {
      key: 'trainer-int-compare-' + circle, name: s.name, short: s.name, question: 'which is bigger?', read,
      answers: COMPARE,
      levels: [{ key: 'trainer', name: '', staffOnly: read, span: range.hi - range.lo, prompts: () => make(range) }],
    };
    return { ...base, kind: 'ear', exercise, level: 'trainer', hear: !read, pick: true };
  }
  /* Naming, read or heard, as the courses ask it. */
  const range = intRange(set, transpose);
  const prompts = read ? identifyPrompts(set, way) : intervalPrompts(set, way);
  return namingSpec(s, circle, set, () => prompts(range), intervalDistance, intMark, 'which interval?', base);
}
