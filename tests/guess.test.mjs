import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createQuiz, nextPrompt, pressPitch, releasePitch, quizStats,
  NOTES, CHORDS, TRIADS, TYPES, CORRECT, WRONG, INCOMPLETE,
  roundComplete, roundElapsed, roundProgress,
  moveChoice, pickChoice, optionLabel, PICK_COUNT,
  takeHint, hintsLeft, isEliminated, MAX_HINT,
} from '../src/guess.mjs';
import { inStaffRange } from '../src/notation.mjs';
import { padsForPitch, DEFAULT_TRANSPOSE } from '../src/padmap.mjs';
import { MODES } from '../src/generator.mjs';
import { spell } from '../src/notation.mjs';
import { QUALITIES } from '../src/chords.mjs';

const notesQuiz = (o = {}) => createQuiz({ kind: NOTES, seed: 3, ...o });
const chordQuiz = (o = {}) => createQuiz({ kind: CHORDS, seed: 3, ...o });

/* ---- What it can ask ------------------------------------------------------ */

test('every prompt is in the key, on the staff, and reachable on a pad', () => {
  for (const rootPc of [0, 2, 5, 7, 10]) {
    for (const kind of [NOTES, CHORDS]) {
      const q = createQuiz({ kind, rootPc, mode: 'major', seed: 7 });
      assert.ok(q.pool.length > 0, `${kind} in ${rootPc} has nothing to ask`);
      for (const { pitches } of q.pool) {
        for (const pitch of pitches) {
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
  for (const e of notesQuiz().pool) assert.equal(e.pitches.length, 1);
  for (const e of chordQuiz().pool) assert.equal(e.pitches.length, 3);
});

test('chords are stacked thirds, so they are diatonic by construction', () => {
  for (const { pitches } of chordQuiz().pool) {
    const [a, b, c] = pitches;
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
  const pitches = chromatic.pool.map((e) => e.pitches[0]);
  for (let i = 1; i < pitches.length; i++) {
    assert.equal(pitches[i] - pitches[i - 1], 1, 'the chromatic pool must not skip a note');
  }
});

test('half tones brings in the black notes, which are the hard ones on this grid', () => {
  const q = createQuiz({ kind: NOTES, rootPc: 0, mode: 'major', halfTones: true, seed: 1 });
  const altered = q.pool.filter((e) => spell(e.pitches[0], 0).alter !== 0);
  assert.ok(altered.length >= 5, 'all five accidentals should appear');
  const plain = createQuiz({ kind: NOTES, rootPc: 0, mode: 'major', halfTones: false, seed: 1 });
  assert.equal(plain.pool.filter((e) => spell(e.pitches[0], 0).alter !== 0).length, 0,
    'and none of them when it is off');
});

test('half tones are still drawable and still reachable on a pad', () => {
  const q = createQuiz({ kind: NOTES, halfTones: true, seed: 1 });
  for (const { pitches } of q.pool) {
    assert.ok(inStaffRange(pitches[0]), pitches[0] + ' cannot be drawn');
    assert.ok(padsForPitch(pitches[0], DEFAULT_TRANSPOSE).length > 0, pitches[0] + ' has no pad');
  }
});

test('the key still spells them: sharps in a sharp key, flats in a flat one', () => {
  const q = createQuiz({ kind: NOTES, halfTones: true, seed: 1 });
  const black = q.pool.map((e) => e.pitches[0]).find((p) => spell(p, 0).alter !== 0);
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

/* ---- Chord qualities -------------------------------------------------------- */

test('the quality drill asks for far more than the seven diatonic triads', () => {
  const triads = createQuiz({ kind: CHORDS, chordSet: TRIADS, seed: 1 });
  const types = createQuiz({ kind: CHORDS, chordSet: TYPES, halfTones: true, seed: 1 });
  assert.ok(types.pool.length > triads.pool.length * 5, 'should be a much wider pool');
});

test('every quality in the table can actually be asked for', () => {
  const q = createQuiz({ kind: CHORDS, chordSet: TYPES, halfTones: true, seed: 1 });
  const suffixes = new Set(q.pool.map((e) => e.label.replace(/^[A-G][#b]?/, '')));
  for (const quality of QUALITIES) {
    assert.ok(suffixes.has(quality.suffix), `${quality.id} never appears`);
  }
});

test('a quality chord is spelled exactly as its table says', () => {
  const q = createQuiz({ kind: CHORDS, chordSet: TYPES, halfTones: true, seed: 1 });
  for (const entry of q.pool) {
    const suffix = entry.label.replace(/^[A-G][#b]?/, '');
    const quality = QUALITIES.find((x) => x.suffix === suffix);
    assert.ok(quality, `unknown suffix in ${entry.label}`);
    const root = entry.pitches[0];
    assert.deepEqual(entry.pitches, quality.intervals.map((i) => root + i), entry.label);
  }
});

test('every quality chord is drawable and every note of it reachable', () => {
  for (const halfTones of [false, true]) {
    const q = createQuiz({ kind: CHORDS, chordSet: TYPES, halfTones, seed: 3 });
    assert.ok(q.pool.length > 0);
    for (const { pitches } of q.pool) {
      for (const p of pitches) {
        assert.ok(inStaffRange(p), `${p} cannot be drawn`);
        assert.ok(padsForPitch(p, DEFAULT_TRANSPOSE).length > 0, `${p} has no pad`);
      }
    }
  }
});

test('the prompt carries its symbol, and only where a symbol means something', () => {
  const types = createQuiz({ kind: CHORDS, chordSet: TYPES, halfTones: true, seed: 4 });
  assert.match(types.label, /^[A-G][#b]?/, 'a quality chord names itself');
  assert.equal(createQuiz({ kind: CHORDS, chordSet: TRIADS, seed: 4 }).label, null,
    'a diatonic triad has nothing to add to its note names');
  assert.equal(createQuiz({ kind: NOTES, seed: 4 }).label, null);
});

test('the key spells the root: sharps in a sharp key, flats in a flat one', () => {
  const sharp = createQuiz({ kind: CHORDS, chordSet: TYPES, halfTones: true, fifths: 2, seed: 1 });
  const flat = createQuiz({ kind: CHORDS, chordSet: TYPES, halfTones: true, fifths: -1, seed: 1 });
  assert.ok(sharp.pool.some((e) => e.label.includes('#')));
  assert.ok(flat.pool.some((e) => e.label.includes('b')));
  assert.ok(!flat.pool.some((e) => /^[A-G]#/.test(e.label)), 'a flat key must not spell sharps');
});

test('answering a quality chord works like any other', () => {
  const q = createQuiz({ kind: CHORDS, chordSet: TYPES, halfTones: true, seed: 6 });
  const wanted = q.prompt.slice();
  for (let i = 0; i < wanted.length - 1; i++) {
    assert.equal(pressPitch(q, wanted[i]), INCOMPLETE, 'part of it down is not a mistake');
  }
  assert.equal(pressPitch(q, wanted[wanted.length - 1]), CORRECT);
});

test('four-note chords really do occur, and must be held in full', () => {
  const q = createQuiz({ kind: CHORDS, chordSet: TYPES, halfTones: true, seed: 1 });
  const seventh = q.pool.find((e) => e.pitches.length === 4);
  assert.ok(seventh, 'sevenths should be in the pool');
  const quiz = createQuiz({ kind: CHORDS, chordSet: TYPES, halfTones: true, seed: 1 });
  quiz.prompt = seventh.pitches.slice();
  quiz.label = seventh.label;
  for (let i = 0; i < 3; i++) assert.equal(pressPitch(quiz, seventh.pitches[i]), INCOMPLETE);
  assert.equal(pressPitch(quiz, seventh.pitches[3]), CORRECT);
});

/* ---- Rounds ------------------------------------------------------------------ */

function answer(q, at) {
  for (const p of q.prompt.slice()) { pressPitch(q, p, at); }
  for (const p of q.prompt.slice()) { releasePitch(q, p); }
}

test('the clock starts on the first press, not when the screen appears', () => {
  const q = createQuiz({ kind: NOTES, roundSize: 3, seed: 1 });
  assert.equal(q.startedAt, null, 'time spent getting your bearings is not part of the score');
  assert.equal(roundElapsed(q, 9999), 0);
  pressPitch(q, q.prompt[0], 5000);
  assert.equal(q.startedAt, 5000);
});

test('a round ends on exactly N correct answers', () => {
  const q = createQuiz({ kind: NOTES, roundSize: 3, seed: 1 });
  let t = 1000;
  for (let i = 0; i < 3; i++) {
    assert.equal(roundComplete(q), false, 'not before the last one');
    answer(q, t);
    t += 1000;
    if (!roundComplete(q)) nextPrompt(q);
  }
  assert.equal(roundComplete(q), true);
  assert.deepEqual(roundProgress(q), { done: 3, total: 3 });
});

test('a wrong answer costs time but does not advance the round', () => {
  const q = createQuiz({ kind: NOTES, roundSize: 2, seed: 1 });
  const wrong = q.prompt[0] + 1;
  pressPitch(q, wrong, 1000);
  releasePitch(q, wrong);
  assert.equal(roundProgress(q).done, 0, 'still nothing achieved');
  answer(q, 3000);
  assert.equal(roundProgress(q).done, 1);
  assert.ok(roundElapsed(q, 3000) >= 2000, 'and the two seconds were spent');
});

test('elapsed stops at the last correct answer, not whenever you look', () => {
  const q = createQuiz({ kind: NOTES, roundSize: 1, seed: 1 });
  answer(q, 4000);
  assert.equal(roundComplete(q), true);
  const a = roundElapsed(q, 99999);
  const b = roundElapsed(q, 500000);
  assert.equal(a, b, 'a finished round has a fixed duration');
});

test('endless practice never completes and is never recorded', () => {
  const q = createQuiz({ kind: NOTES, roundSize: 0, seed: 1 });
  for (let i = 0; i < 50; i++) { answer(q, 1000 + i * 100); nextPrompt(q); }
  assert.equal(roundComplete(q), false);
  assert.equal(roundProgress(q).total, 0);
});

/* ---- Multiple choice ----------------------------------------------------------- */

const pickQuiz = (o = {}) => createQuiz({ kind: NOTES, halfTones: true, pick: true, seed: 2, ...o });

test('a pick prompt comes with its options, one of them right', () => {
  const q = pickQuiz();
  assert.equal(q.choices.length, PICK_COUNT);
  assert.ok(q.choices.includes(q.entry));
  assert.equal(q.choiceIndex, 0);
});

test('the jog moves between the options and wraps', () => {
  const q = pickQuiz();
  assert.equal(moveChoice(q, 1), 1);
  assert.equal(moveChoice(q, 1), 2);
  assert.equal(moveChoice(q, 1), 0, 'wraps forward');
  assert.equal(moveChoice(q, -1), 2, 'and back');
});

test('a wrong pick is counted and the question stays', () => {
  const q = pickQuiz();
  const right = q.choices.indexOf(q.entry);
  const prompt = q.prompt.slice();
  q.choiceIndex = (right + 1) % PICK_COUNT;
  assert.equal(pickChoice(q, 1000), WRONG);
  assert.equal(q.wrong, 1);
  assert.equal(q.solved, false);
  assert.deepEqual(q.prompt, prompt, 'it must wait until you get it right');
  /* And only counted once, however many times you pick wrong. */
  q.choiceIndex = (right + 2) % PICK_COUNT;
  pickChoice(q, 1100);
  assert.equal(q.wrong, 1);
});

test('the right pick solves it and counts toward the round', () => {
  const q = pickQuiz({ roundSize: 2 });
  q.choiceIndex = q.choices.indexOf(q.entry);
  assert.equal(pickChoice(q, 1000), CORRECT);
  assert.equal(q.correct, 1);
  assert.equal(roundProgress(q).done, 1);
});

test('a round of picks completes on N correct, like every other drill', () => {
  const q = pickQuiz({ roundSize: 3 });
  let t = 1000;
  for (let i = 0; i < 3; i++) {
    q.choiceIndex = q.choices.indexOf(q.entry);
    pickChoice(q, t);
    t += 1000;
    if (!roundComplete(q)) nextPrompt(q);
  }
  assert.equal(roundComplete(q), true);
  assert.ok(roundElapsed(q) > 0);
});

test('the clock starts on the first jog move, since there are no pad presses', () => {
  const q = pickQuiz();
  assert.equal(q.startedAt, null);
  moveChoice(q, 1, 4242);
  assert.equal(q.startedAt, 4242);
});

test('note options carry their octave — the grid has the same name in several places', () => {
  const q = pickQuiz();
  for (const c of q.choices) assert.match(optionLabel(q, c), /[0-9]$/);
});

test('chord options are the chord symbols, not lists of note names', () => {
  /* Asserted against the entry's own symbol rather than by pattern: "G6" is a
   * perfectly good chord symbol that also looks like a note in octave 6. */
  const q = createQuiz({ kind: CHORDS, chordSet: TYPES, halfTones: true, pick: true, seed: 2 });
  for (const c of q.choices) {
    assert.equal(optionLabel(q, c), c.label);
    assert.ok(c.label && !c.label.includes(' '), `${c.label} looks like a note list`);
  }
  assert.ok(q.prompt.length >= 3, 'and several pads light at once');
});

/* ---- Help -------------------------------------------------------------------- */

test('the ladder climbs twice and then stops', () => {
  const q = notesQuiz();
  assert.equal(hintsLeft(q), MAX_HINT);
  assert.equal(takeHint(q, q.rand), 1);
  assert.equal(takeHint(q, q.rand), 2);
  assert.equal(takeHint(q, q.rand), 2, 'a third press changes nothing');
  assert.equal(hintsLeft(q), 0);
});

test('a third press does not inflate the count', () => {
  const q = notesQuiz();
  for (let i = 0; i < 6; i++) takeHint(q, q.rand);
  assert.equal(q.hintsUsed, MAX_HINT, 'only the rungs actually climbed are counted');
});

test('the ladder resets per prompt but the tally does not', () => {
  const q = notesQuiz();
  takeHint(q, q.rand);
  takeHint(q, q.rand);
  nextPrompt(q);
  assert.equal(q.hint, 0, 'a new question starts unaided');
  assert.equal(hintsLeft(q), MAX_HINT);
  assert.equal(q.hintsUsed, 2, 'but the round remembers');
});

test('a hinted answer still counts and keeps the streak', () => {
  /* A hint you are afraid to use is a hint that does not help you learn. */
  const q = notesQuiz();
  pressPitch(q, q.prompt[0], 100);
  releasePitch(q, q.prompt[0]);
  nextPrompt(q);
  takeHint(q, q.rand);
  pressPitch(q, q.prompt[0], 200);
  assert.equal(q.correct, 2);
  assert.equal(quizStats(q).streak, 2, 'the streak survives asking for help');
});

test('a hint in the picking drill strikes out a wrong option, never the right one', () => {
  for (let seed = 1; seed < 12; seed++) {
    const q = createQuiz({ kind: NOTES, halfTones: true, pick: true, seed });
    const answer = q.choices.indexOf(q.entry);
    takeHint(q, q.rand);
    assert.equal(q.eliminated.length, 1);
    assert.ok(!isEliminated(q, answer), 'the answer must never be struck out');
    takeHint(q, q.rand);
    assert.equal(q.eliminated.length, 2);
    assert.ok(!isEliminated(q, answer));
    /* Two rungs on three options leaves exactly the right one standing. */
    let standing = 0;
    for (let i = 0; i < q.choices.length; i++) if (!isEliminated(q, i)) standing++;
    assert.equal(standing, 1);
  }
});

test('the cursor cannot rest on a struck-out option', () => {
  const q = createQuiz({ kind: NOTES, halfTones: true, pick: true, seed: 4 });
  takeHint(q, q.rand);
  for (let i = 0; i < 12; i++) {
    moveChoice(q, i % 2 ? 1 : -1);
    assert.ok(!isEliminated(q, q.choiceIndex), 'landing on it would make the hint pointless');
  }
});

test('the picking ladder ends with the answer selectable and correct', () => {
  const q = createQuiz({ kind: NOTES, halfTones: true, pick: true, seed: 6 });
  takeHint(q, q.rand);
  takeHint(q, q.rand);
  moveChoice(q, 1);
  assert.equal(pickChoice(q, 1000), CORRECT);
});
