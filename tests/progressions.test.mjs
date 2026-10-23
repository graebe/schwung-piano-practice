// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROGRESSIONS, PROGRESSION_LEVELS, LESSON_PROGRESSIONS, parseNumeral, parseNumerals,
  progressionById, progressionsAtLevel, progressionKey, progressionChords, progressionLesson,
  nextOnCircle, numeralsLabel, matchProgression,
} from '../src/progressions.mjs';
import { CORRECT, WRONG, INCOMPLETE } from '../src/verdict.mjs';
import { qualityById, buildChord } from '../src/chords.mjs';
import { spell, LETTERS } from '../src/notation.mjs';
import { validateExercise } from '../src/exercise_io.mjs';

test('numerals: case, accidentals, suffixes and secondaries', () => {
  assert.deepEqual(parseNumeral('I'), [0, 'maj']);
  assert.deepEqual(parseNumeral('vi'), [9, 'min']);
  assert.deepEqual(parseNumeral('ii7'), [2, 'm7']);
  assert.deepEqual(parseNumeral('V7'), [7, '7']);
  assert.deepEqual(parseNumeral('Imaj7'), [0, 'maj7']);
  assert.deepEqual(parseNumeral('ii7b5'), [2, 'm7b5']);
  assert.deepEqual(parseNumeral('viio'), [11, 'dim']);
  assert.deepEqual(parseNumeral('bVII'), [10, 'maj']);
  assert.deepEqual(parseNumeral('bII7'), [1, '7']);
  assert.deepEqual(parseNumeral('V/V'), [2, 'maj']);
  assert.deepEqual(parseNumeral('V7/ii'), [9, '7']);
  /* In minor the degrees are the minor key's: VI is Ab in C minor. */
  assert.deepEqual(parseNumeral('VI', 'minor'), [8, 'maj']);
  assert.deepEqual(parseNumeral('bII', 'minor'), [1, 'maj']);
  assert.deepEqual(parseNumeral('V', 'minor'), [7, 'maj']);
  assert.throws(() => parseNumeral('X'));
  assert.throws(() => parseNumeral('Iqq'));
  assert.deepEqual(parseNumerals(' ii7  V7 Imaj7 '), [[2, 'm7'], [7, '7'], [0, 'maj7']]);
});

test('the eleven charts keep their ids, order and chords', () => {
  /* What chord_lessons.mjs listed before the numerals: the Learn charts and
   * every Learning Path step built on them depend on these. */
  const OLD = {
    'I-IV-V-I': [[0, 'maj'], [5, 'maj'], [7, 'maj'], [0, 'maj']],
    'I-V-vi-IV': [[0, 'maj'], [7, 'maj'], [9, 'min'], [5, 'maj']],
    'vi-IV-I-V': [[9, 'min'], [5, 'maj'], [0, 'maj'], [7, 'maj']],
    'I-vi-IV-V': [[0, 'maj'], [9, 'min'], [5, 'maj'], [7, 'maj']],
    'ii-V-I': [[2, 'm7'], [7, '7'], [0, 'maj7'], [0, 'maj7']],
    'vi-ii-V-I': [[9, 'm7'], [2, 'm7'], [7, '7'], [0, 'maj7']],
    'i-iv-V-i': [[0, 'min'], [5, 'min'], [7, 'maj'], [0, 'min']],
    'i-iv-v-i modal': [[0, 'min'], [5, 'min'], [7, 'min'], [0, 'min']],
    'i-VI-III-VII': [[0, 'min'], [8, 'maj'], [3, 'maj'], [10, 'maj']],
    'ii-V-i minor': [[2, 'm7b5'], [7, '7b9'], [0, 'm7'], [0, 'm7']],
    '12-bar blues': [[0, '7'], [0, '7'], [0, '7'], [0, '7'], [5, '7'], [5, '7'],
      [0, '7'], [0, '7'], [7, '7'], [5, '7'], [0, '7'], [7, '7']],
  };
  assert.deepEqual(LESSON_PROGRESSIONS.map((p) => p.id), Object.keys(OLD));
  for (const p of LESSON_PROGRESSIONS) assert.deepEqual(p.steps, OLD[p.id], p.id);
  const minor = LESSON_PROGRESSIONS.filter((p) => p.mode === 'minor').map((p) => p.id);
  assert.deepEqual(minor, ['i-iv-V-i', 'i-iv-v-i modal', 'i-VI-III-VII', 'ii-V-i minor']);
});

