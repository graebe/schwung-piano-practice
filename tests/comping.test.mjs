// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VOICINGS, RHYTHMS, voiceChords, compEvents, beatsOf, VOICING_TEXT, RHYTHM_TEXT,
} from '../src/comping.mjs';
import { PROGRESSIONS, progressionChords } from '../src/progressions.mjs';
import { qualityById } from '../src/chords.mjs';
import { pitchRange } from '../src/padmap.mjs';

const pc = (p) => ((p % 12) + 12) % 12;

test('every progression, every voicing, every key: inside the pads, the chord\'s own notes', () => {
  for (const transpose of [0, 12, 24]) {
    const { lo, hi } = pitchRange(transpose);
    for (const item of PROGRESSIONS) {
      for (let tonic = 0; tonic < 12; tonic++) {
        const chords = progressionChords(item, tonic);
        for (const voicing of VOICINGS) {
          const voiced = voiceChords(chords, voicing, transpose);
          voiced.forEach((v, i) => {
            const tones = qualityById(chords[i].quality).intervals.map((x) => pc(x + chords[i].root));
            const all = (v.bass != null ? [v.bass] : []).concat(v.rh);
            for (const p of all) {
              assert.ok(p >= lo && p <= hi, `${item.id} ${voicing} in ${tonic}: ${p}`);
              assert.ok(tones.indexOf(pc(p)) >= 0, `${item.id} ${voicing}: ${p} is no tone of the chord`);
            }
            if (voicing === 'bass') assert.equal(pc(v.bass), chords[i].root);
            if (voicing === 'guide') assert.equal(v.rh.length, 2);
            if (voicing === 'root') assert.equal(pc(v.rh[0]), chords[i].root);
          });
        }
      }
    }
  }
});

test('smooth moves least: never more than root position does', () => {
  const motion = (vs) => {
    let m = 0;
    for (let i = 1; i < vs.length; i++) {
      for (const p of vs[i].rh) m += Math.min(...vs[i - 1].rh.map((q) => Math.abs(p - q)));
    }
    return m;
  };
  for (const item of PROGRESSIONS) {
    const chords = progressionChords(item, 2);
    assert.ok(motion(voiceChords(chords, 'smooth')) <= motion(voiceChords(chords, 'root')), item.id);
  }
});

test('every rhythm keeps the meter: a chord a bar, nothing past the bar line', () => {
  const chords = progressionChords(PROGRESSIONS.find((p) => p.id === 'I-V-vi-IV'), 0);
  for (const voicing of VOICINGS) {
    for (const rhythm of RHYTHMS) {
      const voiced = voiceChords(chords, voicing);
      const events = compEvents(voiced, rhythm, ['C', 'G', 'Am', 'F']);
      const per = beatsOf(rhythm);
      for (const e of events) {
        const bar = Math.floor(e.beat / per);
        assert.ok(e.beat + e.durBeats <= (bar + 1) * per + 1e-9, `${voicing}/${rhythm}: ${e.beat}+${e.durBeats}`);
      }
      for (let bar = 0; bar < 4; bar++) {
        assert.ok(events.some((e) => e.beat === bar * per || (rhythm === 'offbeat' && e.beat === bar * per + 0.5)),
          `${voicing}/${rhythm}: bar ${bar} is played`);
        const sym = events.find((e) => e.symbol && Math.floor(e.beat / per) === bar);
        assert.ok(sym, `${voicing}/${rhythm}: bar ${bar} carries its symbol`);
      }
      assert.ok(VOICING_TEXT[voicing] && RHYTHM_TEXT[rhythm]);
    }
  }
  assert.equal(beatsOf('waltz'), 3);
  assert.equal(beatsOf('pop'), 4);
});
