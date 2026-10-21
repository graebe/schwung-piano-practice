// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * read_course.mjs — the three listening courses again, for the eyes. Pure.
 *
 *   Read intervals    one interval on the staff; name it
 *   Compare by eye    two intervals on the staff; which is bigger?
 *   Read scales       a scale on the staff; name it
 *
 * Unit for unit and level for level the same as ear_course.mjs — the same
 * answers, the same ways (up, down, together), the same fixed and random roots
 * — so a unit read and the same unit heard train one skill from both sides.
 *
 * What reading adds is SPELLING. A heard minor 3rd is three semitones; a read
 * one is two letters apart — C-Eb, never C-D#, which is an augmented 2nd and
 * would make the right answer wrong. So every note is placed by letter: the
 * interval's letters count up from the root's, a scale has one letter per
 * degree. The staff draws one sharp or one flat, so a root whose spelling
 * would need a double sharp or flat is simply not asked; another root is.
 *
 * A prompt carries `staff`: its columns, left to right, each the notes drawn
 * at one x — [{ part, notes: [{ pitch, diatonic, alter }] }] — `part` telling
 * the two intervals of a comparison apart. It still carries `events`, so Help
 * can play it and a right answer sounds what was read.
 */

import { rng } from './generator.mjs';
import { LETTERS, NATURAL_PC, MIN_PITCH, MAX_PITCH } from './notation.mjs';
import { ev, interval, intervalEvents, rootName, WAYS, NOTE_GAP } from './ear_core.mjs';
import { COURSES, SCALES, SCALE_GAP, SAMPLE } from './ear_course.mjs';

/* ---- Spelling --------------------------------------------------------------- */

const naturalPitch = (diatonic) => 12 * (Math.floor(diatonic / 7) + 1) + NATURAL_PC[((diatonic % 7) + 7) % 7];

/* `pitch` written on staff step `diatonic`, or null when that takes more than
 * one sharp or flat. */
export function noteAt(pitch, diatonic) {
  const alter = pitch - naturalPitch(diatonic);
  return Math.abs(alter) <= 1 ? { pitch, diatonic, alter } : null;
}

export function noteLabel(note) {
  return LETTERS[((note.diatonic % 7) + 7) % 7] + (note.alter > 0 ? '#' : note.alter < 0 ? 'b' : '');
}

/*
 * Where a root may be written. A white key is its own letter — a scale on B#
 * is a scale on C to anyone reading it. A black key is a sharp or a flat, the
 * one its major key would use first (Bb before A#, F# before Gb).
 */
function rootSteps(root) {
  const base = (Math.floor(root / 12) - 1) * 7;
  const steps = [];
  for (let d = base - 1; d <= base + 7; d++) {
    const n = noteAt(root, d);
    if (n) steps.push(n);
  }
  const natural = steps.filter((n) => n.alter === 0);
  if (natural.length) return natural.map((n) => n.diatonic);
  const preferred = rootName(root).alter;
  return steps.sort((x, y) => (y.alter === preferred) - (x.alter === preferred)).map((n) => n.diatonic);
}

/*
 * A line of notes from `root`: `semis` above it, each on the letter `letters`
 * steps above the root's. Of the root's spellings the one needing the fewest
 * accidentals overall, the usual one on a tie; null when each needs a double.
 */
export function spellLine(root, semis, letters) {
  let best = null;
  let cost = Infinity;
  for (const d of rootSteps(root)) {
    const line = [];
    let c = 0;
    for (let i = 0; i < semis.length && line.length === i; i++) {
      const n = noteAt(root + semis[i], d + letters[i]);
      if (n) { line.push(n); c += Math.abs(n.alter); }
    }
    if (line.length === semis.length && c < cost) { best = line; cost = c; }
  }
  return best;
}

/* Reading needs no pad: the whole staff, A3 to C6, two ledger lines each way. */
const STAFF = { lo: MIN_PITCH, hi: MAX_PITCH };
const inStaff = (notes) => notes.every((n) => n.pitch >= STAFF.lo && n.pitch <= STAFF.hi);

/* An interval from `low`, spelled; `[low, high]` or null. */
function spellInterval(low, iv) {
  return spellLine(low, [0, iv.semis], [0, iv.steps - 1]);
}

/* The columns an interval is drawn in, the way it sounds: up and down one note
 * after the other, together stacked. */
function columns(pair, way, part = 0) {
  if (way === 'together') return [{ part, notes: pair }];
  const order = way === 'down' ? [pair[1], pair[0]] : pair;
  return order.map((n) => ({ part, notes: [n] }));
}

/* ---- Read intervals ------------------------------------------------------------ */

function identifyPrompts(keys, way) {
  const ways = WAYS[way];
  return () => {
    const out = [];
    for (let low = STAFF.lo; low <= STAFF.hi; low++) {
      for (const k of keys) {
        const iv = interval(k);
        const pair = spellInterval(low, iv);
        if (!pair || !inStaff(pair)) continue;
        for (const w of ways) {
          const anchor = w === 'down' ? pair[1].pitch : pair[0].pitch;
          out.push({
            answer: k,
            events: intervalEvents(anchor, iv.semis, w),
            staff: columns(pair, w),
            label: noteLabel(pair[0]) + '-' + noteLabel(pair[1]) + ' ' + k,
          });
        }
      }
    }
    return out;
  };
}

