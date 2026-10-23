// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * The per-item table (stats.items): how each note, interval, scale, chord and
 * progression has gone, whatever drill asked it — and the one-time migration
 * that builds it from a version 1 file's per-drill tally.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STATS_VERSION, emptyStats, parseStats, serialiseStats, addItems, itemHistory, itemRows,
  migrateTally, itemOfTally, isItem, SUBJECTS,
} from '../src/stats.mjs';
import { createQuiz, pickChoice, nextPrompt, itemOf, quizSubject, quizMode, NOTES, CHORDS, EAR } from '../src/guess.mjs';
import { fakeHost, openPath } from './support/fake_host.mjs';
import { GUESS_VIEW } from '../src/session.mjs';

/* A version 1 file as the module wrote it: one drill of every kind. */
const V1_TALLY = {
  'guess:notes:key': { C: [4, 3], 'F#': [2, 0] },
  'pick:notes:half': { Bb: [3, 1] },
  'staff:notes:key': { C: [2, 2] },
  'hear:notes:half': { 'C#': [1, 1] },
  'guess:chords:triads': { Em: [3, 2], Bdim: [1, 0], 'C E A': [1, 1] },
  'staff:chords:types': { m7: [2, 1], maj: [5, 5], '7': [1, 0] },
  'pick:chords:advanced': { m9: [1, 1] },
  'ear:triads:block': { maj: [6, 5], min: [4, 2] },
  'ear:sevenths:three': { '7': [2, 2] },
  'ear:id-3rds:up': { m3: [5, 4], M3: [5, 3] },
  'ear:rd-id-3rds:together': { m3: [2, 2] },
  'ear:thirds:down': { M3: [1, 0] },
  'ear:cmp-3rds:up': { first: [3, 2], same: [2, 2] },
  'ear:sc-maj-min:up': { major: [3, 3], minor: [3, 1] },
  'ear:rd-sc-pent:down': { majorPent: [2, 1] },
  'ear:direction:wide': { higher: [3, 1] },
  'ear:degrees:135': { 3: [2, 2] },
  'ear:functions:iv-v': { IV: [1, 1] },
};
const V1 = JSON.stringify({ version: 1, records: [{ t: 1, d: 'guess:notes:key', n: 6, ms: 9000, w: 2, h: 0 }], tally: V1_TALLY });

test('the table has five subjects, and a version 1 file is migrated into it', () => {
  assert.deepEqual(SUBJECTS, ['note', 'int', 'scale', 'chord', 'prog']);
  assert.equal(STATS_VERSION, 2);
  const s = parseStats(V1);
  assert.equal(s.migrated, true);
  const { note, int, scale, chord } = s.items;
  /* Notes: the name drill is play, by staff and by picking is read, hearing is hear. */
  assert.deepEqual(note.C.play, [4, 3]);
  assert.deepEqual(note.C.read, [2, 2]);
  assert.deepEqual(note.C.keys, { 0: [6, 5] });
  assert.deepEqual(note.Bb.read, [3, 1]);
  assert.deepEqual(note['C#'].hear, [1, 1]);
  /* Chords: the triads by name (with their roots), the quality drills by suffix. */
  assert.deepEqual(chord.min.play, [3, 2]);
  assert.deepEqual(chord.min.keys, { 4: [3, 2] });
  assert.deepEqual(chord.dim.play, [1, 0]);
  assert.deepEqual(chord.m7.read, [2, 1]);
  assert.deepEqual(chord.maj.read, [5, 5]);
  assert.deepEqual(chord.maj.hear, [6, 5]);
  assert.deepEqual(chord['7'].read, [1, 0]);
  assert.deepEqual(chord['7'].hear, [2, 2]);
  assert.deepEqual(chord.m9.read, [1, 1]);
  /* Intervals, heard and read, including a replaced exercise's id. */
  assert.deepEqual(int.m3.hear, [5, 4]);
  assert.deepEqual(int.m3.read, [2, 2]);
  assert.deepEqual(int.M3.hear, [6, 3]);
  /* Scales. */
  assert.deepEqual(scale.minor.hear, [3, 1]);
  assert.deepEqual(scale.majorPent.read, [2, 1]);
  assert.equal(s.items.prog, undefined, 'no progression was ever tallied');
});

test('answers that are no item stay in the tally, and are these', () => {
  const { unmapped } = migrateTally(V1_TALLY);
  assert.deepEqual(unmapped.map((u) => u.drill + ' ' + u.answer).sort(), [
    'ear:cmp-3rds:up first',
    'ear:cmp-3rds:up same',
    'ear:degrees:135 3',
    'ear:direction:wide higher',
    'ear:functions:iv-v IV',
    'guess:chords:triads C E A',
  ]);
});

