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
import { MODES, MODE_LABELS } from './scales.mjs';
import { scaleKey, spell } from './notation.mjs';
import { together, broken } from './ear_core.mjs';
import { rng, PC_NAMES } from './generator.mjs';

export const CIRCLES = ['read', 'hear', 'play'];
export const CIRCLE_LABEL = { read: 'Read', hear: 'Hear', play: 'Play' };
export const MAX_CHOICES = 8;

/* ---- The subjects --------------------------------------------------------- */

/*
 * What a subject brings: its items in ladder order, its levels and what each
 * adds (`levelText`, for the Level row), the setup rows each circle shows, and
 * its defaults. Only the chord trainer is here yet.
 */
const CHORD = {
  key: 'chord',
  name: 'Chords',
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
};

export const SUBJECTS = { chord: CHORD };

export function subjectOf(key) {
  return SUBJECTS[key] || null;
}

/* Every item of a subject, in ladder order. */
export function allItems(subject) {
  return [].concat(...subjectOf(subject).levels);
}

/* ---- The rows ------------------------------------------------------------- */

const SCALE_IDS = Object.keys(MODES).filter((m) => m !== 'chromatic');

/*
 * Each field's values and how they read. Level is the subject's ladder plus
 * Custom; naming needs something to tell apart, so a naming level starts
 * where there are two answers.
 */
const FIELDS = {
  answer: { label: 'Answer', values: () => ['play', 'name'], text: (v) => v },
  level: {
    label: 'Level',
    values: (s, setup) => {
      const from = setup.answer === 'name' ? firstNamingLevel(s) : 1;
      const out = [];
      for (let n = from; n <= s.levels.length; n++) out.push(n);
      return out.concat(['custom']);
    },
    text: (v, s) => (v === 'custom' ? 'custom' : v + ' ' + s.levelText[v - 1]),
  },
  key: {
    label: 'Key',
    values: () => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 'random'],
    text: (v) => (v === 'random' ? 'random' : PC_NAMES[v]),
  },
  scale: { label: 'Scale', values: () => SCALE_IDS, text: (v) => MODE_LABELS[v] || v },
  roots: {
    label: 'Roots',
    values: () => ['diatonic', 'key', 'chromatic'],
    text: (v) => ({ diatonic: 'diatonic', key: 'in key', chromatic: 'chromatic' })[v],
  },
  inversions: { label: 'Inversions', values: () => [false, true], text: (v) => (v ? 'on' : 'off') },
  sound: { label: 'Sound', values: () => ['block', 'broken'], text: (v) => v },
  round: {
    label: 'Round',
    values: () => [10, 20, 30, 0],
    text: (v) => (v ? String(v) : 'endless'),
  },
};

function firstNamingLevel(s) {
  for (let n = 1; n <= s.levels.length; n++) if ([].concat(...s.levels.slice(0, n)).length >= 2) return n;
  return 1;
}

/*
 * A setup as stored, made whole: every field this circle shows, each a value
 * its row offers. `ctx` gives the Key and Scale settings, which a setup starts
 * from the first time.
 */
export function coerceSetup(subject, circle, stored, ctx = {}) {
  const s = subjectOf(subject);
  const src = stored && typeof stored === 'object' ? stored : {};
  const setup = {
    ...s.defaults,
    key: ctx.rootPc == null ? 0 : ctx.rootPc,
    scale: MODES[ctx.mode] && ctx.mode !== 'chromatic' ? ctx.mode : 'major',
  };
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
    rows.push({ label: FIELDS[f].label, value: FIELDS[f].text(setup[f], s), edit: 'trainer', field: f });
    if (f === 'level' && setup.level === 'custom') {
      rows.push({ label: s.name, value: setup.custom.length + ' >', act: 'custom' });
    }
  }
  rows.push({ label: 'Start', value: '>', act: 'start' });
  return rows;
}

/* The jog on a row: the next or previous value, clamped. True when it moved. */
export function applySetup(subject, setup, field, delta) {
  const s = subjectOf(subject);
  if (!FIELDS[field] || !delta) return false;
  const values = valuesOf(s, setup, field);
  const at = Math.max(0, values.indexOf(setup[field]));
  const to = Math.max(0, Math.min(values.length - 1, at + (delta > 0 ? 1 : -1)));
  if (to === at && values.indexOf(setup[field]) >= 0) return false;
  setup[field] = values[to];
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
  return [].concat(...subjectOf(subject).levels.slice(0, setup.level));
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
  const rand = rng(ctx.seed || 1);
  const rootPc = setup.key === 'random' ? Math.floor(rand() * 12) : setup.key;
  const key = scaleKey(rootPc, MODES[setup.scale], setup.scale);
  const set = itemSet(subject, setup);
  const pool = chordPool({
    qualities: set, roots: setup.roots, rootPc, mode: setup.scale,
    transpose: ctx.transpose, fifths: key, inversions: setup.inversions,
  });
  const id = trainerId(subject, circle, setup);
  const base = {
    trainer: { subject, circle, answer: circle === 'play' ? 'play' : setup.answer, id, setup },
    subject,
    gen: { rootPc, mode: setup.scale },
    roundSize: setup.round,
    label: s.name + ' ' + CIRCLE_LABEL[circle],
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
  /* Naming: the option engine, with the qualities of the level as answers —
   * those the pool can ask: in C major with diatonic roots no chord is
   * augmented, and an answer that is never right teaches nothing. */
  const asked = set.filter((q) => pool.some((e) => e.qualityId === q));
  const answers = asked.map((q) => ({ key: q, label: s.itemLabel(q), short: qualityById(q).short }));
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
  const exercise = {
    key: 'trainer-' + subject + '-' + circle,
    name: s.name,
    short: s.name,
    question: 'which chord?',
    read,
    answers,
    levels: [{ key: 'trainer', name: '', staffOnly: read, prompts }],
  };
  const choices = (entry) => {
    const keep = choicesFor(asked, entry.answer, qualityDistance);
    return answers.filter((a) => keep.indexOf(a.key) >= 0);
  };
  return { ...base, kind: 'ear', exercise, level: 'trainer', hear: !read, pick: true, choicesFor: choices };
}
