// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * ear_core.mjs — what every hearing exercise is made of: timed note events,
 * how to spell what was heard, and the intervals. Pure.
 *
 * Shared by the exercises of ear.mjs and the courses of ear_course.mjs, so the
 * two lists can grow apart without either importing the other.
 */

import { LETTERS, NATURAL_PC, spell, majorKeyFifths } from './notation.mjs';

/* ---- Time ------------------------------------------------------------------- */

/* Milliseconds. Slow enough to hear each note as a note, quick enough that two
 * of them are still heard as one interval. */
export const NOTE_GAP = 700;
export const NOTE_LEN = 650;
export const CHORD_LEN = 1400;
export const ARP_GAP = 300;
const SLOW = 1.5;

export const ev = (pitch, at, dur) => ({ pitch, at, dur });

export function melodic(pitches, at = 0) {
  return pitches.map((p, i) => ev(p, at + i * NOTE_GAP, NOTE_LEN));
}

export function together(pitches, at = 0, dur = CHORD_LEN) {
  return pitches.map((p) => ev(p, at, dur));
}

/* Low to high, then all together: hear the parts, then the colour. */
export function broken(pitches, at = 0) {
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

export const pcOf = (pitch) => ((pitch % 12) + 12) % 12;
const ACCIDENTAL = { '-2': 'bb', '-1': 'b', 0: '', 1: '#', 2: 'x' };

/* A note named as the key it would be the tonic of names it: Eb, not D#. */
export function rootName(pitch) {
  return spell(pitch, majorKeyFifths(pcOf(pitch)));
}

/*
 * The note `semis` above `root` with the letter `steps` on from the root's,
 * so a minor third above C reads Eb and never D#. That is what makes the
 * revealed answer agree with the interval's name.
 */
export function spellAbove(root, semis, steps) {
  const r = rootName(root);
  const letterIndex = (r.letterIndex + steps - 1) % 7;
  let alter = pcOf(root + semis - NATURAL_PC[letterIndex]);
  if (alter > 6) alter -= 12;
  return LETTERS[letterIndex] + (ACCIDENTAL[alter] ?? '?');
}

export function noteNames(pitches) {
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
  /* Compound: an octave and more. The letter keeps counting past the octave,
   * so C up to the Gb above the next G is a diminished 12th, never a #11. */
  { key: 'm9', semis: 13, steps: 9, label: 'Minor 9th' },
  { key: 'M9', semis: 14, steps: 9, label: 'Major 9th' },
  { key: 'm10', semis: 15, steps: 10, label: 'Minor 10th' },
  { key: 'M10', semis: 16, steps: 10, label: 'Major 10th' },
  { key: 'P11', semis: 17, steps: 11, label: 'Perfect 11th' },
  { key: 'd12', semis: 18, steps: 12, label: 'Diminished 12th' },
  { key: 'P12', semis: 19, steps: 12, label: 'Perfect 12th' },
  { key: 'm13', semis: 20, steps: 13, label: 'Minor 13th' },
  { key: 'M13', semis: 21, steps: 13, label: 'Major 13th' },
  { key: 'm14', semis: 22, steps: 14, label: 'Minor 14th' },
  { key: 'M14', semis: 23, steps: 14, label: 'Major 14th' },
  { key: 'P15', semis: 24, steps: 15, label: 'Two octaves' },
];

/* Up to and including the octave: what the first drills were built from. */
export const SIMPLE_INTERVALS = INTERVALS.filter((i) => i.semis <= 12);

export const interval = (key) => INTERVALS.find((i) => i.key === key);
export const intervalAnswers = (keys) => keys.map((k) => ({ key: k, label: interval(k).label }));

/*
 * The ways an interval is played. `melodic` is up or down, `any` up, down or
 * together: one prompt each way, so a level asks them all.
 */
export const WAYS = {
  up: ['up'], down: ['down'], together: ['together'],
  melodic: ['up', 'down'], any: ['up', 'down', 'together'],
};

/* One interval from `anchor`, the note heard first: above it going up or
 * together, below it coming down. */
export function intervalEvents(anchor, semis, way, at = 0) {
  if (way === 'down') return melodic([anchor, anchor - semis], at);
  if (way === 'together') return together([anchor, anchor + semis], at);
  return melodic([anchor, anchor + semis], at);
}

/* Every root, every interval, played the way the level says. */
export function intervalPrompts(keys, way) {
  const ways = WAYS[way] || WAYS.up;
  return ({ lo, hi }) => {
    const out = [];
    for (let root = lo; root <= hi; root++) {
      for (let k = 0; k < keys.length; k++) {
        const iv = interval(keys[k]);
        const names = rootName(root).label + '-' + spellAbove(root, iv.semis, iv.steps);
        for (let w = 0; w < ways.length; w++) {
          /* Named low to high whichever way it sounds: the interval is the same. */
          const anchor = ways[w] === 'down' ? root + iv.semis : root;
          const events = intervalEvents(anchor, iv.semis, ways[w]);
          out.push({ answer: iv.key, events, label: names + ' ' + iv.key });
        }
      }
    }
    return out;
  };
}
