// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  spell, pitchToY, diatonicToY, ledgerYs, inStaffRange, chordLabel,
  majorKeyFifths, MIN_PITCH, MAX_PITCH, NATURAL_PC, LETTERS, scaleKey,
} from '../src/notation.mjs';
import { MODES } from '../src/generator.mjs';
import { STAFF_LINE_YS, STEP_PX } from '../src/layout.mjs';

test('naturals spell without an accidental, unless the signature names that pitch another way', () => {
  for (let fifths = -5; fifths <= 5; fifths++) {
    for (let i = 0; i < NATURAL_PC.length; i++) {
      const s = spell(60 + NATURAL_PC[i], fifths);
      assert.equal(s.alter, 0, `pc ${NATURAL_PC[i]} in ${fifths}`);
      assert.equal(s.letter, LETTERS[i]);
    }
  }
  /* Six and seven sharps or flats put accidentals on white keys: F# major's
   * 7th is E#, Gb major's 4th Cb — and in the octave the letter belongs to. */
  assert.equal(spell(65, 6).label, 'E#');
  assert.equal(spell(72, 7).name, 'B#4');
  assert.equal(spell(71, -6).name, 'Cb5');
  assert.equal(spell(64, -7).label, 'Fb');
  assert.equal(spell(62, 6).label, 'D', 'a white key the signature does not touch stays natural');
});

test('sharp keys spell black notes as sharps, flat keys as flats', () => {
  assert.equal(spell(66, 2).label, 'F#');   /* D major */
  assert.equal(spell(70, 2).label, 'A#');
  assert.equal(spell(70, -1).label, 'Bb');  /* F major */
  assert.equal(spell(61, -3).label, 'Db');
  assert.equal(spell(61, 0).label, 'C#');   /* C major defaults to sharps */
});

test('a flat spelling never leaks into the next octave', () => {
  for (let pitch = 21; pitch <= 108; pitch++) {
    const flat = spell(pitch, -1);
    const sharp = spell(pitch, 1);
    assert.equal(flat.octave, Math.floor(pitch / 12) - 1, `flat octave at ${pitch}`);
    assert.equal(sharp.octave, Math.floor(pitch / 12) - 1, `sharp octave at ${pitch}`);
  }
});

test('E4 sits on the bottom line and F5 on the top line', () => {
  assert.equal(pitchToY(64), STAFF_LINE_YS[STAFF_LINE_YS.length - 1]);
  assert.equal(pitchToY(77), STAFF_LINE_YS[0]);
});

test('each diatonic step is exactly STEP_PX and higher pitch means smaller y', () => {
  const cMajor = [60, 62, 64, 65, 67, 69, 71, 72];
  for (let i = 1; i < cMajor.length; i++) {
    assert.equal(pitchToY(cMajor[i - 1]) - pitchToY(cMajor[i]), STEP_PX);
  }
});

test('enharmonics land on different staff steps', () => {
  /* Gb and F# are the same key but not the same line. */
  assert.notEqual(pitchToY(66, -1), pitchToY(66, 1));
  assert.equal(spell(66, -1).letter, 'G');
  assert.equal(spell(66, 1).letter, 'F');
});

test('ledger lines appear only outside the staff and step by a full line gap', () => {
  assert.deepEqual(ledgerYs(pitchToY(64)), [], 'E4 on the bottom line');
  assert.deepEqual(ledgerYs(pitchToY(62)), [], 'D4 in the space below needs none');
  assert.deepEqual(ledgerYs(pitchToY(60)), [40], 'middle C gets one');
  assert.deepEqual(ledgerYs(pitchToY(57)), [40, 44], 'A3 gets two');
  assert.deepEqual(ledgerYs(pitchToY(81)), [16], 'A5 gets one above');
  assert.deepEqual(ledgerYs(pitchToY(84)), [16, 12], 'C6 gets two above');
});

test('the declared range is exactly what two ledger steps can show', () => {
  assert.equal(MIN_PITCH, 57);
  assert.equal(MAX_PITCH, 84);
  assert.ok(inStaffRange(57) && inStaffRange(84));
  assert.ok(!inStaffRange(56) && !inStaffRange(85));
  assert.equal(ledgerYs(pitchToY(MIN_PITCH)).length, 2);
  assert.equal(ledgerYs(pitchToY(MAX_PITCH)).length, 2);
});

