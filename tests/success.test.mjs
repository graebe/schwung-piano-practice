// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * Success, per round and per answer: what a round records, what it adds up to
 * over every round, and the result pages that plot it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createQuiz, pressPitch, releasePitch, nextPrompt, pickChoice, chooseAnswer, answerKey, tallyRows,
  NOTES, CHORDS, EAR, TYPES, CORRECT,
} from '../src/guess.mjs';
import {
  emptyStats, addTally, tallyFor, answerRows, parseStats, serialiseStats, successSeries, successPercent,
  makeRecord, addRecord,
} from '../src/stats.mjs';
import { quizScore } from '../src/progress.mjs';
import { fakeHost, openPath } from './support/fake_host.mjs';
import { RESULT_VIEW } from '../src/session.mjs';
import { createScreen, countOn, toAscii } from '../tools/screen_buffer.mjs';
import * as V from '../src/view.mjs';
import * as L from '../src/layout.mjs';

/* ---- The engine -------------------------------------------------------------- */

test('a prompt right first time counts right; one with a wrong attempt is asked but not right', () => {
  const q = createQuiz({ kind: NOTES, halfTones: true, seed: 5 });
  const first = answerKey(q, q.entry).key;
  pressPitch(q, q.prompt[0]);
  nextPrompt(q);
  const second = answerKey(q, q.entry).key;
  pressPitch(q, q.prompt[0] + 1);          /* wrong */
  releasePitch(q, q.prompt[0] + 1);
  pressPitch(q, q.prompt[0]);              /* then right */
  if (first === second) {
    assert.deepEqual(q.tally[first], [2, 1]);
  } else {
    assert.deepEqual(q.tally[first], [1, 1]);
    assert.deepEqual(q.tally[second], [1, 0]);
  }
});

test('holding a wrong note counts once against the round, but the prompt stays missed', () => {
  const q = createQuiz({ kind: NOTES, halfTones: true, seed: 2 });
  const p = q.prompt[0];
  pressPitch(q, p + 1);
  pressPitch(q, p + 2);
  assert.equal(q.wrong, 1);
  releasePitch(q, p + 1);
  releasePitch(q, p + 2);
  pressPitch(q, p + 1);
  assert.equal(q.wrong, 2, 'released and wrong again is a second attempt');
  releasePitch(q, p + 1);
  assert.equal(pressPitch(q, p), CORRECT);
  assert.deepEqual(Object.values(q.tally), [[1, 0]]);
});

test('what an answer is: the hearing answer, a note name, a chord quality', () => {
  const ear = createQuiz({ kind: EAR, exercise: 'id-6ths', level: 'up', seed: 3 });
  const k = answerKey(ear, ear.entry);
  assert.ok(['m6', 'M6'].includes(k.key));
  assert.match(k.label, /6th$/);
  const notes = createQuiz({ kind: NOTES, halfTones: true, fifths: 2 });
  assert.equal(answerKey(notes, { pitches: [66] }).key, 'F#');
  assert.equal(answerKey(notes, { pitches: [78] }).key, 'F#', 'no octave');
  const types = createQuiz({ kind: CHORDS, chordSet: TYPES, seed: 4 });
  assert.equal(answerKey(types, types.entry).key, types.entry.quality);
  assert.ok(types.pool.every((e) => typeof e.quality === 'string'));
});

test('a picked answer is tallied the same way', () => {
  const q = createQuiz({ kind: EAR, exercise: 'id-3rds', level: 'up', seed: 9 });
  const right = q.choices.findIndex((c) => c.key === q.entry.answer);
  chooseAnswer(q, (right + 1) % q.choices.length);
  chooseAnswer(q, right);
  const rows = tallyRows(q);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].asked, 1);
  assert.equal(rows[0].right, 0);
  assert.equal(pickChoice(q), CORRECT, 'solved stays solved');
});

