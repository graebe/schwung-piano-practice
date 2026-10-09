// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXERCISES, INTERVALS, exerciseByKey, exerciseNumber, levelByKey, isNaming, answersFor,
  buildEarPool, groupByAnswer, pickEntry, slowed, promptLength, earRange,
} from '../src/ear.mjs';
import { rng } from '../src/generator.mjs';
import { inStaffRange } from '../src/notation.mjs';
import { padsForPitch, DEFAULT_TRANSPOSE } from '../src/padmap.mjs';

const naming = EXERCISES.filter(isNaming);
const pool = (key, level) => buildEarPool(exerciseByKey(key), level);
const find = (key, level, label) => pool(key, level).find((e) => e.label === label);

/* ---- The list --------------------------------------------------------------- */

test('the requested drills are in, thirds before chords, both early', () => {
  const thirds = exerciseNumber(exerciseByKey('thirds'));
  const triads = exerciseNumber(exerciseByKey('triads'));
  assert.ok(thirds > 0 && triads > 0);
  assert.ok(thirds < triads);
  assert.ok(triads <= 6);
});

test('keys are unique, and so are the level keys within an exercise', () => {
  const keys = EXERCISES.map((e) => e.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const ex of EXERCISES) {
    const lv = ex.levels.map((l) => l.key);
    assert.equal(new Set(lv).size, lv.length, ex.key);
  }
});

test('names fit a list row with their number, labels fit the progress screen', () => {
  for (const ex of EXERCISES) {
    const row = exerciseNumber(ex) + ' ' + ex.name;
    assert.ok(row.length <= 21, `"${row}" is ${row.length} characters`);
    for (const lv of ex.levels) {
      const label = ex.short + ' ' + lv.name;
      assert.ok(label.length <= 21, `"${label}" is ${label.length} characters`);
    }
  }
});

test('play-back exercises point at the existing hear drills', () => {
  const playback = EXERCISES.filter((e) => !isNaming(e));
  assert.equal(playback.length, 2);
  for (const ex of playback) {
    for (const lv of ex.levels) {
      assert.equal(lv.quiz.hear, true);
      assert.ok(lv.quiz.kind === 'notes' || lv.quiz.kind === 'chords');
    }
    assert.deepEqual(buildEarPool(ex, ex.levels[0].key), []);
  }
});

test('an unknown level falls back to the first, an unknown exercise to null', () => {
  const ex = exerciseByKey('thirds');
  assert.equal(levelByKey(ex, 'nope'), ex.levels[0]);
  assert.equal(exerciseByKey('nope'), null);
  assert.equal(levelByKey(null, 'up'), null);
});

/* ---- What every level can ask ------------------------------------------------ */

test('every level of every naming exercise has every answer, playable and drawable', () => {
  for (const ex of naming) {
    for (const lv of ex.levels) {
      const answers = answersFor(ex, lv);
      assert.ok(answers.length >= 2, `${ex.key}/${lv.key} needs a choice`);
      const p = buildEarPool(ex, lv.key);
      const keys = answers.map((a) => a.key);
      for (const a of keys) {
        assert.ok(p.some((e) => e.answer === a), `${ex.key}/${lv.key} never asks ${a}`);
      }
      for (const e of p) {
        assert.ok(keys.includes(e.answer), `${ex.key}/${lv.key}: ${e.answer} is not an answer`);
        assert.ok(e.label && e.label.length <= 21, `${ex.key}: label "${e.label}"`);
        for (const pitch of e.pitches) {
          assert.ok(inStaffRange(pitch), `${ex.key}: ${pitch} off the staff`);
          assert.ok(padsForPitch(pitch, DEFAULT_TRANSPOSE).length, `${ex.key}: ${pitch} has no pad`);
        }
      }
    }
  }
});

/* Centred, with the highlight's 5px either side, a 6px-per-character label
 * must end before the scroll mark at x=121: 16 characters at most. */
test('answer labels fit the answer list beside its scroll marks', () => {
  for (const ex of naming) {
    for (const lv of ex.levels) {
      for (const a of answersFor(ex, lv)) assert.ok(a.label.length <= 16, a.label);
    }
  }
});

