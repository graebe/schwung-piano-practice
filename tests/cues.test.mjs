import test from 'node:test';
import assert from 'node:assert/strict';

import { successCue, failureCue } from '../src/cues.mjs';
import { pitchRange, DEFAULT_TRANSPOSE } from '../src/padmap.mjs';

const pcs = (cue) => cue.map((e) => e.pitch % 12);

test("the chime is the key's major chord, rising, soft", () => {
  const cue = successCue(0);
  assert.deepEqual(pcs(cue), [0, 4, 7, 0]);
  for (let i = 1; i < cue.length; i++) {
    assert.ok(cue[i].pitch > cue[i - 1].pitch, 'rising');
    assert.ok(cue[i].at > cue[i - 1].at, 'one note after another');
  }
  assert.ok(cue.every((e) => e.vel > 0 && e.vel <= 80), 'never loud');
  assert.deepEqual(pcs(successCue(7)), [7, 11, 2, 7], 'in G');
  assert.deepEqual(pcs(successCue(-5)), pcs(successCue(7)), 'any root wraps');
});

test('the uh-oh falls a minor 3rd, quieter than the chime', () => {
  const cue = failureCue(0);
  assert.equal(cue.length, 2);
  assert.equal(cue[0].pitch - cue[1].pitch, 3, 'sol to mi: a minor 3rd down');
  assert.ok(cue[1].at > cue[0].at);
  const loudest = (c) => Math.max(...c.map((e) => e.vel));
  assert.ok(loudest(cue) < loudest(successCue(0)));
});

test('neither cue lands on the pads at the default octave, so neither sounds like an answer', () => {
  const { lo, hi } = pitchRange(DEFAULT_TRANSPOSE);
  for (let root = 0; root < 12; root++) {
    for (const e of successCue(root)) assert.ok(e.pitch > hi, `chime ${e.pitch}`);
    for (const e of failureCue(root)) assert.ok(e.pitch < lo, `uh-oh ${e.pitch}`);
  }
});