test('the ladder: cumulative, every id once, cadences first', () => {
  const ids = PROGRESSIONS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(PROGRESSION_LEVELS.length, 8);
  assert.deepEqual(progressionsAtLevel(1).map((p) => p.name), ['Authentic', 'Plagal', 'Half cadence', 'Deceptive']);
  for (let n = 2; n <= 8; n++) {
    const below = progressionsAtLevel(n - 1);
    assert.deepEqual(progressionsAtLevel(n).slice(0, below.length), below);
  }
  assert.equal(progressionsAtLevel(8).length, PROGRESSIONS.length);
  for (const p of PROGRESSIONS) {
    assert.ok(p.name.length <= 13, `${p.id}: "${p.name}" is wider than an answer`);
    assert.equal(progressionById(p.id), p);
    for (const [, q] of p.steps) assert.ok(qualityById(q), `${p.id}: ${q}`);
    assert.equal(numeralsLabel(p).split('-').length, p.steps.length);
  }
  assert.equal(progressionById('nope'), null);
});

test('in every key, a diatonic chord root is spelled on its own degree letter', () => {
  /* The rule the charts have always had, in one place: a major progression
   * in its major key, a minor one in harmonic minor — so F# minor's V is C#
   * E# G#. Each plain numeral's root sits on the tonic's letter plus the
   * degree, which is what spelling a progression correctly means. */
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  for (const p of PROGRESSIONS) {
    const tokens = p.numerals.trim().split(/\s+/);
    for (let tonic = 0; tonic < 12; tonic++) {
      const key = progressionKey(p, tonic);
      const tonicLetter = LETTERS.indexOf(spell(tonic + 60, key).label[0]);
      progressionChords(p, tonic).forEach((c, i) => {
        const m = /^(VII|VI|IV|V|III|II|I)/i.exec(tokens[i]);
        if (/^[b#]|\//.test(tokens[i])) return;
        const degree = ROMAN.indexOf(m[1].toUpperCase());
        const letter = spell(c.root + 60, key).label[0];
        assert.equal(letter, LETTERS[(tonicLetter + degree) % 7], `${p.id} in ${tonic}: ${tokens[i]}`);
      });
      if (p.mode === 'minor') {
        /* The leading tone of harmonic minor on its own letter. */
        const lt = spell(tonic + 11 + 60, key).label[0];
        assert.equal(lt, LETTERS[(tonicLetter + 6) % 7]);
      }
    }
  }
});

test('every progression is a valid chart in every key', () => {
  for (const p of PROGRESSIONS) {
    for (let tonic = 0; tonic < 12; tonic++) {
      const song = progressionLesson(p, tonic);
      assert.deepEqual(validateExercise(song).errors || [], [], `${p.id} in ${tonic}`);
    }
  }
});

test('the walk round the circle visits all twelve keys in falling fifths', () => {
  const seen = [0];
  for (let i = 0; i < 11; i++) seen.push(nextOnCircle(seen[seen.length - 1]));
  assert.deepEqual(seen, [0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7]);
  assert.equal(nextOnCircle(7), 0);
});

test('matchProgression: chord by chord, exact or by name', () => {
  const C = buildChord(60, qualityById('maj'));
  const G = buildChord(67, qualityById('maj'));
  const chords = [C, G];
  assert.equal(matchProgression([], chords), INCOMPLETE);
  assert.equal(matchProgression([[60, 64]], chords), INCOMPLETE);
  assert.equal(matchProgression([C], chords), INCOMPLETE);
  assert.equal(matchProgression([C, G], chords), CORRECT);
  assert.equal(matchProgression([C, [67, 70]], chords), WRONG);
  assert.equal(matchProgression([C, G, C], chords), WRONG);
  /* An inversion is wrong as written, right by name. */
  const G1 = [71, 74, 79];
  assert.equal(matchProgression([C, G1], chords), WRONG);
  assert.equal(matchProgression([C, G1], chords, 'name'), CORRECT);
});
