// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
import test from 'node:test';
import assert from 'node:assert/strict';

import { COURSES, SCALES, SAMPLE, rotate, courseOf } from '../src/ear_course.mjs';
import {
  exerciseByKey, exerciseNumber, answersFor, buildEarPool, levelRange, earRange, promptLength, INTERVALS,
} from '../src/ear.mjs';
import { spellAbove, rootName } from '../src/ear_core.mjs';
import { drillId, drillLabel } from '../src/stats.mjs';
import { quizFromId } from '../src/program.mjs';
import { MODES } from '../src/generator.mjs';
import { inStaffRange } from '../src/notation.mjs';
import { padsForPitch, DEFAULT_TRANSPOSE } from '../src/padmap.mjs';

const course = (key) => COURSES.find((c) => c.key === key);
const units = (key) => course(key).exercises;
const every = () => COURSES.flatMap((c) => c.exercises.flatMap((ex) => ex.levels.map((lv) => ({ c, ex, lv }))));
const firstAnchor = (e) => e.events.slice().sort((a, b) => a.at - b.at)[0].pitch;

/* ---- The lists ------------------------------------------------------------- */

test('three courses, numbered as the screenshots run them, no exams', () => {
  assert.deepEqual(COURSES.map((c) => [c.key, c.exercises.length]), [['intervals', 18], ['compare', 17], ['scales', 10]]);
  for (const { ex } of every()) assert.doesNotMatch(ex.name, /exam/i);
});

test('every key is unique across the hearing exercises and the courses, and resolves', () => {
  const keys = COURSES.flatMap((c) => c.exercises.map((e) => e.key));
  assert.equal(new Set(keys).size, keys.length);
  for (const k of keys) {
    const ex = exerciseByKey(k);
    assert.ok(ex && courseOf(ex), k);
  }
  assert.equal(exerciseNumber(units('compare')[8]), 9, 'numbered within its course');
});

test('names fit a list row with their number; labels fit the progress screen', () => {
  for (const { ex, lv } of every()) {
    const row = exerciseNumber(ex) + ' ' + ex.name;
    assert.ok(row.length <= 21, `"${row}" is ${row.length}`);
    const label = drillLabel(drillId({ kind: 'ear', exercise: ex.key, level: lv.key }));
    assert.ok(label.length <= 21, `"${label}" is ${label.length}`);
    assert.ok(!label.includes(':'), label);
    for (const a of answersFor(ex, lv)) assert.ok(a.label.length <= 16, a.label);
  }
});

test('every level round-trips through its id', () => {
  for (const { ex, lv } of every()) {
    const id = 'quiz:' + drillId({ kind: 'ear', exercise: ex.key, level: lv.key });
    const back = quizFromId(id);
    assert.ok(back, id);
    assert.equal(back.exercise, ex.key);
    assert.equal(back.level, lv.key);
  }
});

/* ---- Pools ----------------------------------------------------------------- */

test('every level asks every one of its answers, at every Octave setting', () => {
  for (const transpose of [DEFAULT_TRANSPOSE - 24, DEFAULT_TRANSPOSE - 12, DEFAULT_TRANSPOSE, DEFAULT_TRANSPOSE + 12]) {
    for (const { ex, lv } of every()) {
      const p = buildEarPool(ex, lv.key, transpose);
      const keys = answersFor(ex, lv).map((a) => a.key);
      for (const a of keys) assert.ok(p.some((e) => e.answer === a), `${ex.key}/${lv.key}@${transpose} never asks ${a}`);
      for (const e of p) {
        assert.ok(keys.includes(e.answer), `${ex.key}: ${e.answer}`);
        assert.ok(e.label.length <= 21, `${ex.key}: "${e.label}"`);
        for (const pitch of e.pitches) assert.ok(inStaffRange(pitch), `${ex.key}: ${pitch} off the staff`);
      }
    }
  }
});

test('on the pads when it fits there, over the staff when it does not', () => {
  const thirds = exerciseByKey('id-3rds');
  for (const e of buildEarPool(thirds, 'up')) {
    for (const p of e.pitches) assert.ok(padsForPitch(p, DEFAULT_TRANSPOSE).length, `${p} has no pad`);
  }
  const twoOct = exerciseByKey('id-13-15').levels[0];
  assert.deepEqual(levelRange(thirds.levels[0]), earRange(DEFAULT_TRANSPOSE));
  assert.ok(levelRange(twoOct).hi - levelRange(twoOct).lo >= 24 + 2, 'two octaves get the staff');
});

test('prompts last seconds, not minutes', () => {
  for (const { ex, lv } of every()) {
    for (const e of buildEarPool(ex, lv.key).slice(0, 40)) {
      const len = promptLength(e.events);
      assert.ok(len > 0 && len < 6000, `${ex.key}/${lv.key}: ${len}ms`);
    }
  }
});

/* ---- Identify intervals -------------------------------------------------- */

test('compound intervals are spelled by letter: C-D a 9th, C-Gb a d12, C-C two octaves', () => {
  const name = (key) => {
    const iv = INTERVALS.find((i) => i.key === key);
    return rootName(60).label + '-' + spellAbove(60, iv.semis, iv.steps);
  };
  assert.equal(name('M9'), 'C-D');
  assert.equal(name('m10'), 'C-Eb');
  assert.equal(name('P11'), 'C-F');
  assert.equal(name('d12'), 'C-Gb');
  assert.equal(name('P12'), 'C-G');
  assert.equal(name('m13'), 'C-Ab');
  assert.equal(name('M14'), 'C-B');
  assert.equal(name('P15'), 'C-C');
});

