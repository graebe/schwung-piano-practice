// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * staff.test.mjs -- the grand staff's geometry (web/src/music/staff.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/music/staff.js';
import { spell } from '../../src/notation.mjs';

const LETTERS = 'CDEFGAB';

test('the staves: F5 tops the treble, A3 the bass, seven spaces apart', () => {
  assert.equal(S.TREBLE_TOP, 38);
  assert.equal(S.written(77).step, S.TREBLE_TOP, 'F5 is the treble top line');
  assert.equal(S.written(64).step, S.TREBLE_BOTTOM, 'E4 the treble bottom line');
  assert.equal(S.written(57).step, S.BASS_TOP, 'A3 the bass top line');
  assert.equal(S.written(43).step, S.BASS_BOTTOM, 'G2 the bass bottom line');
  assert.equal(S.spacesBelowTop(S.TREBLE_TOP, 'treble'), 0);
  assert.equal(S.spacesBelowTop(S.TREBLE_BOTTOM, 'treble'), 4);
  assert.equal(S.spacesBelowTop(S.BASS_TOP, 'bass'), 7);
  assert.equal(S.spacesBelowTop(S.BASS_BOTTOM, 'bass'), 11);
  assert.deepEqual(S.staffLines('treble'), [30, 32, 34, 36, 38]);
  assert.deepEqual(S.staffLines('bass'), [18, 20, 22, 24, 26]);
  assert.throws(() => S.spacesBelowTop(30, 'alto'), /no staff/);
});

test('middle C sits on one ledger line on either staff, a space apart', () => {
  const c = S.written(60);
  assert.equal(c.step, S.MIDDLE_C);
  assert.deepEqual(S.ledgerSteps(c.step, 'treble'), [28]);
  assert.deepEqual(S.ledgerSteps(c.step, 'bass'), [28]);
  assert.equal(S.spacesBelowTop(28, 'treble'), 5);
  assert.equal(S.spacesBelowTop(28, 'bass'), 6);
});

test('ledger lines: none in the space just outside a staff, then one per line', () => {
  assert.deepEqual(S.ledgerSteps(39, 'treble'), [], 'G5 sits on the top line\'s space');
  assert.deepEqual(S.ledgerSteps(40, 'treble'), [40], 'A5 one ledger');
  assert.deepEqual(S.ledgerSteps(43, 'treble'), [40, 42], 'D6 two');
  assert.deepEqual(S.ledgerSteps(29, 'treble'), [], 'D4 hangs under the staff');
  assert.deepEqual(S.ledgerSteps(26, 'treble'), [28, 26], 'A3 on the treble, two below');
  assert.deepEqual(S.ledgerSteps(17, 'bass'), [], 'F2 hangs under the bass');
  assert.deepEqual(S.ledgerSteps(14, 'bass'), [16, 14], 'C2 two below');
  assert.deepEqual(S.ledgerSteps(30, 'bass'), [28, 30], 'E4 on the bass, two above');
  assert.deepEqual(S.ledgerSteps(34, 'treble'), [], 'on the staff');
});

test('which staff: by hand when the exercise says, else middle C and up on the treble', () => {
  assert.equal(S.staffOf(28), 'treble');
  assert.equal(S.staffOf(27), 'bass');
  assert.equal(S.staffOf(20, 'r'), 'treble');
  assert.equal(S.staffOf(36, 'l'), 'bass');
  assert.equal(S.staffOf(36, 'x'), 'treble');
});

test('spelling is the engine\'s, mapped to step and alteration', () => {
  for (let pitch = 21; pitch <= 108; pitch++) {
    for (let f = -7; f <= 7; f++) {
      const s = spell(pitch, f);
      const w = S.written(pitch, f);
      assert.equal(w.step, s.diatonic);
      assert.equal(w.alteration, s.alter);
      assert.equal(w.letter, s.letterIndex);
      /* The step and alteration put the pitch back together. */
      const natural = [0, 2, 4, 5, 7, 9, 11][((w.step % 7) + 7) % 7] + 12 * (Math.floor(w.step / 7) + 1);
      assert.equal(natural + w.alteration, pitch, `${pitch} in ${f}`);
    }
  }
  assert.deepEqual(S.written(70, -1), { step: 34, alteration: -1, letter: 6, label: 'Bb', name: 'Bb4' });
  assert.equal(S.written(70, 2).label, 'A#');
  assert.equal(S.spokenName(66, 1), 'F sharp 4');
  assert.equal(S.spokenName(70, -1), 'B flat 4');
  assert.equal(S.spokenName(60), 'C 4');
});

