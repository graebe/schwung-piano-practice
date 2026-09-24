/*
 * The distractors are the difficulty. Two obviously-wrong options make it a
 * one-option quiz — you answer from a rough sense of high-or-low and never
 * learn the pad. These tests are mostly about that.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildChoices, nearness } from '../src/choices.mjs';
import { createQuiz, optionLabel, NOTES, CHORDS, TYPES } from '../src/guess.mjs';
import { rng } from '../src/generator.mjs';
import { spell } from '../src/notation.mjs';

const noteQuiz = () => createQuiz({ kind: NOTES, halfTones: true, pick: true, seed: 1 });
const chordQuiz = () => createQuiz({ kind: CHORDS, chordSet: TYPES, halfTones: true, pick: true, seed: 1 });
const nameOf = (pitches) => pitches.map((p) => spell(p, 0).name).join(' ');

/* ---- Shape ------------------------------------------------------------------- */

test('there are always three options and one of them is right', () => {
  const q = noteQuiz();
  const r = rng(9);
  for (let i = 0; i < 40; i++) {
    const correct = q.pool[i % q.pool.length];
    const opts = buildChoices(q.pool, correct, r, 3, nameOf);
    assert.equal(opts.length, 3);
    assert.ok(opts.includes(correct), 'the answer must be among them');
  }
});

test('no two options read the same — that would be two right answers', () => {
  for (const q of [noteQuiz(), chordQuiz()]) {
    const r = rng(4);
    for (let i = 0; i < 60; i++) {
      const correct = q.pool[i % q.pool.length];
      const opts = buildChoices(q.pool, correct, r, 3, (p) => nameOf(p));
      const labels = opts.map((o) => optionLabel(q, o));
      assert.equal(new Set(labels).size, labels.length, labels.join(' / '));
    }
  }
});

test('every option is something the drill could legitimately ask', () => {
  const q = noteQuiz();
  const r = rng(2);
  for (let i = 0; i < 30; i++) {
    for (const o of buildChoices(q.pool, q.pool[i % q.pool.length], r, 3, nameOf)) {
      assert.ok(q.pool.includes(o), 'an option outside the pool is unanswerable');
    }
  }
});

/* ---- Are they actually hard? ---------------------------------------------------- */

test('note distractors are near misses, not obvious rejects', () => {
  const q = noteQuiz();
  const r = rng(11);
  let total = 0;
  let n = 0;
  for (let i = 4; i < q.pool.length - 4; i++) {
    const correct = q.pool[i];
    for (const o of buildChoices(q.pool, correct, r, 3, nameOf)) {
      if (o === correct) continue;
      const gap = Math.abs(o.pitches[0] - correct.pitches[0]);
      assert.ok(gap <= 6, `${gap} semitones away is not a near miss`);
      total += gap;
      n++;
    }
  }
  assert.ok(total / n < 3.5, `average gap ${(total / n).toFixed(2)} is too wide to be confusable`);
});

test('and measurably nearer than picking at random', () => {
  const q = noteQuiz();
  const r = rng(5);
  const correct = q.pool[Math.floor(q.pool.length / 2)];
  let near = 0;
  for (const o of buildChoices(q.pool, correct, r, 3, nameOf)) {
    if (o !== correct) near += Math.abs(o.pitches[0] - correct.pitches[0]);
  }
  let random = 0;
  let count = 0;
  for (const o of q.pool) {
    if (o === correct) continue;
    random += Math.abs(o.pitches[0] - correct.pitches[0]);
    count++;
  }
  assert.ok(near / 2 < random / count, 'the chosen pair must beat the pool average');
});

test('chord distractors share the root, which is the confusion worth drilling', () => {
  const q = chordQuiz();
  const r = rng(3);
  let sameRoot = 0;
  let total = 0;
  for (let i = 0; i < 40; i++) {
    const correct = q.pool[(i * 7) % q.pool.length];
    for (const o of buildChoices(q.pool, correct, r, 3)) {
      if (o === correct) continue;
      total++;
      if (o.pitches[0] === correct.pitches[0]) sameRoot++;
    }
  }
  assert.ok(sameRoot / total > 0.8, `only ${sameRoot}/${total} shared a root`);
});

test('nearness ranks the way the drill needs', () => {
  const note = (p) => ({ pitches: [p] });
  assert.ok(nearness(note(60), note(61)) < nearness(note(60), note(62)));
  assert.ok(nearness(note(60), note(62)) < nearness(note(60), note(67)));
  /* The same note an octave out is a real mistake, not a distant one. */
  assert.ok(nearness(note(60), note(72)) < nearness(note(60), note(67)));
  const chord = (root, n) => ({ pitches: Array.from({ length: n }, (_, i) => root + i * 4) });
  assert.ok(nearness(chord(60, 3), chord(60, 4)) < nearness(chord(60, 3), chord(62, 3)));
});

/* ---- Degenerate pools ------------------------------------------------------------ */

test('a pool too small to supply distractors gives back what it has', () => {
  const one = [{ pitches: [60] }];
  assert.doesNotThrow(() => buildChoices(one, one[0], rng(1), 3, nameOf));
  assert.deepEqual(buildChoices(one, one[0], rng(1), 3, nameOf), one);

  const two = [{ pitches: [60] }, { pitches: [61] }];
  const opts = buildChoices(two, two[0], rng(1), 3, nameOf);
  assert.equal(opts.length, 2);
  assert.ok(opts.includes(two[0]));
});

test('a pool where everything reads alike still returns the answer', () => {
  /* Contrived, but an option list must never come back empty. */
  const pool = [{ pitches: [60], label: 'C' }, { pitches: [72], label: 'C' }];
  const opts = buildChoices(pool, pool[0], rng(1), 3);
  assert.ok(opts.includes(pool[0]));
  assert.equal(new Set(opts.map((o) => o.label)).size, opts.length);
});

/* ---- The shuffle ------------------------------------------------------------------ */

test('the answer is not always in the same place', () => {
  const q = noteQuiz();
  const r = rng(13);
  const positions = [0, 0, 0];
  for (let i = 0; i < 300; i++) {
    const correct = q.pool[i % q.pool.length];
    positions[buildChoices(q.pool, correct, r, 3, nameOf).indexOf(correct)]++;
  }
  for (let i = 0; i < 3; i++) {
    assert.ok(positions[i] > 50, `position ${i} came up only ${positions[i]} times in 300`);
  }
});

test('the same answer does not always come with the same pair', () => {
  /* Otherwise you learn the question rather than the note. */
  const q = noteQuiz();
  const r = rng(21);
  const correct = q.pool[Math.floor(q.pool.length / 2)];
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    seen.add(buildChoices(q.pool, correct, r, 3, nameOf)
      .filter((o) => o !== correct)
      .map((o) => nameOf(o.pitches))
      .sort()
      .join('|'));
  }
  assert.ok(seen.size > 1, 'the distractor pair should vary between askings');
});

test('no answer at all yields no options rather than a crash', () => {
  /* Reachable only from an empty pool, but the UI maps straight over the
   * result and a throw here would take the module down. */
  assert.deepEqual(buildChoices([], undefined, rng(1), 3, nameOf), []);
  assert.deepEqual(buildChoices([{ pitches: [60] }], null, rng(1), 3, nameOf), []);
});
