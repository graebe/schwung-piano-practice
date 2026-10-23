// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCALE_LIST, SCALE_LEVELS, MODES, MODE_LABELS, scaleById, scalesAtLevel, scalePool, lettersOf,
  matchScale, rotate,
} from '../src/scales.mjs';
import { CORRECT, WRONG, INCOMPLETE } from '../src/verdict.mjs';
import { COURSES } from '../src/ear_course.mjs';
import { spellLine } from '../src/read_course.mjs';
import { SETTINGS_DEF } from '../src/settings_def.mjs';
import { MIN_PITCH, MAX_PITCH } from '../src/notation.mjs';

test('the Scale setting keeps its keys, in the firmware order', () => {
  /* Stored settings name these ids: a key that moved would be dropped. */
  assert.deepEqual(Object.keys(MODES), [
    'major', 'minor', 'dorian', 'mixolydian', 'lydian', 'phrygian', 'locrian',
    'majorPent', 'minorPent', 'minorBlues', 'harmonicMinor', 'melodicMinor',
    'wholeTone', 'superLocrian', 'phrygianDominant', 'bhairav', 'hungarianMinor',
    'hirajoshi', 'inSen', 'iwato', 'kumoi', 'chromatic',
  ]);
  const row = SETTINGS_DEF.find((d) => d.key === 'mode');
  assert.deepEqual(row.values, Object.keys(MODES));
  assert.equal(MODE_LABELS.minorPent, 'Min Pentatonic');
});

test('one list: every id once, every scale an ascending set inside the octave', () => {
  const ids = SCALE_LIST.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of SCALE_LIST) {
    assert.equal(s.steps[0], 0, s.id);
    for (let i = 1; i < s.steps.length; i++) assert.ok(s.steps[i] > s.steps[i - 1] && s.steps[i] < 12, s.id);
    assert.ok(s.label.length <= 16, `${s.id} label "${s.label}" is wider than an answer`);
    assert.ok(s.short.length <= 14, `${s.id} short "${s.short}" is wider than a settings value`);
    if (s.id !== 'chromatic') assert.equal(lettersOf(s.id).length, s.steps.length, s.id);
  }
});

test('the course scales and the setting scales agree where they overlap', () => {
  assert.deepEqual(rotate([0, 2, 4, 5, 7, 9, 11], 1), MODES.dorian);
  assert.deepEqual(scaleById('altered').steps, MODES.superLocrian);
  /* Every answer of every scale unit is in the one list. */
  const course = COURSES.find((c) => c.key === 'scales');
  for (const unit of course.exercises) {
    for (const a of unit.answers) assert.ok(scaleById(a.key), a.key);
  }
});

test('the ladder is cumulative, complete, and every scale is on it once', () => {
  const all = [].concat(...SCALE_LEVELS);
  assert.equal(new Set(all).size, all.length, 'a scale on two levels');
  for (const id of all) assert.ok(scaleById(id), id);
  assert.deepEqual(scalesAtLevel(1), ['major', 'minor']);
  for (let n = 2; n <= SCALE_LEVELS.length; n++) {
    const below = scalesAtLevel(n - 1);
    const here = scalesAtLevel(n);
    assert.deepEqual(here.slice(0, below.length), below);
    assert.ok(here.length > below.length);
  }
  assert.equal(scalesAtLevel(99).length, all.length);
  /* Off the ladder: chromatic (no scale to name) and superLocrian (the same
   * steps as altered, which is on it). */
  const off = SCALE_LIST.map((s) => s.id).filter((id) => all.indexOf(id) < 0);
  assert.deepEqual(off.sort(), ['chromatic', 'superLocrian']);
});

test('the pool: root outer, scale inner, each line an octave in range', () => {
  const pool = scalePool({ ids: ['major', 'minor'], range: { lo: 60, hi: 74 } });
  assert.deepEqual(pool.map((e) => [e.root, e.id]),
    [[60, 'major'], [60, 'minor'], [61, 'major'], [61, 'minor'], [62, 'major'], [62, 'minor']]);
  for (const e of pool) {
    assert.equal(e.pitches[e.pitches.length - 1], e.root + 12);
    assert.ok(e.pitches.every((p) => p >= 60 && p <= 74));
  }
});

test('the pool with spelling leaves out a root it cannot write', () => {
  const range = { lo: MIN_PITCH, hi: MAX_PITCH };
  const plain = scalePool({ ids: ['alteredDim'], range });
  const spelled = scalePool({ ids: ['alteredDim'], range, spell: spellLine });
  assert.ok(spelled.length > 0 && spelled.length < plain.length);
  for (const e of spelled) {
    assert.deepEqual(e.notes.map((n) => n.pitch), e.pitches);
    const letters = e.notes.map((n) => n.diatonic - e.notes[0].diatonic);
    assert.deepEqual(letters, lettersOf('alteredDim').concat([7]));
  }
});

test('matchScale: exact, or the same notes in any octave, in order', () => {
  const line = [60, 62, 64, 65];
  assert.equal(matchScale([], line), INCOMPLETE);
  assert.equal(matchScale([60, 62], line), INCOMPLETE);
  assert.equal(matchScale([60, 62, 64, 65], line), CORRECT);
  assert.equal(matchScale([60, 64], line), WRONG);
  assert.equal(matchScale([72, 62], line), WRONG);
  assert.equal(matchScale([72, 50, 64, 77], line, 'any'), CORRECT);
  assert.equal(matchScale([72, 51], line, 'any'), WRONG);
  assert.equal(matchScale([60, 62, 64, 65, 67], line), WRONG, 'past the end');
});