test('the migration leaves the tally as it was, and runs once', () => {
  const s = parseStats(V1);
  assert.deepEqual(s.tally, V1_TALLY);
  const again = parseStats(serialiseStats(s));
  assert.equal(again.migrated, undefined, 'a version 2 file is read, not migrated again');
  assert.deepEqual(again.items, s.items);
  assert.deepEqual(again.tally, V1_TALLY);
  /* A second migration over the same tally would double every count. */
  addItems(again, 'note', 'play', { C: { n: [1, 1] } });
  assert.deepEqual(parseStats(serialiseStats(again)).items.note.C.play, [5, 4]);
});

test('damaged input: a broken table entry is dropped, the rest kept', () => {
  const good = { note: { C: { read: [2, 1], hear: [0, 0], play: [0, 0], keys: { 0: [2, 1], 1: 'x' } } } };
  const text = JSON.stringify({
    version: 2, records: [], tally: {},
    items: {
      ...good,
      chord: { maj: { read: [1, 2] }, min: 'nonsense', m7: { hear: [3, 3] } },
      planets: { mars: { read: [1, 1] } },
    },
  });
  const s = parseStats(text);
  assert.deepEqual(s.items.note.C.keys, { 0: [2, 1] });
  assert.deepEqual(Object.keys(s.items.chord), ['m7'], 'right > asked and a string are dropped');
  assert.equal(s.items.planets, undefined);
  for (const junk of ['', 'null', '{', '{"version":2,"records":[],"items":7}']) {
    assert.deepEqual(parseStats(junk).items, {});
  }
  /* A version 1 file with a damaged tally still migrates what is whole. */
  const v1 = parseStats(JSON.stringify({ version: 1, records: [], tally: { 'guess:notes:key': { C: [1, 1], D: [1, 9] } } }));
  assert.deepEqual(Object.keys(v1.items.note), ['C']);
});

test('itemOfTally and isItem know each subject', () => {
  assert.deepEqual(itemOfTally('guess:notes:key', 'F#'), { subject: 'note', mode: 'play', item: 'F#', pc: 6 });
  assert.equal(itemOfTally('nonsense', 'x'), null);
  assert.equal(itemOfTally('zap:notes:key', 'C'), null);
  assert.equal(itemOfTally('ear:planets:up', 'm3'), null);
  assert.ok(isItem('prog', 'ii-V-I'));
  assert.ok(!isItem('prog', 'ii-V-X'));
  assert.ok(!isItem('nope', 'C'));
});

test('rows come weakest first, and history is per subject and mode', () => {
  const s = emptyStats();
  addItems(s, 'chord', 'hear', { maj: { n: [10, 9] }, min: { n: [10, 4] } });
  addItems(s, 'chord', 'read', { maj: { n: [2, 2] }, aug: { n: [1, 0] } });
  addItems(s, 'chord', 'nope', { maj: { n: [1, 1] } });
  addItems(s, 'planets', 'read', { maj: { n: [1, 1] } });
  assert.deepEqual(itemRows(s, 'chord').map((r) => r.item), ['aug', 'min', 'maj']);
  assert.deepEqual(itemHistory(s, 'chord', 'hear'), { maj: [10, 9], min: [10, 4] });
  assert.deepEqual(itemHistory(s, 'chord', 'play'), {});
  assert.deepEqual(itemRows(s, 'scale'), []);
});

test('every kind of quiz names its subject, mode and items', () => {
  const notes = createQuiz({ kind: NOTES, read: 'name' });
  assert.deepEqual([quizSubject(notes), quizMode(notes)], ['note', 'play']);
  assert.equal(itemOf(notes, notes.entry).item.length <= 2, true);
  const staff = createQuiz({ kind: CHORDS, chordSet: 'types', read: 'staff' });
  assert.deepEqual([staff.subject, staff.mode], ['chord', 'read']);
  assert.ok(itemOf(staff, staff.entry).item);
  const pick = createQuiz({ kind: NOTES, pick: true });
  assert.equal(pick.mode, 'read');
  const hear = createQuiz({ kind: CHORDS });
  assert.equal(hear.mode, 'hear');
  const ear = createQuiz({ kind: EAR, exercise: 'id-3rds', level: 'up' });
  assert.deepEqual([ear.subject, ear.mode], ['int', 'hear']);
  assert.deepEqual(Object.keys(itemOf(ear, ear.entry)).sort(), ['item', 'pc', 'way']);
  const cmp = createQuiz({ kind: EAR, exercise: 'cmp-3rds', level: 'up' });
  assert.ok(['m3', 'M3'].includes(itemOf(cmp, cmp.entry).item), 'a comparison files the bigger interval');
  const read = createQuiz({ kind: EAR, exercise: 'rd-sc-maj-min', level: 'up' });
  assert.deepEqual([read.subject, read.mode], ['scale', 'read']);
  const shape = createQuiz({ kind: EAR, exercise: 'contour', level: 'key' });
  assert.equal(shape.subject, null);
  assert.equal(itemOf(shape, shape.entry), null);
});

