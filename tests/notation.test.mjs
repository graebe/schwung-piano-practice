import test from 'node:test';
import assert from 'node:assert/strict';

import {
  spell, pitchToY, diatonicToY, ledgerYs, inStaffRange, chordLabel,
  majorKeyFifths, MIN_PITCH, MAX_PITCH, NATURAL_PC, LETTERS,
} from '../src/notation.mjs';
import { STAFF_LINE_YS, STEP_PX } from '../src/layout.mjs';

test('naturals spell without an accidental in every key', () => {
  for (let fifths = -7; fifths <= 7; fifths++) {
    for (let i = 0; i < NATURAL_PC.length; i++) {
      const s = spell(60 + NATURAL_PC[i], fifths);
      assert.equal(s.alter, 0, `pc ${NATURAL_PC[i]} in ${fifths}`);
      assert.equal(s.letter, LETTERS[i]);
    }
  }
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
