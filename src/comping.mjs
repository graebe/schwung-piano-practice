// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * comping.mjs — a progression as a pianist plays it: voiced, and in a
 * rhythm. Pure.
 *
 * A progression (progressions.mjs) says which chords; this says which notes
 * and when. Two choices, each a setup row of the progression trainer:
 *
 *   VOICING   root     every chord in close root position
 *             smooth   the nearest position to the chord before: the least
 *                      motion, as a keyboard player changes chords
 *             bass     the root alone in the left hand, the right hand smooth
 *                      above it (chord_lessons.chordSong's way)
 *             guide    the 3rd and 7th only (the 3rd and 5th of a triad),
 *                      smooth: the two notes that make a jazz chord's
 *                      quality and move by step from one chord to the next
 *
 *   RHYTHM    block    the chord on the bar's first beat, held
 *             pop      straight eighths, the whole bar
 *             ballad   the chord broken upwards in eighths
 *             offbeat  on the "and" of every beat (reggae, ska); the bass,
 *                      if any, on 1 and 3
 *             stabs    short, on 1 and the "and" of 2 (house)
 *             waltz    3/4: the root on 1, the chord on 2 and 3
 *
 * Everything stays inside the pads at the transpose asked for, and a bar is
 * always whole: the tests hold every voicing x rhythm to both.
 */

import { qualityById, closeVoicings, buildChord } from './chords.mjs';
import { chooseVoicing, voiceRightHand, rightHandTones } from './chord_lessons.mjs';
import { pitchRange, DEFAULT_TRANSPOSE } from './padmap.mjs';

export const VOICINGS = ['root', 'smooth', 'bass', 'guide'];
export const RHYTHMS = ['block', 'pop', 'ballad', 'offbeat', 'stabs', 'waltz'];
export const VOICING_TEXT = { root: 'root', smooth: 'smooth', bass: 'bass+chord', guide: 'guide tones' };
export const RHYTHM_TEXT = {
  block: 'block', pop: 'pop 8ths', ballad: 'ballad', offbeat: 'offbeat', stabs: 'stabs', waltz: 'waltz',
};

const pcOf = (p) => ((p % 12) + 12) % 12;

/* The 3rd and the 7th of a quality, or its 3rd and 5th when it has no 7th. */
function guideTones(quality) {
  const ivs = quality.intervals.map((i) => i % 12);
  const third = ivs.find((i) => i === 3 || i === 4) ?? ivs.find((i) => i === 2 || i === 5) ?? 7;
  const seventh = ivs.find((i) => i === 10 || i === 11 || (i === 9 && quality.id === 'dim7'));
  const other = seventh != null ? seventh : (ivs.find((i) => i === 7 || i === 6 || i === 8) ?? 0);
  return [third, other];
}

/*
 * Each chord's notes: [{ bass: pitch|null, rh: [pitches] }]. `chords` are
 * { root, quality } with the root a pitch class.
 */
export function voiceChords(chords, voicing = 'root', transpose = DEFAULT_TRANSPOSE) {
  const { lo, hi } = pitchRange(transpose);
  const mid = (lo + hi) / 2;
  const out = [];
  let prev = null;
  for (const c of chords) {
    const q = typeof c.quality === 'string' ? qualityById(c.quality) : c.quality;
    let rh;
    let bass = null;
    if (voicing === 'root') {
      /* The root nearest the middle that leaves room for the whole chord. */
      let best = null;
      for (let r = lo; r + q.intervals[q.intervals.length - 1] <= hi; r++) {
        if (pcOf(r) !== c.root) continue;
        const v = buildChord(r, q);
        if (!best || Math.abs((v[0] + v[v.length - 1]) / 2 - mid) < Math.abs((best[0] + best[best.length - 1]) / 2 - mid)) best = v;
      }
      /* Too wide for the pads as built (a 7b9 low on the grid): the same
       * tones packed into the octave above the root, still root lowest. */
      if (!best) {
        const pcs = q.intervals.map((i) => (i + c.root) % 12).filter((p, i, a) => a.indexOf(p) === i);
        best = chooseVoicing(closeVoicings(pcs, lo, hi, c.root), null, mid);
      }
      rh = best;
    } else if (voicing === 'bass') {
      bass = lo + pcOf(c.root - lo);
      const tones = rightHandTones(q).map((pc) => (pc + c.root) % 12);
      rh = voiceRightHand(tones, c.root, c.root, true, bass + 1, hi, null, prev);
    } else {
      const ivs = voicing === 'guide' ? guideTones(q) : rightHandTones(q);
      const pcs = ivs.map((i) => (i + c.root) % 12).filter((p, i, a) => a.indexOf(p) === i);
      rh = chooseVoicing(closeVoicings(pcs, lo, hi), prev, mid);
    }
    if (!rh) throw new Error(`no ${voicing} voicing of ${q.id} on ${c.root} fits`);
    prev = rh;
    out.push({ bass, rh });
  }
  return out;
}

/* The beats of a bar a rhythm plays on: [{ at, dur, part }], part 'chord',
 * 'bass' (the bass alone) or 'arp' (one note of the chord, by index). */
function pattern(rhythm, notes) {
  switch (rhythm) {
    case 'pop':
      return [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((at) => ({ at, dur: 0.5, part: 'chord' }));
    case 'ballad':
      return [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((at, i) => ({ at, dur: 0.5, part: 'arp', index: i % notes }));
    case 'offbeat':
      return [0.5, 1.5, 2.5, 3.5].map((at) => ({ at, dur: 0.5, part: 'chord' }))
        .concat([{ at: 0, dur: 1, part: 'bass' }, { at: 2, dur: 1, part: 'bass' }]);
    case 'stabs':
      return [{ at: 0, dur: 0.5, part: 'chord' }, { at: 1.5, dur: 0.5, part: 'chord' }];
    case 'waltz':
      return [{ at: 0, dur: 1, part: 'bass' }, { at: 1, dur: 1, part: 'chord' }, { at: 2, dur: 1, part: 'chord' }];
    default:
      return [{ at: 0, dur: 4, part: 'chord' }];
  }
}

/* How many beats a bar has in a rhythm. */
export const beatsOf = (rhythm) => (rhythm === 'waltz' ? 3 : 4);

/*
 * The events of a progression: one chord a bar, `voiced` (voiceChords) in
 * `rhythm`, from `startBeat`. Without a bass voicing the bass parts play the
 * chord's lowest note, so a bar never loses its downbeat. The chord's symbol
 * rides on its first event, for the name lane.
 */
export function compEvents(voiced, rhythm = 'block', symbols = [], startBeat = 0) {
  const per = beatsOf(rhythm);
  const events = [];
  voiced.forEach((v, bar) => {
    const notes = v.rh.length;
    const at0 = startBeat + bar * per;
    const ps = pattern(rhythm, notes);
    let first = true;
    for (const p of ps) {
      const beat = at0 + p.at;
      let pitches;
      let hand = 'r';
      if (p.part === 'bass') {
        pitches = [v.bass != null ? v.bass : v.rh[0]];
        hand = 'l';
      } else if (p.part === 'arp') {
        const all = (v.bass != null ? [v.bass] : []).concat(v.rh);
        pitches = [all[p.index % all.length]];
      } else {
        pitches = v.rh.slice();
      }
      const e = { beat, durBeats: p.dur, hand, pitches };
      if (first && symbols[bar]) { e.symbol = symbols[bar]; first = false; }
      events.push(e);
    }
    /* A bass voicing holds its root under the chords that do not play it. */
    if (v.bass != null && !ps.some((p) => p.part === 'bass' || p.part === 'arp')) {
      events.push({ beat: at0, durBeats: per, hand: 'l', pitches: [v.bass] });
    }
  });
  return events.sort((a, b) => a.beat - b.beat || (a.hand === 'l' ? -1 : 1));
}
