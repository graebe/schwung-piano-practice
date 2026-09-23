import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MODES, PC_NAMES, rng, scalePitches, playableRange,
  scaleRun, intervalDrill, triadDrill, randomInKey, builtins,
} from '../src/generator.mjs';
import { validateExercise } from '../src/exercise_io.mjs';
import { inStaffRange } from '../src/notation.mjs';
import { DEFAULT_TRANSPOSE, padsForPitch } from '../src/padmap.mjs';

const ALL = () => [
  scaleRun({}),
  scaleRun({ rootPc: 7, mode: 'minor', direction: 'up' }),
  scaleRun({ rootPc: 5, direction: 'down' }),
  intervalDrill({ steps: 2, seed: 3 }),
  intervalDrill({ rootPc: 9, mode: 'dorian', steps: 4, seed: 9 }),
  triadDrill({}),
  triadDrill({ rootPc: 5, degrees: [0, 5, 3, 4] }),
  randomInKey({ seed: 11 }),
  randomInKey({ rootPc: 2, mode: 'pentatonic', density: 2, seed: 4 }),
];

test('the seeded rng is deterministic and stays in [0,1)', () => {
  const a = rng(42);
  const b = rng(42);
  for (let i = 0; i < 50; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
  assert.notEqual(rng(1)(), rng(2)());
});

test('every generated exercise passes the same validator as a hand-written one', () => {
  for (const chart of ALL()) {
    const { ok, errors } = validateExercise(chart);
    assert.ok(ok, `${chart.id}: ${errors.join('; ')}`);
  }
});

test('events are beat-ordered and carry at least one pitch', () => {
  for (const chart of ALL()) {
    let prev = -1;
    for (const e of chart.events) {
      assert.ok(e.beat >= prev, `${chart.id} goes backwards at ${e.beat}`);
      prev = e.beat;
      assert.ok(e.pitches.length > 0);
    }
  }
});

test('everything generated is both readable on the staff and reachable on a pad', () => {
  for (const chart of ALL()) {
    for (const e of chart.events) {
      for (const p of e.pitches) {
        assert.ok(inStaffRange(p), `${chart.id}: ${p} is off the staff`);
        assert.ok(padsForPitch(p, DEFAULT_TRANSPOSE).length > 0, `${chart.id}: ${p} has no pad`);
      }
    }
  }
});

test('the same seed rebuilds the identical exercise', () => {
  const a = randomInKey({ seed: 7, bars: 2 });
  const b = randomInKey({ seed: 7, bars: 2 });
  assert.deepEqual(a.events, b.events);
  assert.notDeepEqual(randomInKey({ seed: 8, bars: 2 }).events, a.events);
  assert.deepEqual(intervalDrill({ seed: 5 }).events, intervalDrill({ seed: 5 }).events);
});

test('scalePitches returns only notes of the mode, ascending', () => {
  const { lo, hi } = playableRange();
  for (const mode of Object.keys(MODES)) {
    const pitches = scalePitches(0, mode, lo, hi);
    for (let i = 1; i < pitches.length; i++) assert.ok(pitches[i] > pitches[i - 1]);
    for (const p of pitches) {
      assert.ok(MODES[mode].includes(((p % 12) + 12) % 12), `${mode}: ${p}`);
    }
  }
});

test('a scale run starts and ends on the root, and turns around in the middle', () => {
  const up = scaleRun({ rootPc: 0, direction: 'up' });
  const first = up.events[0].pitches[0];
  const last = up.events[up.events.length - 1].pitches[0];
  assert.equal(first % 12, 0);
  assert.equal(last % 12, 0);
  assert.equal(last - first, 12);

  const updown = scaleRun({ rootPc: 0, direction: 'updown' });
  const seq = updown.events.map((e) => e.pitches[0]);
  assert.equal(seq[0], seq[seq.length - 1]);
  assert.equal(Math.max(...seq), seq[(seq.length - 1) / 2]);

  const down = scaleRun({ rootPc: 0, direction: 'down' });
  const dseq = down.events.map((e) => e.pitches[0]);
  assert.deepEqual(dseq, dseq.slice().sort((a, b) => b - a));
});

test('one note per beat in a scale run', () => {
  const s = scaleRun({});
  s.events.forEach((e, i) => assert.equal(e.beat, i));
});

test('an interval drill alternates root and interval at the right distance', () => {
  const d = intervalDrill({ rootPc: 0, mode: 'major', steps: 2, count: 6, seed: 2 });
  assert.equal(d.events.length, 12);
  for (let i = 0; i < d.events.length; i += 2) {
    const a = d.events[i].pitches[0];
    const b = d.events[i + 1].pitches[0];
    assert.ok(b > a, 'the interval reaches upward');
    assert.ok(b - a === 3 || b - a === 4, `a third is 3 or 4 semitones, got ${b - a}`);
  }
});

test('triads keep three distinct tones — the range fits the top of every chord', () => {
  for (const rootPc of [0, 2, 5, 7, 9, 11]) {
    const t = triadDrill({ rootPc, degrees: [0, 3, 4, 0] });
    for (const e of t.events) {
      assert.equal(e.pitches.length, 3, `${PC_NAMES[rootPc]} chord collapsed: ${e.pitches}`);
      assert.ok(e.pitches[2] > e.pitches[1] && e.pitches[1] > e.pitches[0]);
    }
    assert.deepEqual(t.events[0].pitches, t.events[3].pitches, 'I returns to I');
  }
});

test('a triad is stacked thirds of the scale', () => {
  const t = triadDrill({ rootPc: 0, mode: 'major', degrees: [0] });
  assert.deepEqual(t.events[0].pitches.map((p) => p % 12), [0, 4, 7]);
});

test('random reading fills the requested bars at the requested density', () => {
  const easy = randomInKey({ bars: 4, density: 1, seed: 1 });
  assert.equal(easy.events.length, 16);
  easy.events.forEach((e, i) => assert.equal(e.beat, i));

  const fast = randomInKey({ bars: 4, density: 2, seed: 1 });
  assert.equal(fast.events.length, 32);
  assert.equal(fast.events[1].beat, 0.5);
});

test('the random walk stays playable — no wild leaps', () => {
  const r = randomInKey({ bars: 8, density: 1, seed: 21 });
  for (let i = 1; i < r.events.length; i++) {
    const leap = Math.abs(r.events[i].pitches[0] - r.events[i - 1].pitches[0]);
    assert.ok(leap <= 12, `leap of ${leap} semitones is not a reading exercise`);
  }
});

test('the key setting reaches every generated exercise', () => {
  for (const b of builtins({ rootPc: 5, mode: 'major' })) {
    const chart = b.build();
    assert.equal(chart.keySig, -1, `${b.label} should be in F major`);
  }
});

test('the builtin list is stable and every entry builds', () => {
  const list = builtins({});
  assert.ok(list.length >= 5);
  for (const b of list) {
    assert.equal(typeof b.label, 'string');
    const chart = b.build();
    assert.ok(validateExercise(chart).ok, b.label);
  }
});
