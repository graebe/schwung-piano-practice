import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createQuiz, nextPrompt, pressPitch, releasePitch, quizStats,
  NOTES, CHORDS, CORRECT, WRONG, INCOMPLETE,
} from '../src/guess.mjs';
import { inStaffRange } from '../src/notation.mjs';
import { padsForPitch, DEFAULT_TRANSPOSE } from '../src/padmap.mjs';
import { MODES } from '../src/generator.mjs';
import { spell } from '../src/notation.mjs';

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

/* ---- Half tones ------------------------------------------------------------ */

test('with half tones on, the pool is every semitone in reach', () => {
  const diatonic = createQuiz({ kind: NOTES, halfTones: false, seed: 1 });
  const chromatic = createQuiz({ kind: NOTES, halfTones: true, seed: 1 });
  assert.ok(chromatic.pool.length > diatonic.pool.length);
  /* Consecutive prompts are a semitone apart, with no gaps. */
  const pitches = chromatic.pool.map((p) => p[0]);
  for (let i = 1; i < pitches.length; i++) {
    assert.equal(pitches[i] - pitches[i - 1], 1, 'the chromatic pool must not skip a note');
  }
});

test('half tones brings in the black notes, which are the hard ones on this grid', () => {
  const q = createQuiz({ kind: NOTES, rootPc: 0, mode: 'major', halfTones: true, seed: 1 });
  const altered = q.pool.filter((p) => spell(p[0], 0).alter !== 0);
  assert.ok(altered.length >= 5, 'all five accidentals should appear');
  const plain = createQuiz({ kind: NOTES, rootPc: 0, mode: 'major', halfTones: false, seed: 1 });
  assert.equal(plain.pool.filter((p) => spell(p[0], 0).alter !== 0).length, 0,
    'and none of them when it is off');
});

test('half tones are still drawable and still reachable on a pad', () => {
  const q = createQuiz({ kind: NOTES, halfTones: true, seed: 1 });
  for (const prompt of q.pool) {
    assert.ok(inStaffRange(prompt[0]), prompt[0] + ' cannot be drawn');
    assert.ok(padsForPitch(prompt[0], DEFAULT_TRANSPOSE).length > 0, prompt[0] + ' has no pad');
  }
});

test('the key still spells them: sharps in a sharp key, flats in a flat one', () => {
  const q = createQuiz({ kind: NOTES, halfTones: true, seed: 1 });
  const black = q.pool.map((p) => p[0]).find((p) => spell(p, 0).alter !== 0);
  assert.equal(spell(black, 2).label.slice(-1), '#', 'D major spells it sharp');
  assert.equal(spell(black, -1).label.slice(-1), 'b', 'F major spells it flat');
});

test('chords stay diatonic whatever the note pool does', () => {
  /* A triad is built from the scale; "a chromatic triad" would mean choosing a
   * root and a quality, which is a different drill. */
  const a = createQuiz({ kind: CHORDS, halfTones: false, seed: 1 });
  const b = createQuiz({ kind: CHORDS, halfTones: true, seed: 1 });
  assert.deepEqual(a.pool, b.pool);
});
