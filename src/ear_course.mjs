// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * ear_course.mjs — three listening courses, each a numbered list of units run
 * the way aural-skills courses run them: a contrasting pair first, then the
 * pair together with its neighbours, then everything up to a span. Pure.
 *
 *   Identify intervals   one interval; name it
 *   Compare intervals    two intervals; which is bigger?
 *   Identify scales      one scale; name its type
 *
 * A unit is an exercise exactly as ear.mjs defines one — answers, levels, a
 * prompt generator — so the quiz, the answer pads, the stats and the program
 * take it with no change. What the courses add:
 *
 *   span    the widest prompt, in semitones. A level whose prompts no longer
 *           fit the pads at this Octave setting is heard over the whole staff
 *           instead: listening needs no pad, only playing back does.
 *   tag     the word in front of a unit's label on the progress screen, in
 *           place of "Hear", so "Cmp 6ths fix up" says which course it is.
 */

import { rng } from './generator.mjs';
import { scaleById, scalePool } from './scales.mjs';
import {
  NOTE_GAP, ev, interval, intervalAnswers, intervalEvents, intervalPrompts, rootName, WAYS,
} from './ear_core.mjs';

/* Level names: short, so tag + short + level stays inside 21 characters. */
const WAY_NAME = { up: 'up', down: 'down', together: 'tog', melodic: 'mel', any: 'any' };

const spanOf = (keys) => Math.max(...keys.map((k) => interval(k).semis));

/* ---- Identify intervals --------------------------------------------------- */

function identify(key, name, short, keys) {
  const span = spanOf(keys);
  return {
    key: 'id-' + key, name, short, tag: 'Int', question: 'which interval?',
    answers: intervalAnswers(keys),
    levels: ['up', 'down', 'together'].map((way) => ({
      key: way, name: WAY_NAME[way], span, prompts: intervalPrompts(keys, way),
    })),
  };
}

const TO_5TH = ['m2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5'];
const TO_8VE = TO_5TH.concat(['m6', 'M6', 'm7', 'M7', 'P8']);

const IDENTIFY = [
  identify('2nds', '2nds', '2nds', ['m2', 'M2']),
  identify('3rds', '3rds', '3rds', ['m3', 'M3']),
  identify('2-3', '2nds and 3rds', '2nds 3rds', ['m2', 'M2', 'm3', 'M3']),
  identify('4-5-8', '4th 5th octave', '4 5 8', ['P4', 'P5', 'P8']),
  identify('to-5', 'Up to the 5th', 'to 5th', TO_5TH),
  identify('6ths', '6ths', '6ths', ['m6', 'M6']),
  identify('7ths', '7ths', '7ths', ['m7', 'M7']),
  identify('6-7-8', '6ths 7ths octave', '6 7 8', ['m6', 'M6', 'm7', 'M7', 'P8']),
  identify('to-8', 'Up to the octave', 'to octave', TO_8VE),
  identify('8-M9-M10', 'Octave M9 M10', '8 M9 M10', ['P8', 'M9', 'M10']),
  identify('8-m9-M10-11-12', '8ve m9 M10 11 12', '8 m9 M10+', ['P8', 'm9', 'M10', 'P11', 'P12']),
  identify('8-m9-m10', 'Octave m9 m10', '8 m9 m10', ['P8', 'm9', 'm10']),
  identify('8-m9-m10-11-12', '8ve m9 m10 11 12', '8 m9 m10+', ['P8', 'm9', 'm10', 'P11', 'P12']),
  identify('11-d12-12', '11th d12 12th', '11 d12 12', ['P11', 'd12', 'P12']),
  identify('8-12', 'Octave to 12th', '8ve-12th', ['P8', 'm9', 'M9', 'm10', 'M10', 'P11', 'd12', 'P12']),
  identify('M13-M14-15', 'M13 M14 2 octaves', 'M13 M14 15', ['M13', 'M14', 'P15']),
  identify('m13-m14-15', 'm13 m14 2 octaves', 'm13 m14 15', ['m13', 'm14', 'P15']),
  identify('13-15', 'm13 to 2 octaves', 'm13-15', ['m13', 'M13', 'm14', 'M14', 'P15']),
];

/* ---- Compare intervals ---------------------------------------------------- */
/*
 * Two intervals, one after the other: is the first bigger, the second, or are
 * they the same? With a fixed root both grow from one note, so the ear can
 * lean on where the second note lands. With a random root each has its own,
 * three to six semitones apart: the top notes say nothing, only the sizes do.
 *
 * Every pair at every root would be tens of thousands of prompts — too many to
 * hold on the Move — so a level draws a fixed sample, the same on every device
 * and every day: SAMPLE prompts for each answer.
 */
