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

test('the uh-oh falls from the key\'s 5th to its 3rd, in a register a small speaker can play', () => {
  for (let root = 0; root < 12; root++) {
    const cue = failureCue(root);
    assert.equal(cue.length, 2);
    assert.equal(cue[0].pitch - cue[1].pitch, 3, 'sol to mi: a minor 3rd down');
    assert.equal(cue[0].pitch % 12, (root + 7) % 12, 'from the 5th');
    assert.ok(cue[1].at > cue[0].at);
    /* It was once at C2 and nobody heard it: keep it at 200Hz and up, and
     * struck firmly enough for the overtones to carry. */
    for (const e of cue) {
      assert.ok(e.pitch >= 55 && e.pitch <= 76, `${e.pitch} is out of the speaker's comfortable range`);
      assert.ok(e.vel >= 60 && e.vel <= 90, `velocity ${e.vel}`);
    }
    assert.ok(cue[0].pitch < successCue(root)[0].pitch, 'below the chime');
  }
});

test('the chime stays above the pads, so it never sounds like an answer', () => {
  const { hi } = pitchRange(DEFAULT_TRANSPOSE);
  for (let root = 0; root < 12; root++) {
    for (const e of successCue(root)) assert.ok(e.pitch > hi, `chime ${e.pitch}`);
  }
});
