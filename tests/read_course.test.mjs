// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
import test from 'node:test';
import assert from 'node:assert/strict';

import { READ_COURSES, spellLine, noteAt, noteLabel } from '../src/read_course.mjs';
import { COURSES } from '../src/ear_course.mjs';
import { scaleById } from '../src/scales.mjs';
import { exerciseByKey, exerciseNumber, answersFor, buildEarPool, INTERVALS } from '../src/ear.mjs';
import { drillId, drillLabel } from '../src/stats.mjs';
import { quizFromId } from '../src/program.mjs';
import { MIN_PITCH, MAX_PITCH } from '../src/notation.mjs';
import { fakeHost, openPath } from './support/fake_host.mjs';
import { GUESS_VIEW } from '../src/session.mjs';
import { createScreen, countOn } from '../tools/screen_buffer.mjs';
import * as V from '../src/view.mjs';
import * as L from '../src/layout.mjs';

const every = () => READ_COURSES.flatMap((c) => c.exercises.flatMap((ex) => ex.levels.map((lv) => ({ c, ex, lv }))));
const pc = (n) => ((n % 12) + 12) % 12;
const letterOf = (n) => ((n.diatonic % 7) + 7) % 7;

test('each listening course has its reading twin, unit for unit and level for level', () => {
  assert.deepEqual(READ_COURSES.map((c) => c.key), ['read-intervals', 'read-compare', 'read-scales']);
  COURSES.forEach((c, i) => {
    const twin = READ_COURSES[i];
    assert.equal(twin.exercises.length, c.exercises.length);
    twin.exercises.forEach((ex, u) => {
      assert.equal(ex.key, 'rd-' + c.exercises[u].key);
      assert.deepEqual(ex.levels.map((l) => l.key), c.exercises[u].levels.map((l) => l.key));
      assert.deepEqual(ex.answers, c.exercises[u].answers);
      assert.ok(ex.read && exerciseByKey(ex.key) === ex);
    });
  });
});

test('names and labels fit, and every level round-trips through its id', () => {
  for (const { ex, lv } of every()) {
    assert.ok((exerciseNumber(ex) + ' ' + ex.name).length <= 21, ex.name);
    const id = drillId({ kind: 'ear', exercise: ex.key, level: lv.key });
    const label = drillLabel(id);
    assert.ok(label.length <= 21 && label.startsWith('Rd'), label);
    const back = quizFromId('quiz:' + id);
    assert.equal(back.exercise, ex.key);
    assert.equal(back.level, lv.key);
  }
});

test('every level asks every answer, on the staff, one sharp or flat at most', () => {
  for (const { ex, lv } of every()) {
    const p = buildEarPool(ex, lv.key);
    for (const a of answersFor(ex, lv)) assert.ok(p.some((e) => e.answer === a.key), `${ex.key}/${lv.key} never asks ${a.key}`);
    for (const e of p.slice(0, 200)) {
      assert.ok(e.label.length <= 21, e.label);
      for (const col of e.staff) {
        for (const n of col.notes) {
          assert.ok(n.pitch >= MIN_PITCH && n.pitch <= MAX_PITCH, `${ex.key}: ${n.pitch}`);
          assert.ok(Math.abs(n.alter) <= 1, `${ex.key}: ${e.label}`);
          assert.deepEqual(noteAt(n.pitch, n.diatonic), n, 'the letter and the pitch agree');
        }
      }
    }
  }
});

test('an interval is written by its letters: a 3rd spans three, a 12th twelve', () => {
  for (const ex of READ_COURSES[0].exercises) {
    for (const lv of ex.levels) {
      for (const e of buildEarPool(ex, lv.key)) {
        const notes = e.staff.flatMap((c) => c.notes).sort((a, b) => a.pitch - b.pitch);
        const iv = INTERVALS.find((i) => i.key === e.answer);
        assert.equal(notes[1].pitch - notes[0].pitch, iv.semis);
        assert.equal(notes[1].diatonic - notes[0].diatonic, iv.steps - 1, e.label);
        if (lv.key === 'together') assert.equal(e.staff.length, 1);
        else assert.equal(e.staff.length, 2);
      }
    }
  }
});

test('C to Eb is a minor 3rd, never C to D#; Bb before A# on a tie; a white key is its own letter', () => {
  const m3 = spellLine(60, [0, 3], [0, 2]);
  assert.deepEqual(m3.map(noteLabel), ['C', 'Eb']);
  assert.deepEqual(spellLine(70, [0, 5], [0, 3]).map(noteLabel), ['Bb', 'Eb']);
  const bSharpRoot = spellLine(60, [0, 4], [0, 2]);
  assert.equal(noteLabel(bSharpRoot[0]), 'C');
  assert.equal(spellLine(60, [0, 9], [0, 5]).map(noteLabel)[1], 'A');
  /* C altered bb7 needs Bbb: not asked on C. */
  assert.equal(spellLine(60, scaleById('alteredDim').steps.concat([12]), [0, 1, 2, 3, 4, 5, 6, 7]), null);
});