test('names under the notes: the symbol when there is one, else the notes low to high', () => {
  assert.equal(S.noteLabel([67, 60, 64], 0), 'C E G');
  assert.equal(S.noteLabel([70], -1), 'Bb');
  assert.equal(S.noteLabel([60, 63, 67], 0, 'Cm'), 'Cm');
});

/* The textbook signatures: which letters each key alters, in order. */
const SHARPS = 'FCGDAEB';
const FLATS = 'BEADGCF';
/* And where each sits, as a note name, on the treble and on the bass. */
const SHARP_PLACES = { treble: ['F5', 'C5', 'G5', 'D5', 'A4', 'E5', 'B4'], bass: ['F3', 'C3', 'G3', 'D3', 'A2', 'E3', 'B2'] };
const FLAT_PLACES = { treble: ['B4', 'E5', 'A4', 'D5', 'G4', 'C5', 'F4'], bass: ['B2', 'E3', 'A2', 'D3', 'G2', 'C3', 'F2'] };
const place = (step) => `${LETTERS[step % 7]}${Math.floor(step / 7)}`;

test('key signatures: every key, both clefs, in order and on the textbook places', () => {
  for (let f = -7; f <= 7; f++) {
    for (const staff of ['treble', 'bass']) {
      const sig = S.keySignature(f, staff);
      assert.equal(sig.length, Math.abs(f));
      const order = f > 0 ? SHARPS : FLATS;
      const places = (f > 0 ? SHARP_PLACES : FLAT_PLACES)[staff];
      sig.forEach((k, i) => {
        assert.equal(LETTERS[k.letter], order[i], `${f} ${staff} #${i} letter`);
        assert.equal(place(k.step), places[i], `${f} ${staff} #${i} place`);
        assert.equal(LETTERS[((k.step % 7) + 7) % 7], order[i], 'written on its own letter');
        assert.equal(k.glyph, f > 0 ? S.GLYPH.sharp : S.GLYPH.flat);
        if (i > 0) assert.ok(k.x > sig[i - 1].x, 'left to right');
      });
      /* Every accidental inside the staff or one step outside it. */
      const [lo, hi] = staff === 'treble' ? [S.TREBLE_BOTTOM - 1, S.TREBLE_TOP + 1] : [S.BASS_BOTTOM - 1, S.BASS_TOP + 1];
      for (const k of sig) assert.ok(k.step >= lo && k.step <= hi, `${f} ${staff} ${place(k.step)} off the staff`);
    }
  }
  assert.equal(S.keySignature(9, 'treble').length, 7, 'clamped');
  assert.equal(S.keySignature(undefined, 'treble').length, 0);
});

test('accidentals against the signature: drawn where they differ, a natural cancelling', () => {
  for (let f = -7; f <= 7; f++) {
    for (let letter = 0; letter < 7; letter++) {
      const sig = S.signatureAlteration(f, letter);
      const expected = f > 0 ? SHARPS.slice(0, f).includes(LETTERS[letter]) : FLATS.slice(0, -f).includes(LETTERS[letter]);
      assert.equal(sig !== 0, expected, `${f} ${LETTERS[letter]}`);
      assert.equal(S.accidentalFor(sig, letter, f), null, 'as the key writes it: nothing');
    }
  }
  assert.equal(S.accidentalFor(-1, 6, -1), null, 'Bb in F major');
  assert.equal(S.accidentalFor(0, 6, -1), S.GLYPH.natural, 'B natural in F major');
  assert.equal(S.accidentalFor(1, 3, 0), S.GLYPH.sharp, 'F# in C major');
  assert.equal(S.accidentalFor(1, 3, 1), null, 'F# in G major');
  assert.equal(S.accidentalFor(0, 3, 2), S.GLYPH.natural, 'F natural in D major');
  /* End to end, through the engine's spelling. */
  const draw = (pitch, f) => { const w = S.written(pitch, f); return S.accidentalFor(w.alteration, w.letter, f); };
  assert.equal(draw(71, -1), S.GLYPH.natural);
  assert.equal(draw(70, -1), null);
  assert.equal(draw(61, 0), S.GLYPH.sharp);
  assert.equal(draw(63, -3), null, 'Eb in Eb major');
});