test('the range follows the transpose and stays on the staff', () => {
  const r = earRange(DEFAULT_TRANSPOSE);
  assert.ok(r.lo < r.hi);
  assert.ok(inStaffRange(r.lo) && inStaffRange(r.hi));
  const up = earRange(DEFAULT_TRANSPOSE + 12);
  assert.ok(inStaffRange(up.hi));
  for (const e of buildEarPool(exerciseByKey('thirds'), 'up', DEFAULT_TRANSPOSE + 12)) {
    assert.ok(e.pitches.every((p) => p >= up.lo && p <= up.hi));
  }
});

/* ---- Right answers ------------------------------------------------------------ */

test('C-E is a major third and C-Eb a minor one, spelled by letter', () => {
  const m = find('thirds', 'up', 'C-E M3');
  assert.equal(m.answer, 'M3');
  assert.deepEqual(m.pitches, [60, 64]);
  const n = find('thirds', 'up', 'C-Eb m3');
  assert.equal(n.answer, 'm3');
  assert.deepEqual(n.pitches, [60, 63]);
  /* A sharp root keeps its sharps going up: never a letter skipped. */
  assert.ok(pool('thirds', 'up').some((e) => e.label === 'A-C# M3'));
});

test('every interval prompt spans the semitones its answer names', () => {
  for (const key of ['intervals-up', 'intervals-down', 'intervals-together']) {
    for (const e of pool(key, 'g3')) {
      const span = Math.max(...e.pitches) - Math.min(...e.pitches);
      assert.equal(span, INTERVALS.find((i) => i.key === e.answer).semis);
    }
  }
});

test('ascending rises, descending falls, together starts at once', () => {
  for (const e of pool('thirds', 'up')) assert.ok(e.events[1].pitch > e.events[0].pitch && e.events[1].at > e.events[0].at);
  for (const e of pool('thirds', 'down')) assert.ok(e.events[1].pitch < e.events[0].pitch && e.events[1].at > e.events[0].at);
  for (const e of pool('thirds', 'together')) assert.equal(e.events[0].at, e.events[1].at);
});

test('C-E-G is major and A-C-E minor, in every voicing', () => {
  const pcs = (e) => [...new Set(e.pitches.map((p) => p % 12))].sort((a, b) => a - b).join(',');
  for (const level of ['broken', 'block', 'inversions']) {
    for (const e of pool('triads', level)) {
      if (e.label === 'C') assert.equal(pcs(e), '0,4,7');
      if (e.label === 'Am') assert.equal(pcs(e), '0,4,9');
      assert.equal(e.answer, e.label.endsWith('m') ? 'min' : 'maj');
    }
  }
  /* Inverted: some C major prompts start on E or G. */
  const lows = pool('triads', 'inversions').filter((e) => e.label === 'C').map((e) => Math.min(...e.pitches) % 12);
  assert.ok(lows.includes(4) && lows.includes(7));
});

test('broken chords climb one note at a time, then sound together', () => {
  for (const e of pool('triads', 'broken')) {
    const ats = e.events.map((x) => x.at);
    assert.ok(ats[0] < ats[1] && ats[1] < ats[2]);
    const block = e.events.slice(3);
    assert.equal(block.length, 3);
    assert.ok(block.every((x) => x.at === block[0].at));
  }
});

test('higher, same and lower mean what they say', () => {
  for (const level of ['wide', 'narrow']) {
    for (const e of pool('direction', level)) {
      const [a, b] = e.events.map((x) => x.pitch);
      assert.equal(e.answer, b > a ? 'higher' : b < a ? 'lower' : 'same');
      if (e.answer !== 'same') {
        const gap = Math.abs(b - a);
        assert.ok(level === 'wide' ? gap >= 5 : gap <= 4);
      }
    }
  }
});

test('a step is the next scale note, a leap anything wider', () => {
  for (const e of pool('steps', 'key')) {
    const gap = Math.abs(e.events[1].pitch - e.events[0].pitch);
    if (e.answer === 'step') assert.ok(gap === 1 || gap === 2);
    else assert.ok(gap >= 3);
  }
});

test('a melody shape follows its two moves', () => {
  for (const e of pool('contour', 'key')) {
    const [a, b, c] = e.events.map((x) => x.pitch);
    assert.equal(e.answer, (b > a ? 'u' : 'd') + (c > b ? 'u' : 'd'));
  }
});