export const SAMPLE = 120;
const BETWEEN = 600;          /* ms of silence between the two intervals */
const FIRST = 'first';
const SAME = 'same';
const SECOND = 'second';
const COMPARE_ANSWERS = [
  { key: FIRST, label: 'First bigger' },
  { key: SAME, label: 'Same' },
  { key: SECOND, label: 'Second bigger' },
];

function lengthOf(events) {
  let end = 0;
  for (const e of events) end = Math.max(end, e.at + e.dur);
  return end;
}

/* Seeded by the unit and level, so a pool never changes between runs. */
function seedOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/* The notes an interval from `anchor` spans, whichever way it goes. */
function bounds(anchor, semis, way) {
  return way === 'down' ? [anchor - semis, anchor] : [anchor, anchor + semis];
}

function comparePrompts(unitKey, keys, way, fixed) {
  return ({ lo, hi }) => {
    const rand = rng(seedOf(unitKey + '/' + way + (fixed ? '/fix' : '')));
    const ways = WAYS[way];
    const want = { [FIRST]: SAMPLE, [SAME]: SAMPLE, [SECOND]: SAMPLE };
    /* A set with one interval can never be anything but the same. */
    if (keys.length < 2) { want[FIRST] = 0; want[SECOND] = 0; }
    const out = [];
    for (let guard = SAMPLE * 60; guard > 0 && (want[FIRST] || want[SAME] || want[SECOND]); guard--) {
      const a = interval(keys[Math.floor(rand() * keys.length)]);
      const b = interval(keys[Math.floor(rand() * keys.length)]);
      const answer = a.semis > b.semis ? FIRST : a.semis < b.semis ? SECOND : SAME;
      if (!want[answer]) continue;
      /* Both the same way: the comparison is of sizes, not of directions. */
      const w = ways[Math.floor(rand() * ways.length)];
      const r1 = lo + Math.floor(rand() * (hi - lo + 1));
      const off = (3 + Math.floor(rand() * 4)) * (rand() < 0.5 ? -1 : 1);
      const r2 = fixed ? r1 : r1 + off;
      const s1 = bounds(r1, a.semis, w);
      const s2 = bounds(r2, b.semis, w);
      if (s1[0] < lo || s1[1] > hi || s2[0] < lo || s2[1] > hi) continue;
      const first = intervalEvents(r1, a.semis, w);
      const second = intervalEvents(r2, b.semis, w, lengthOf(first) + BETWEEN);
      out.push({ answer, events: first.concat(second), label: a.key + ', then ' + b.key });
      want[answer]--;
    }
    return out;
  };
}

/*
 * `ways` are the screenshot's rows. With `roots: 'both'` every way comes twice,
 * fixed root first — as the course runs it, the easier half before the harder.
 */
function compare(key, name, short, keys, ways, roots = 'random') {
  const span = spanOf(keys);
  const levels = [];
  const add = (fixed) => {
    for (const way of ways) {
      levels.push({
        key: (fixed ? 'fix-' : '') + way,
        name: (fixed ? 'fix ' : '') + WAY_NAME[way],
        span, fixed,
        prompts: comparePrompts(key, keys, way, fixed),
      });
    }
  };
  if (roots === 'both') add(true);
  add(false);
  return {
    key: 'cmp-' + key, name, short, tag: 'Cmp', question: 'which is bigger?',
    answers: COMPARE_ANSWERS, set: keys, levels,
  };
}

const UDT = ['up', 'down', 'together'];