test('every interval prompt spans the semitones its answer names, the way its level says', () => {
  for (const ex of units('intervals')) {
    for (const lv of ex.levels) {
      for (const e of buildEarPool(ex, lv.key)) {
        const iv = INTERVALS.find((i) => i.key === e.answer);
        assert.equal(Math.max(...e.pitches) - Math.min(...e.pitches), iv.semis, `${ex.key}/${lv.key}`);
        const [a, b] = e.events;
        if (lv.key === 'up') assert.ok(b.pitch > a.pitch && b.at > a.at);
        if (lv.key === 'down') assert.ok(b.pitch < a.pitch && b.at > a.at);
        if (lv.key === 'together') assert.equal(a.at, b.at);
      }
    }
  }
});

/* ---- Compare intervals --------------------------------------------------- */

/* The two intervals of a prompt, from its four events: [first, second]. */
function halves(e) {
  const ev = e.events.slice().sort((a, b) => a.at - b.at || a.pitch - b.pitch);
  return [ev.slice(0, 2), ev.slice(2)];
}
const size = (pair) => Math.abs(pair[1].pitch - pair[0].pitch);

test('first, same and second mean what they say', () => {
  for (const ex of units('compare')) {
    for (const lv of ex.levels) {
      for (const e of buildEarPool(ex, lv.key)) {
        const [a, b] = halves(e).map(size);
        const want = a > b ? 'first' : a < b ? 'second' : 'same';
        assert.equal(e.answer, want, `${ex.key}/${lv.key}: ${a} vs ${b}`);
        assert.ok(ex.set.some((k) => INTERVALS.find((i) => i.key === k).semis === a));
      }
    }
  }
});

test('a fixed root starts both on one note; a random root three to six apart', () => {
  for (const ex of units('compare')) {
    for (const lv of ex.levels) {
      for (const e of buildEarPool(ex, lv.key)) {
        const [x, y] = halves(e);
        const d = Math.abs(firstAnchor({ events: x }) - firstAnchor({ events: y }));
        if (lv.fixed) assert.equal(d, 0, `${ex.key}/${lv.key}`);
        else assert.ok(d >= 3 && d <= 6, `${ex.key}/${lv.key}: ${d}`);
      }
    }
  }
});

test('a sampled pool is balanced, and the same every time it is built', () => {
  const ex = exerciseByKey('cmp-6ths');
  const a = buildEarPool(ex, 'fix-up');
  const b = buildEarPool(ex, 'fix-up');
  assert.deepEqual(a.map((e) => e.label + e.events[2].pitch), b.map((e) => e.label + e.events[2].pitch));
  for (const k of ['first', 'same', 'second']) assert.equal(a.filter((e) => e.answer === k).length, SAMPLE, k);
});

test('fixed-root levels come first, as the course runs them, where a unit has both', () => {
  const sixths = exerciseByKey('cmp-6ths');
  assert.deepEqual(sixths.levels.map((l) => l.key), ['fix-up', 'fix-down', 'fix-together', 'up', 'down', 'together']);
  assert.ok(units('compare').slice(0, 8).every((u) => u.levels.every((l) => !l.fixed)), 'the first half is random only');
});

/* ---- Identify scales ----------------------------------------------------- */

test('modes come from rotating their parent', () => {
  assert.deepEqual(rotate([0, 2, 4, 5, 7, 9, 11], 1), MODES.dorian);
  assert.deepEqual(SCALES.locrian.steps, MODES.locrian);
  assert.deepEqual(SCALES.phrygianDominant.steps, [0, 1, 4, 5, 7, 8, 10]);
  assert.deepEqual(SCALES.phrygianDominant.steps, MODES.phrygianDominant);
  assert.deepEqual(SCALES.dorianFlat2.steps, [0, 1, 3, 5, 7, 9, 10]);
  assert.deepEqual(SCALES.lydianDominant.steps, [0, 2, 4, 6, 7, 9, 10]);
  assert.deepEqual(SCALES.altered.steps, MODES.superLocrian);
});

test('no two answers of a unit are the same scale', () => {
  for (const ex of units('scales')) {
    const shapes = ex.answers.map((a) => SCALES[a.key].steps.join());
    assert.equal(new Set(shapes).size, shapes.length, ex.key);
  }
});

test('a scale runs from its root through the octave, up or down', () => {
  for (const ex of units('scales')) {
    for (const lv of ex.levels) {
      for (const e of buildEarPool(ex, lv.key).slice(0, 30)) {
        const line = e.events.map((x) => x.pitch);
        const root = lv.key === 'up' ? line[0] : line.at(-1);
        assert.equal(Math.abs(line.at(-1) - line[0]), 12);
        assert.deepEqual(line.slice(lv.key === 'up' ? 0 : 1, lv.key === 'up' ? -1 : undefined)
          .map((p) => p - root).sort((a, b) => a - b), SCALES[e.answer].steps);
      }
    }
  }
});