test('a scale is written one letter a degree, and the odd ones as players write them', () => {
  const ex = exerciseByKey('rd-sc-modes');
  for (const e of buildEarPool(ex, 'up')) {
    const notes = e.staff.map((c) => c.notes[0]);
    assert.deepEqual(notes.map(letterOf), [0, 1, 2, 3, 4, 5, 6, 7].map((d) => (letterOf(notes[0]) + d) % 7));
    assert.deepEqual(notes.map((n) => pc(n.pitch - notes[0].pitch)).slice(0, 7), scaleById(e.answer).steps);
  }
  const dim = buildEarPool(exerciseByKey('rd-sc-dim'), 'up').find((e) => e.label === 'C Whole-half dim');
  assert.deepEqual(dim.staff.map((c) => noteLabel(c.notes[0])), ['C', 'D', 'Eb', 'F', 'Gb', 'Ab', 'A', 'B', 'C']);
});

test('a comparison is two parts, a fixed root written as one note', () => {
  for (const lv of exerciseByKey('rd-cmp-6ths').levels) {
    for (const e of buildEarPool(exerciseByKey('rd-cmp-6ths'), lv.key)) {
      const parts = [0, 1].map((p) => e.staff.filter((c) => c.part === p));
      assert.ok(parts[0].length && parts[1].length);
      if (lv.fixed) {
        const first = (cols) => (lv.key === 'fix-down' ? cols[0].notes[0] : cols[0].notes.slice().sort((a, b) => a.diatonic - b.diatonic)[0]);
        assert.deepEqual(first(parts[0]), first(parts[1]), lv.key);
      }
    }
  }
});

/* ---- On the Move -------------------------------------------------------------- */

test('a reading quiz plays nothing until asked; PLAY is help and counted', () => {
  const h = fakeHost();
  h.session.init();
  h.session.openItem('quiz:ear:rd-id-2nds:up');
  assert.equal(h.session.view, GUESS_VIEW);
  h.run(1500);
  assert.equal(h.log.filter((e) => e[0] === 'strike').length, 0, 'silent: the staff is the question');
  h.session.playButton();
  assert.equal(h.session.quiz.hint, 1, 'hearing it is a hint');
  h.run(1500);
  assert.ok(h.log.some((e) => e[0] === 'strike'));
});

test('a right answer sounds what was read, and counts', () => {
  const h = fakeHost();
  h.session.init();
  h.session.openItem('quiz:ear:rd-sc-maj-min:up');
  const q = h.session.quiz;
  const right = q.choices.findIndex((c) => c.key === q.entry.answer);
  const before = h.log.length;
  h.session.answer(right);
  h.run(400);
  assert.equal(q.correct, 1);
  assert.ok(h.log.slice(before).some((e) => e[0] === 'strike'));
});

test('the Move draws the prompt on the staff and its answers in the strip over their pads', () => {
  const ex = exerciseByKey('rd-cmp-6ths');
  const e = buildEarPool(ex, 'fix-up')[0];
  const c = createScreen();
  V.drawReadPick(c, {
    title: 'READ 6THS', staff: e.staff, options: ['First bigger', 'Second bigger'], short: ['1', '2'], index: 0,
  });
  const xs = V.readColumnsX(e.staff);
  assert.equal(xs.length, 4);
  assert.ok(xs.every((x) => x > L.STAFF_LEFT_X + 6 && x < L.SCREEN_W - 2), xs.join());
  /* Two answers: pads 3 and 6 of the bottom row (answer_pads), so cells in
   * columns 2 and 5, the jog's one filled; the other columns dotted. */
  const cell = (col) => countOn(c, col * V.CELL_W + 1, V.STRIP_Y, V.CELL_W - 1, V.CELL_H);
  assert.ok(cell(2) > 80, 'the jog\'s answer, filled');
  assert.ok(cell(5) > 40 && cell(5) < 80, 'the other, outlined');
  assert.ok(cell(0) < 30, 'no answer: dotted');
  const scale = buildEarPool(exerciseByKey('rd-sc-dim'), 'down')[0];
  const sx = V.readColumnsX(scale.staff);
  for (let i = 1; i < sx.length; i++) assert.ok(sx[i] - sx[i - 1] >= 11, 'room for an accidental between notes');
});