const COMPARE = [
  compare('2nds', '2nds', '2nds', ['m2', 'M2'], UDT),
  compare('3rds', '3rds', '3rds', ['m3', 'M3'], UDT),
  compare('M2-m3', 'M2 and m3', 'M2 m3', ['M2', 'm3'], ['melodic']),
  compare('4-5', '5th and 4th', '4th 5th', ['P4', 'P5'], UDT),
  compare('4-TT', '4th and tritone', '4th TT', ['P4', 'TT'], ['melodic']),
  compare('5-TT', '5th and tritone', '5th TT', ['P5', 'TT'], ['melodic']),
  compare('4-TT-5', '4th TT 5th', '4th TT 5th', ['P4', 'TT', 'P5'], ['any']),
  compare('to-5', 'Up to the 5th', 'to 5th', TO_5TH, UDT),
  compare('6ths', '6ths', '6ths', ['m6', 'M6'], UDT, 'both'),
  compare('7ths', '7ths', '7ths', ['m7', 'M7'], UDT, 'both'),
  compare('M6-m7', 'M6 and m7', 'M6 m7', ['M6', 'm7'], ['melodic'], 'both'),
  compare('6-7', '6ths and 7ths', '6/7ths', ['m6', 'M6', 'm7', 'M7'], UDT, 'both'),
  compare('to-8', 'Up to the octave', 'to 8ve', TO_8VE, UDT, 'both'),
  compare('9ths', '9ths', '9ths', ['m9', 'M9'], UDT, 'both'),
  compare('10ths', '10ths', '10ths', ['m10', 'M10'], UDT, 'both'),
  compare('M9-m10', 'M9 and m10', 'M9 m10', ['M9', 'm10'], ['melodic'], 'both'),
  compare('11-12', '11th and 12th', '11/12', ['P11', 'P12'], UDT, 'both'),
];

/* ---- Identify scales ------------------------------------------------------ */
/*
 * A scale from a random root, up through the octave or down from it. Naming
 * its type is relative hearing: the steps between the notes, not the notes.
 * The scales themselves, and their names, are scales.mjs's.
 */

/* Quicker than an interval's notes: a scale is heard as a line, not a pair. */
export const SCALE_GAP = 450;
const SCALE_LEN = 420;

function scalePrompts(keys, way) {
  return (range) => scalePool({ ids: keys, range }).map((e) => {
    const line = way === 'down' ? e.pitches.slice().reverse() : e.pitches;
    const events = line.map((p, i) => ev(p, i * SCALE_GAP, i === line.length - 1 ? NOTE_GAP : SCALE_LEN));
    return { answer: e.id, events, label: rootName(e.root).label + ' ' + scaleById(e.id).label };
  });
}

/* `labels` renames an answer for one unit: the major scale is "Major" beside
 * natural minor and "Ionian" among the seven modes. */
function scales(key, name, short, keys, labels = {}) {
  return {
    key: 'sc-' + key, name, short, tag: 'Scale', question: 'which scale?',
    answers: keys.map((k) => ({ key: k, label: labels[k] || scaleById(k).label })),
    levels: ['up', 'down'].map((way) => ({ key: way, name: way, span: 12, prompts: scalePrompts(keys, way) })),
  };
}

const MODES_7 = ['major', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'minor', 'locrian'];

const SCALE_COURSE = [
  scales('maj-min', 'Minor and major', 'Maj/min', ['major', 'minor']),
  scales('maj-lyd-mix', 'Major Lydian Mixo', 'Lyd Mix', ['major', 'lydian', 'mixolydian']),
  scales('minors', 'Minor scales', 'Minors', ['minor', 'harmonicMinor', 'melodicMinor'],
    { minor: 'Natural minor' }),
  scales('phr-loc', 'Phrygian Locrian', 'Phr Loc', ['phrygian', 'locrian']),
  scales('pent', 'Pentatonic', 'Pent', ['majorPent', 'minorPent']),
  scales('modes', 'Seven modes', '7 modes', MODES_7, { major: 'Ionian', minor: 'Aeolian' }),
  scales('wt', 'Whole tone + kin', 'WT kin',
    ['wholeTone', 'lydianDominant', 'lydianAugmented', 'mixolydianFlat6']),
  scales('dim', 'Diminished scales', 'Dim', ['wholeHalf', 'halfWhole']),
  scales('mel-modes', 'Melodic min modes', 'Mel modes',
    ['melodicMinor', 'dorianFlat2', 'lydianAugmented', 'lydianDominant', 'mixolydianFlat6', 'locrianSharp2', 'altered']),
  scales('harm-modes', 'Harmonic min modes', 'Harm modes',
    ['harmonicMinor', 'locrianSharp6', 'ionianSharp5', 'dorianSharp4', 'phrygianDominant', 'lydianSharp2', 'alteredDim']),
];

/* ---- The courses ---------------------------------------------------------- */

export const COURSES = [
  { key: 'intervals', name: 'Identify intervals', topic: 'intervals', exercises: IDENTIFY },
  { key: 'compare', name: 'Compare intervals', topic: 'intervals', exercises: COMPARE },
  { key: 'scales', name: 'Identify scales', topic: 'keys', exercises: SCALE_COURSE },
];

export function courseOf(exercise) {
  return COURSES.find((c) => c.exercises.indexOf(exercise) >= 0) || null;
}