test('rows come in the answers\' order for hearing, from C up for notes', () => {
  const q = createQuiz({ kind: NOTES, halfTones: true, seed: 1 });
  for (let i = 0; i < 40; i++) { pressPitch(q, q.prompt[0]); nextPrompt(q); }
  const names = tallyRows(q).map((r) => r.label);
  const order = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const v = (n) => order[n[0]] + (n[1] === '#' ? 0.5 : n[1] === 'b' ? -0.5 : 0);
  assert.deepEqual(names, names.slice().sort((a, b) => v(a) - v(b)));
  const ear = createQuiz({ kind: EAR, exercise: 'id-to-8', level: 'up', seed: 1 });
  for (let i = 0; i < 60; i++) { chooseAnswer(ear, ear.choices.findIndex((c) => c.key === ear.entry.answer)); nextPrompt(ear); }
  const keys = tallyRows(ear).map((r) => r.key);
  const want = ear.answers.map((a) => a.key).filter((k) => keys.includes(k));
  assert.deepEqual(keys, want);
});

/* ---- Storage ------------------------------------------------------------------- */

test('the tally adds up over rounds, apart from the records, and survives a save', () => {
  const s = emptyStats();
  addTally(s, 'ear:id-6ths:up', { m6: [3, 2], M6: [2, 2] });
  addTally(s, 'ear:id-6ths:up', { m6: [1, 1] });
  assert.deepEqual(tallyFor(s, 'ear:id-6ths:up'), { m6: [4, 3], M6: [2, 2] });
  for (let i = 0; i < 300; i++) addRecord(s, makeRecord({ drill: 'x', n: 1, ms: 1000 }));
  const back = parseStats(serialiseStats(s));
  assert.deepEqual(tallyFor(back, 'ear:id-6ths:up'), { m6: [4, 3], M6: [2, 2] }, 'not trimmed with the records');
  assert.deepEqual(answerRows(back, 'ear:id-6ths:up').map((r) => r.label), ['Minor 6th', 'Major 6th']);
});

test('an old file without a tally loads, and a damaged entry is dropped', () => {
  const old = parseStats(JSON.stringify({ version: 1, records: [{ t: 1, d: 'x', n: 5, ms: 9000, w: 1, h: 0 }] }));
  assert.equal(old.records.length, 1);
  assert.deepEqual(old.tally, {});
  const bad = parseStats(JSON.stringify({ version: 1, records: [], tally: { d: { a: [2, 3], b: [2, 1], c: 'x' } } }));
  assert.deepEqual(bad.tally, { d: { b: [2, 1] } });
});

test('success per round is what Progress scores a round by', () => {
  const recs = [makeRecord({ drill: 'x', n: 18, ms: 60000, wrong: 2 }), makeRecord({ drill: 'x', n: 20, ms: 60000, wrong: 0, hints: 1 })];
  const series = successSeries(recs);
  assert.equal(series[0][1], quizScore(18, 2) * 100);
  assert.equal(series[0][2], 2);
  assert.equal(series[1][2], 1, 'a hinted round is drawn hollow');
  assert.equal(successPercent(18, 2), 90);
});

/* ---- A played round ------------------------------------------------------------ */

function playRound(h, path, wrongEvery = 3) {
  if (path) openPath(h.session, path);
  for (let i = 0; i < 300 && h.session.view !== RESULT_VIEW; i++) {
    const q = h.session.quiz;
    const right = q.choices.findIndex((c) => c.key === q.entry.answer);
    if (i % wrongEvery === 0) h.session.answer((right + 1) % q.choices.length);
    h.session.answer(right);
    h.run(1500);
  }
  assert.equal(h.session.view, RESULT_VIEW);
  return h.session.lastResult;
}