test('glyphs: SMuFL code points, the accidental for every alteration', () => {
  assert.equal(S.GLYPH.gClef, 0xe050);
  assert.equal(S.GLYPH.fClef, 0xe062);
  assert.equal(S.GLYPH.noteheadBlack, 0xe0a4);
  assert.deepEqual([-2, -1, 0, 1, 2].map(S.accidentalGlyph), [0xe264, 0xe260, 0xe261, 0xe262, 0xe263]);
  assert.throws(() => S.accidentalGlyph(3), /no accidental/);
  assert.equal(S.char(0xe050), '');
  assert.equal(S.timeSigText(12), '');
  assert.ok(Math.abs(S.timeSigWidth(4) - S.advance(0xe084)) < 1e-9);
});

test('Bravura metrics: em is four spaces, advances read from the subset', () => {
  assert.equal(S.EM, 4);
  /* Bravura's black notehead is 1.18 spaces wide (SMuFL metadata). */
  assert.ok(Math.abs(S.advance(S.GLYPH.noteheadBlack) - 1.18) < 0.01);
  for (const cp of Object.values(S.GLYPH)) assert.ok(S.advance(cp) > 0);
  assert.throws(() => S.advance(0xe000), /not in NI Notation/);
});

test('key changes: the new signature, or naturals where the key goes to C', () => {
  assert.deepEqual(S.keyChangeGlyphs(0, 2, 'treble'), S.keySignature(2, 'treble'));
  const cancel = S.keyChangeGlyphs(-3, 0, 'bass');
  assert.equal(cancel.length, 3);
  assert.ok(cancel.every((k) => k.glyph === S.GLYPH.natural));
  assert.deepEqual(cancel.map((k) => k.step), S.keySignature(-3, 'bass').map((k) => k.step));
  assert.equal(S.signatureWidth([]), 0);
  assert.ok(S.signatureWidth(S.keySignature(7, 'treble')) > S.signatureWidth(S.keySignature(1, 'treble')));
});

test('a second in a chord: the upper head moves over, alternating up a cluster', () => {
  assert.deepEqual(S.secondShifts([30, 32, 34]), [false, false, false]);
  assert.deepEqual(S.secondShifts([30, 31]), [false, true]);
  assert.deepEqual(S.secondShifts([31, 30]), [true, false], 'in input order');
  assert.deepEqual(S.secondShifts([28, 29, 30]), [false, true, false]);
  assert.deepEqual(S.secondShifts([28, 29, 30, 31]), [false, true, false, true]);
  assert.deepEqual(S.secondShifts([]), []);
});

test('accidental columns: none within a sixth share a column', () => {
  assert.deepEqual(S.accidentalColumns([30]), [0]);
  assert.deepEqual(S.accidentalColumns([30, 37]), [0, 0], 'an octave apart share');
  assert.deepEqual(S.accidentalColumns([30, 32]), [1, 0], 'the top one nearest the heads');
  assert.deepEqual(S.accidentalColumns([30, 32, 34]), [2, 1, 0], 'three within a sixth: three columns');
  const cols = S.accidentalColumns([28, 29, 31, 33, 35]);
  const steps = [28, 29, 31, 33, 35];
  for (let i = 0; i < steps.length; i++)
    for (let j = i + 1; j < steps.length; j++)
      if (cols[i] === cols[j]) assert.ok(Math.abs(steps[i] - steps[j]) >= 6);
});

test('the gutter: room for the widest signature and the time', () => {
  const plain = S.gutter(0, [4, 4]);
  const sharp7 = S.gutter(7, [4, 4]);
  assert.ok(sharp7.end > plain.end);
  assert.ok(plain.timeX >= S.SIGNATURE_X);
  assert.ok(sharp7.timeX >= S.SIGNATURE_X + S.signatureWidth(S.keySignature(7, 'treble')));
  assert.equal(S.gutter(0, null).timeX, null);
  assert.ok(S.gutter(0, [12, 8]).timeWidth > plain.timeWidth);
});

test('the system layout: whole pixels, staves where the steps say', () => {
  for (const space of [6, 8, 10, 12.5]) {
    const L = space === 12.5 ? S.systemLayout(space, { names: 0 }) : S.systemLayout(space);
    for (let step = 10; step <= 46; step++)
      for (const staff of ['treble', 'bass']) assert.ok(Number.isInteger(L.y(step, staff)));
    assert.equal(L.y(S.TREBLE_TOP, 'treble'), L.trebleTop);
    assert.equal(L.y(S.BASS_BOTTOM, 'bass'), L.bassBottom);
    assert.ok(L.nameY > L.bassBottom);
    assert.ok(L.height >= L.nameY);
    assert.ok(L.y(30, 'treble') > L.y(38, 'treble'), 'higher is up');
  }
  const L = S.systemLayout(10);
  assert.equal(L.y(28, 'bass') - L.y(28, 'treble'), 10, 'middle C a space apart');
});