test('major and minor keys differ in the third', () => {
  for (const level of ['scale', 'melody']) {
    for (const e of pool('key-quality', level)) {
      /* Every line stays at or above its tonic. */
      const tonic = Math.min(...e.pitches);
      const third = e.events.map((x) => x.pitch - tonic).find((s) => s === 3 || s === 4);
      assert.equal(third, e.answer === 'major' ? 4 : 3, e.label);
    }
  }
});

test('home ends on the tonic, away anywhere else, after the tonic chord', () => {
  for (const e of pool('home', 'major')) {
    const tonic = Math.min(...e.events.filter((x) => x.at === 0).map((x) => x.pitch));
    const last = e.events[e.events.length - 1].pitch;
    assert.equal((last - tonic) % 12 === 0, e.answer === 'home', e.label);
  }
});

test('a degree is the target note above the cadence tonic', () => {
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];
  for (const level of ['135', 'all']) {
    for (const e of pool('degrees', level)) {
      const tonic = e.events[0].pitch;
      const target = e.events[e.events.length - 1];
      assert.ok(target.at > e.events[e.events.length - 2].at, 'the note comes after the cadence');
      assert.equal(target.pitch - tonic, MAJOR[Number(e.answer) - 1]);
    }
  }
});

test('chords in a key: the second chord is the function named', () => {
  const ROOT = { IV: 5, V: 7, vi: 9 };
  for (const e of pool('functions', 'iv-v-vi')) {
    const tonic = Math.min(...e.events.filter((x) => x.at === 0).map((x) => x.pitch));
    const second = e.events.filter((x) => x.at > 0).map((x) => x.pitch);
    assert.equal(Math.min(...second) - tonic, ROOT[e.answer]);
  }
});

test('sevenths are four notes of the quality named', () => {
  const SHAPE = { maj7: '0,4,7,11', 7: '0,4,7,10', m7: '0,3,7,10', m7b5: '0,3,6,10' };
  for (const e of pool('sevenths', 'four')) {
    const root = Math.min(...e.pitches);
    assert.equal(e.pitches.map((p) => p - root).join(','), SHAPE[e.answer]);
  }
});

/* ---- Choosing and replaying --------------------------------------------------- */

test('answers come up evenly, however unevenly the pool is split', () => {
  const ex = exerciseByKey('steps');
  const p = buildEarPool(ex, 'key');
  const leaps = p.filter((e) => e.answer === 'leap').length;
  assert.ok(leaps > p.length / 2, 'the pool itself is lopsided');
  const groups = groupByAnswer(p, answersFor(ex, ex.levels[0]));
  const rand = rng(11);
  let step = 0;
  let prev = null;
  for (let i = 0; i < 2000; i++) {
    prev = pickEntry(groups, rand, prev);
    if (prev.answer === 'step') step++;
  }
  assert.ok(step > 850 && step < 1150, `step came up ${step} times in 2000`);
});

test('the same prompt never comes twice running', () => {
  const ex = exerciseByKey('thirds');
  const groups = groupByAnswer(buildEarPool(ex, 'up'), ex.answers);
  const rand = rng(5);
  let prev = null;
  for (let i = 0; i < 500; i++) {
    const next = pickEntry(groups, rand, prev);
    assert.notEqual(next, prev);
    prev = next;
  }
  assert.equal(pickEntry([], rand), null);
});

test('slowed breaks chords up and stretches the line', () => {
  const block = [{ pitch: 64, at: 0, dur: 1000 }, { pitch: 60, at: 0, dur: 1000 }];
  const s = slowed(block);
  assert.deepEqual(s.slice(0, 2).map((e) => e.pitch), [60, 64], 'low to high first');
  assert.ok(s[1].at > s[0].at);
  const whole = s.slice(2);
  assert.equal(whole.length, 2);
  assert.equal(whole[0].at, whole[1].at);

  const line = [{ pitch: 60, at: 0, dur: 600 }, { pitch: 64, at: 700, dur: 600 }];
  const sl = slowed(line);
  assert.equal(sl.length, 2);
  assert.ok(sl[1].at > 700);
  assert.ok(promptLength(sl) > promptLength(line));
});

test('every prompt fits in seconds, not minutes', () => {
  for (const ex of naming) {
    for (const lv of ex.levels) {
      for (const e of buildEarPool(ex, lv.key).slice(0, 50)) {
        const len = promptLength(e.events);
        assert.ok(len > 0 && len < 6000, `${ex.key}/${lv.key} lasts ${len}ms`);
      }
    }
  }
});