test('a round\'s result carries its success and every answer, this round and all time', () => {
  const h = fakeHost();
  h.session.init();
  const path = ['Quiz', 'Hear', 'Identify intervals', '9 Up to the octave', 'Int to octave up'];
  const one = playRound(h, path);
  assert.equal(one.answers.reduce((n, r) => n + r.asked, 0), one.n, 'every right answer is some answer\'s');
  assert.equal(one.success, Math.round((one.n / (one.n + one.wrong)) * 100));
  for (const r of one.answers) assert.deepEqual([r.allAsked, r.allRight], [r.asked, r.right]);
  h.session.recordButton();                     /* again, from the result */
  const two = playRound(h, null);
  const asked = two.answers.reduce((n, r) => n + r.allAsked, 0);
  assert.ok(asked > two.n, 'all time includes the first round');
});

test('the jog turns the result\'s pages, and wraps', () => {
  const h = fakeHost();
  h.session.init();
  const res = playRound(h, ['Quiz', 'Hear', 'Identify scales', '6 Seven modes', 'Scale 7 modes up']);
  const pages = L.resultPageCount(res.answers);
  assert.equal(pages, 2 + Math.ceil(res.answers.length / L.ANSWER_ROWS));
  for (let i = 1; i < pages; i++) { h.session.moveSelection(1); assert.equal(h.session.lastResult.page, i); }
  h.session.moveSelection(1);
  assert.equal(h.session.lastResult.page, 0);
  h.session.moveSelection(-1);
  assert.equal(h.session.lastResult.page, pages - 1);
});

/* ---- The pages ------------------------------------------------------------------- */

const state = (page, answers) => ({
  kind: 'quiz', rate: 20, n: 10, wrong: 2, hints: 0, ms: 30000, bestStreak: 4, best: 22, page, success: 83,
  records: [makeRecord({ drill: 'x', n: 10, ms: 30000, wrong: 2 }), makeRecord({ drill: 'x', n: 10, ms: 30000, wrong: 0 })],
  answers,
});
const ANSWERS = Array.from({ length: 13 }, (_, i) => ({
  key: 'k' + i, label: i === 3 ? 'Diminished 12th' : 'Answer ' + i, asked: 4, right: i % 5, allAsked: 10, allRight: i % 11,
})).map((r) => ({ ...r, right: Math.min(r.right, r.asked), allRight: Math.min(r.allRight, r.allAsked) }));

test('the summary leads with the share right', () => {
  const c = createScreen();
  V.drawResultPage(c, state(0, ANSWERS));
  const plain = createScreen();
  V.drawRoundResult(plain, state(0, ANSWERS));
  assert.equal(toAscii(c), toAscii(plain), 'page 0 is the round, as before');
});

test('RIGHT % draws the rounds on 0-100%, ANSWERS four rows a page, all on screen', () => {
  const pages = L.resultPageCount(ANSWERS);
  assert.equal(pages, 2 + 4, '13 answers make four pages of answers');
  for (let p = 1; p < pages; p++) {
    const c = createScreen();
    V.drawResultPage(c, state(p, ANSWERS));
    assert.ok(countOn(c, 0, 10, L.SCREEN_W, 40) > 20, `page ${p} drew`);
  }
  const last = createScreen();
  V.drawResultPage(last, state(pages - 1, ANSWERS));
  const rowY = (i) => V.ANSWER_ROW_TOP_Y + i * V.ANSWER_ROW_STEP;
  assert.ok(countOn(last, 0, rowY(0), L.SCREEN_W, L.TEXT_H) > 0, 'the 13th answer, alone on its page');
  assert.equal(countOn(last, 0, rowY(1), 50, L.TEXT_H), 0, 'and nothing under it');
});

test('a bar is as long as the share right, over every round', () => {
  assert.equal(V.answerBarFill(0, 10), 0);
  assert.equal(V.answerBarFill(10, 10), V.answerBarFill(1, 1));
  assert.equal(V.answerBarFill(5, 10), Math.round(V.answerBarFill(10, 10) / 2));
  assert.equal(V.answerBarFill(0, 0), 0, 'never asked: empty, not NaN');
});
