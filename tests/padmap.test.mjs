import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PAD_FIRST, PAD_LAST, PAD_COUNT, MIDI_BASE_NOTE, DEFAULT_TRANSPOSE,
  isPad, padRowCol, padAbsSemi, padPitch, padsForPitch, pitchRange,
  fitTranspose, scalePcSet, padBaseColor,
  LED_ROOT, LED_SCALE, LED_OFF,
} from '../src/padmap.mjs';
import { MIN_PITCH } from '../src/notation.mjs';

test('the grid is 32 pads, notes 68..99', () => {
  assert.equal(PAD_LAST - PAD_FIRST + 1, PAD_COUNT);
  assert.ok(isPad(68) && isPad(99));
  assert.ok(!isPad(67) && !isPad(100) && !isPad(16));
});

test('the layout is isomorphic: +1 across, +5 up', () => {
  assert.deepEqual(padRowCol(68), { row: 0, col: 0 });
  assert.deepEqual(padRowCol(99), { row: 3, col: 7 });
  assert.equal(padAbsSemi(69) - padAbsSemi(68), 1);
  assert.equal(padAbsSemi(76) - padAbsSemi(68), 5);
});

test('bottom-left is A2 untransposed, matching Move', () => {
  assert.equal(padAbsSemi(68) + MIDI_BASE_NOTE, 45);
});

test('the default transpose lifts the grid onto the treble staff', () => {
  const r = pitchRange(DEFAULT_TRANSPOSE);
  assert.equal(r.lo, 57);
  assert.equal(r.hi, 79);
  assert.equal(r.lo, MIN_PITCH, 'the lowest pad is the lowest note the staff can draw');
  assert.ok(pitchRange(0).hi < 68, 'untransposed the grid sits below the staff');
});

test('every pad round-trips through padsForPitch', () => {
  for (let pad = PAD_FIRST; pad <= PAD_LAST; pad++) {
    const pitch = padPitch(pad, DEFAULT_TRANSPOSE);
    assert.ok(padsForPitch(pitch, DEFAULT_TRANSPOSE).includes(pad), `pad ${pad}`);
  }
});

test('isomorphic twins all sound the same pitch', () => {
  const twins = padsForPitch(72, DEFAULT_TRANSPOSE);
  assert.ok(twins.length > 1, 'C5 appears on more than one pad');
  for (const pad of twins) assert.equal(padPitch(pad, DEFAULT_TRANSPOSE), 72);
});

test('a pitch off the grid maps to no pads', () => {
  assert.deepEqual(padsForPitch(30, DEFAULT_TRANSPOSE), []);
  assert.deepEqual(padsForPitch(120, DEFAULT_TRANSPOSE), []);
});

test('transposing shifts every pad by the same amount', () => {
  for (let pad = PAD_FIRST; pad <= PAD_LAST; pad++) {
    assert.equal(padPitch(pad, 5) - padPitch(pad, 0), 5);
  }
});

test('fitTranspose centres a melody in the grid', () => {
  const t = fitTranspose([60, 64, 67, 72]);
  const r = pitchRange(t);
  assert.ok(r.lo <= 60 && r.hi >= 72, `range ${r.lo}..${r.hi} should cover the tune`);
  assert.equal(fitTranspose([]), DEFAULT_TRANSPOSE);
});

test('pad colouring marks the root, the scale, and nothing else', () => {
  const scale = scalePcSet(0);
  let root = 0;
  let inScale = 0;
  let off = 0;
  for (let pad = PAD_FIRST; pad <= PAD_LAST; pad++) {
    const c = padBaseColor(pad, DEFAULT_TRANSPOSE, scale, 0);
    if (c === LED_ROOT) root++;
    else if (c === LED_SCALE) inScale++;
    else if (c === LED_OFF) off++;
  }
  assert.ok(root > 0, 'at least one C is visible');
  assert.ok(inScale > 0);
  assert.ok(off > 0, 'the black notes of C major are dark');
  assert.equal(root + inScale + off, PAD_COUNT);
  for (const pad of padsForPitch(72, DEFAULT_TRANSPOSE)) {
    assert.equal(padBaseColor(pad, DEFAULT_TRANSPOSE, scale, 0), LED_ROOT);
  }
});