/* ---- Compare by eye ------------------------------------------------------------ */

function seedOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function lengthOf(events) {
  let end = 0;
  for (const e of events) end = Math.max(end, e.at + e.dur);
  return end;
}

/* An interval's lower note when its first-heard note is `anchor`. */
const lowOf = (anchor, semis, way) => (way === 'down' ? anchor - semis : anchor);

function comparePrompts(unitKey, keys, way, fixed) {
  return () => {
    const rand = rng(seedOf('read/' + unitKey + '/' + way + (fixed ? '/fix' : '')));
    const ways = WAYS[way];
    const want = { first: SAMPLE, same: SAMPLE, second: SAMPLE };
    const out = [];
    for (let guard = SAMPLE * 80; guard > 0 && (want.first || want.same || want.second); guard--) {
      const a = interval(keys[Math.floor(rand() * keys.length)]);
      const b = interval(keys[Math.floor(rand() * keys.length)]);
      const answer = a.semis > b.semis ? 'first' : a.semis < b.semis ? 'second' : 'same';
      if (!want[answer]) continue;
      const w = ways[Math.floor(rand() * ways.length)];
      const r1 = STAFF.lo + Math.floor(rand() * (STAFF.hi - STAFF.lo + 1));
      const r2 = fixed ? r1 : r1 + (3 + Math.floor(rand() * 4)) * (rand() < 0.5 ? -1 : 1);
      const p1 = spellInterval(lowOf(r1, a.semis, w), a);
      const p2 = spellInterval(lowOf(r2, b.semis, w), b);
      if (!p1 || !p2 || !inStaff(p1) || !inStaff(p2)) continue;
      /* A fixed root is one note, so it must be written as one note. */
      const anchorOf = (p) => (w === 'down' ? p[1] : p[0]);
      if (fixed && anchorOf(p1).diatonic !== anchorOf(p2).diatonic) continue;
      const first = intervalEvents(r1, a.semis, w);
      const second = intervalEvents(r2, b.semis, w, lengthOf(first) + 600);
      out.push({
        answer,
        events: first.concat(second),
        staff: columns(p1, w, 0).concat(columns(p2, w, 1)),
        label: a.key + ', then ' + b.key,
      });
      want[answer]--;
    }
    return out;
  };
}

/* ---- Read scales ----------------------------------------------------------------- */

/*
 * The letter each note of a scale sits on, counted from the root's. Seven-note
 * scales take one letter a degree; the others are written as players write
 * them: the pentatonics skip two letters, whole tone uses six, and the
 * diminished scales repeat one (C D Eb F Gb Ab A B).
 */
const LETTERS_OF = {
  majorPent: [0, 1, 2, 4, 5],
  minorPent: [0, 2, 3, 4, 6],
  wholeTone: [0, 1, 2, 3, 4, 5],
  wholeHalf: [0, 1, 2, 3, 4, 5, 5, 6],
  halfWhole: [0, 1, 2, 2, 3, 4, 5, 6],
};
const lettersOf = (key) => LETTERS_OF[key] || [0, 1, 2, 3, 4, 5, 6];

function scalePrompts(keys, way) {
  return () => {
    const out = [];
    for (let root = STAFF.lo; root + 12 <= STAFF.hi; root++) {
      for (const k of keys) {
        const line = spellLine(root, SCALES[k].steps.concat([12]), lettersOf(k).concat([7]));
        if (!line || !inStaff(line)) continue;
        if (way === 'down') line.reverse();
        const events = line.map((n, i) => ev(n.pitch, i * SCALE_GAP, i === line.length - 1 ? NOTE_GAP : SCALE_GAP - 30));
        const tonic = way === 'down' ? line[line.length - 1] : line[0];
        out.push({
          answer: k,
          events,
          staff: line.map((n) => ({ part: 0, notes: [n] })),
          label: noteLabel(tonic) + ' ' + SCALES[k].label,
        });
      }
    }
    return out;
  };
}

/* ---- The courses -------------------------------------------------------------------- */

const TAG = { intervals: 'RdInt', compare: 'RdCmp', scales: 'RdSc' };

function readUnit(course, unit) {
  const keys = unit.answers.map((a) => a.key);
  return {
    ...unit,
    key: 'rd-' + unit.key,
    tag: TAG[course.key],
    read: true,
    levels: unit.levels.map((lv) => {
      let prompts;
      if (course.key === 'intervals') prompts = identifyPrompts(keys, lv.key);
      else if (course.key === 'compare') prompts = comparePrompts(unit.key, unit.set, lv.key.replace('fix-', ''), lv.fixed);
      else prompts = scalePrompts(keys, lv.key);
      return { ...lv, span: null, staffOnly: true, prompts };
    }),
  };
}

/* The same names as the Hear courses: the folder they sit in says Read. */
export const READ_COURSES = COURSES.map((c) => ({
  key: 'read-' + c.key,
  name: c.name,
  topic: c.topic,
  twin: c.key,
  exercises: c.exercises.map((u) => readUnit(c, u)),
}));
