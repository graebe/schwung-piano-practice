import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createQuiz, nextPrompt, pressPitch, releasePitch, quizStats,
  NOTES, CHORDS, CORRECT, WRONG, INCOMPLETE,
} from '../src/guess.mjs';
import { inStaffRange } from '../src/notation.mjs';
import { padsForPitch, DEFAULT_TRANSPOSE } from '../src/padmap.mjs';
import { MODES } from '../src/generator.mjs';

const notesQuiz = (o = {}) => createQuiz({ kind: NOTES, seed: 3, ...o });
const chordQuiz = (o = {}) => createQuiz({ kind: CHORDS, seed: 3, ...o });

/* ---- What it can ask ------------------------------------------------------ */

test('every prompt is in the key, on the staff, and reachable on a pad', () => {
  for (const rootPc of [0, 2, 5, 7, 10]) {
    for (const kind of [NOTES, CHORDS]) {
      const q = createQuiz({ kind, rootPc, mode: 'major', seed: 7 });
      assert.ok(q.pool.length > 0, `${kind} in ${rootPc} has nothing to ask`);
      for (const prompt of q.pool) {
        for (const pitch of prompt) {
          assert.ok(inStaffRange(pitch), `${pitch} cannot be drawn`);
          assert.ok(padsForPitch(pitch, DEFAULT_TRANSPOSE).length > 0, `${pitch} has no pad`);
          const rel = (((pitch - rootPc) % 12) + 12) % 12;
          assert.ok(MODES.major.includes(rel), `${pitch} is not in the key`);
        }
      }
    }
  }
});

test('notes ask one pitch, chords ask three', () => {
  for (const prompt of notesQuiz().pool) assert.equal(prompt.length, 1);
  for (const prompt of chordQuiz().pool) assert.equal(prompt.length, 3);
});

test('chords are stacked thirds, so they are diatonic by construction', () => {
  for (const prompt of chordQuiz().pool) {
    const [a, b, c] = prompt;
    assert.ok(b - a === 3 || b - a === 4, `third is ${b - a}`);
    assert.ok(c - b === 3 || c - b === 4, `fifth is ${c - b}`);
  }
});

test('the same question is never asked twice running', () => {
  const q = notesQuiz();
  let previous = q.prompt.join(',');
  for (let i = 0; i < 60; i++) {
    const next = nextPrompt(q).join(',');
    assert.notEqual(next, previous, `repeated at ${i}`);
    previous = next;
  }
});

test('a seeded quiz is reproducible', () => {
  const a = notesQuiz({ seed: 42 });
  const b = notesQuiz({ seed: 42 });
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(nextPrompt(a), nextPrompt(b));
  }
});

/* ---- Answering ------------------------------------------------------------ */

test('the right note is correct', () => {
  const q = notesQuiz();
  assert.equal(pressPitch(q, q.prompt[0]), CORRECT);
  assert.equal(quizStats(q).correct, 1);
});

test('a wrong note is wrong, and the question stays', () => {
  const q = notesQuiz();
  const asked = q.prompt.slice();
  assert.equal(pressPitch(q, q.prompt[0] + 1), WRONG);
  assert.deepEqual(q.prompt, asked, 'it must wait until you play it');
  assert.equal(quizStats(q).wrong, 1);
  assert.equal(q.solved, false);
});

test('after a wrong note you can release it and still get it right', () => {
  const q = notesQuiz();
  const want = q.prompt[0];
  pressPitch(q, want + 1);
  releasePitch(q, want + 1);
  assert.equal(pressPitch(q, want), CORRECT);
});

test('a half-held chord is incomplete, not a mistake', () => {
  const q = chordQuiz();
  assert.equal(pressPitch(q, q.prompt[0]), INCOMPLETE);
  assert.equal(pressPitch(q, q.prompt[1]), INCOMPLETE);
  assert.equal(quizStats(q).wrong, 0, 'being part-way through is not failing');
  assert.equal(pressPitch(q, q.prompt[2]), CORRECT);
});

test('a chord must be held together, not arpeggiated', () => {
  const q = chordQuiz();
  pressPitch(q, q.prompt[0]);
  releasePitch(q, q.prompt[0]);
  pressPitch(q, q.prompt[1]);
  releasePitch(q, q.prompt[1]);
  assert.equal(pressPitch(q, q.prompt[2]), INCOMPLETE, 'one at a time never completes it');
  assert.equal(q.solved, false);
});

test('an extra note on top of the right chord is wrong', () => {
  const q = chordQuiz();
  pressPitch(q, q.prompt[0]);
  pressPitch(q, q.prompt[1]);
  assert.equal(pressPitch(q, q.prompt[2] + 1), WRONG);
});

test('two pads sounding the same pitch count once', () => {
  /* The grid is isomorphic, so a pitch has more than one pad. */
  const q = chordQuiz();
  pressPitch(q, q.prompt[0]);
  assert.equal(pressPitch(q, q.prompt[0]), INCOMPLETE, 'a duplicate must not complete a chord');
  assert.equal(q.held.length, 1);
  pressPitch(q, q.prompt[1]);
  assert.equal(pressPitch(q, q.prompt[2]), CORRECT);
});

test('holding a wrong note down is only counted once', () => {
  const q = chordQuiz();
  const bad = q.prompt[0] + 1;
  pressPitch(q, bad);
  pressPitch(q, q.prompt[0]);
  pressPitch(q, q.prompt[1]);
  assert.equal(quizStats(q).wrong, 1, 'one mistake, not one per press');
});

test('once solved, further presses do not re-score it', () => {
  const q = notesQuiz();
  pressPitch(q, q.prompt[0]);
  const before = quizStats(q);
  pressPitch(q, q.prompt[0] + 1);
  pressPitch(q, q.prompt[0]);
  assert.deepEqual(quizStats(q), before);
});

/* ---- Scoring -------------------------------------------------------------- */

test('a streak builds and a mistake resets it, but the best survives', () => {
  const q = notesQuiz();
  for (let i = 0; i < 4; i++) {
    pressPitch(q, q.prompt[0]);
    nextPrompt(q);
  }
  assert.equal(quizStats(q).streak, 4);
  assert.equal(quizStats(q).bestStreak, 4);
  pressPitch(q, q.prompt[0] + 1);
  assert.equal(quizStats(q).streak, 0);
  assert.equal(quizStats(q).bestStreak, 4, 'the best is a record, not a counter');
});

test('asked counts the questions, including the first', () => {
  const q = notesQuiz();
  assert.equal(quizStats(q).asked, 1);
  nextPrompt(q);
  nextPrompt(q);
  assert.equal(quizStats(q).asked, 3);
});

test('a new question clears the hands and the penalty', () => {
  const q = chordQuiz();
  pressPitch(q, q.prompt[0] + 1);
  nextPrompt(q);
  assert.deepEqual(q.held, []);
  assert.equal(q.solved, false);
  assert.equal(pressPitch(q, q.prompt[0] + 1), WRONG, 'a fresh mistake counts again');
  assert.equal(quizStats(q).wrong, 2);
});

test('an empty pool does not throw', () => {
  /* A range with nothing drawable in it should degrade, not crash. */
  const q = createQuiz({ kind: CHORDS, transpose: -60, seed: 1 });
  assert.deepEqual(q.prompt, []);
  assert.doesNotThrow(() => nextPrompt(q));
  assert.doesNotThrow(() => pressPitch(q, 60));
});