test('a round feeds the table; what you miss comes round more often', () => {
  const quiz = createQuiz({ kind: EAR, exercise: 'triads', level: 'block', roundSize: 4 });
  while (quiz.correct < 4) {
    const right = quiz.choices.findIndex((c) => c.key === quiz.entry.answer);
    /* Miss every major chord once. */
    if (quiz.entry.answer === 'maj' && !quiz.missed) {
      quiz.choiceIndex = (right + 1) % quiz.choices.length;
      pickChoice(quiz, 1);
    }
    quiz.choiceIndex = right;
    pickChoice(quiz, 2);
    if (quiz.correct < 4) nextPrompt(quiz);
  }
  const total = Object.values(quiz.items).reduce((n, r) => n + r.n[0], 0);
  assert.equal(total, 4);
  /* Weighting: one item always missed in the table is drawn far more. */
  const table = { chord: { maj: { read: [0, 0], hear: [20, 0], play: [0, 0], keys: {} } } };
  let maj = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const q = createQuiz({ kind: EAR, exercise: 'triads', level: 'block', itemTable: table, seed });
    if (q.entry.answer === 'maj') maj++;
  }
  assert.ok(maj > 140, `maj drawn ${maj} of 200 times`);
  /* The table is read per mode: the same misses filed under read do nothing here. */
  const elsewhere = { chord: { maj: { read: [20, 0], hear: [0, 0], play: [0, 0], keys: {} } } };
  let even = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const q = createQuiz({ kind: EAR, exercise: 'triads', level: 'block', itemTable: elsewhere, seed });
    if (q.entry.answer === 'maj') even++;
  }
  assert.ok(even > 60 && even < 140, `maj drawn ${even} of 200 times`);
});

test('the session files a round in the table and keeps the old file once', () => {
  const h = fakeHost();
  h.files.set('stats.json', V1);
  h.session.init();
  assert.equal(h.files.get('stats.v1.bak.json'), V1, 'the version 1 file is kept before anything is saved');
  openPath(h.session, ['Quiz', 'Keys', 'Name notes']);
  for (let i = 0; i < 60 && h.session.view === GUESS_VIEW; i++) {
    const q = h.session.quiz;
    h.session.answer(q.choices.findIndex((c) => c.pitches.join() === q.prompt.join()));
    h.run(500);
  }
  assert.notEqual(h.session.view, GUESS_VIEW, 'the round is over');
  const saved = JSON.parse(h.files.get('stats.json'));
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.tally['guess:notes:key'], V1_TALLY['guess:notes:key'], 'the old tally is kept');
  const read = Object.values(saved.items.note).reduce((n, r) => n + r.read[0], 0);
  assert.equal(read, 10 + 3 + 2, 'ten new reads on top of the migrated five');
  /* Started again: nothing is migrated twice, and the kept copy is not replaced. */
  h.files.set('stats.v1.bak.json', 'kept');
  const h2 = fakeHost();
  for (const [k, v] of h.files) h2.files.set(k, v);
  h2.session.init();
  assert.equal(h2.files.get('stats.v1.bak.json'), 'kept');
  assert.equal(h2.files.get('stats.json'), h.files.get('stats.json'), 'nothing was written over it');
});

test('a record keeps what the round was asked in, outside its id', () => {
  const s = emptyStats();
  const rec = { t: 1, d: 'staff:chords:types', n: 10, ms: 9000, w: 0, h: 0, x: { k: 9, r: 'chromatic' } };
  s.records.push(rec);
  const back = parseStats(serialiseStats(s));
  assert.deepEqual(back.records[0].x, { k: 9, r: 'chromatic' });
  const odd = parseStats(JSON.stringify({ version: 2, records: [{ ...rec, x: [1] }], items: {} }));
  assert.equal(odd.records[0].x, undefined);
});