test('chord labels read low to high and drop the octave', () => {
  assert.equal(chordLabel([72, 66, 76], 2), 'F# C E');
  assert.equal(chordLabel([60], 0), 'C');
});

test('diatonicToY and pitchToY agree', () => {
  for (let p = MIN_PITCH; p <= MAX_PITCH; p++) {
    assert.equal(pitchToY(p, 0), diatonicToY(spell(p, 0).diatonic));
  }
});

test('major key signatures follow the circle of fifths', () => {
  assert.equal(majorKeyFifths(0), 0);   /* C  */
  assert.equal(majorKeyFifths(7), 1);   /* G  */
  assert.equal(majorKeyFifths(5), -1);  /* F  */
  assert.equal(majorKeyFifths(2), 2);   /* D  */
  assert.equal(majorKeyFifths(10), -2); /* Bb */
});

/* ---- A scale's own spelling ------------------------------------------------- */

test('every seven-note scale on every root takes one letter a degree, one accidental at most', () => {
  const fallbacks = [];
  for (const mode of Object.keys(MODES)) {
    if (MODES[mode].length !== 7) continue;
    for (let pc = 0; pc < 12; pc++) {
      const key = scaleKey(pc, MODES[mode], mode);
      const notes = MODES[mode].map((s) => spell(60 + pc + s, key));
      const line = `${key.root} ${mode}: ${notes.map((n) => n.label).join(' ')}`;
      for (const n of notes) assert.ok(Math.abs(n.alter) <= 1, line);
      /* Some cannot: the altered scale on F would need Bbb, Bhairav on Ab
       * Bbb and on G# F##. Those are written with a letter twice, as jazz
       * players write the altered scale — and only those. */
      if (key.nearest) fallbacks.push(line);
      else assert.equal(new Set(notes.map((n) => n.letterIndex)).size, 7, line);
    }
  }
  assert.ok(fallbacks.length < 12, fallbacks.join('\n'));
  assert.ok(fallbacks.every((l) => /superLocrian|bhairav|hungarianMinor|phrygianDominant|harmonicMinor/.test(l)), fallbacks.join('\n'));
  const f = scaleKey(5, MODES.superLocrian, 'superLocrian');
  assert.ok(f.map, 'still spelled as a scale, not chromatically');
});

test('C minor is Eb Ab Bb; F# major has its E#; harmonic minor raises the 7th on its own letter', () => {
  const line = (pc, mode) => {
    const k = scaleKey(pc, MODES[mode], mode);
    return MODES[mode].map((s) => spell(60 + pc + s, k).label).join(' ');
  };
  assert.equal(line(0, 'minor'), 'C D Eb F G Ab Bb');
  assert.equal(line(6, 'major'), 'F# G# A# B C# D# E#');
  assert.equal(line(6, 'harmonicMinor'), 'F# G# A B C# D E#');
  assert.equal(line(0, 'harmonicMinor'), 'C D Eb F G Ab B');
  assert.equal(line(0, 'minorBlues'), 'C Eb F Gb G Bb');
  assert.equal(line(1, 'major'), 'Db Eb F Gb Ab Bb C', 'five flats beat seven sharps');
});

test('the signature: a mode takes its parent major, other scales their tonic', () => {
  const sig = (pc, mode) => scaleKey(pc, MODES[mode], mode).fifths;
  assert.equal(sig(9, 'minor'), 0);
  assert.equal(sig(0, 'minor'), -3);
  assert.equal(sig(2, 'dorian'), 0);
  assert.equal(sig(4, 'phrygian'), 0);
  assert.equal(sig(0, 'harmonicMinor'), -3, 'its raised 7th is an accidental');
  assert.equal(sig(6, 'major'), 6);
  assert.equal(sig(0, 'majorPent'), 0);
  assert.equal(sig(9, 'minorPent'), 0);
  assert.equal(scaleKey(0, MODES.chromatic, 'chromatic').map, null);
});
