// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_QUALITIES, CHORD_LEVELS, QUIZ_QUALITIES, PAD_SPAN, chordsAtLevel, qualityById, qualitySpan,
  buildChord, nameChord, chordPool, matchChord, playable,
} from '../src/chords.mjs';
import { LESSON_NAMES } from '../src/chord_lessons.mjs';
import { CORRECT, WRONG, INCOMPLETE } from '../src/verdict.mjs';
import { scalePitches, playableRange } from '../src/generator.mjs';
import { DEFAULT_TRANSPOSE } from '../src/padmap.mjs';

test('one name per quality, for lessons and answers alike', () => {
  for (const q of ALL_QUALITIES) {
    assert.ok(q.name && q.name.length <= 13, `${q.id}: "${q.name}"`);
    assert.equal(LESSON_NAMES[q.id], q.name);
  }
  assert.equal(qualityById('m7b5').name, 'Half-dim 7th');
});

test('the chord ladder is cumulative and complete', () => {
  const all = [].concat(...CHORD_LEVELS);
  assert.equal(new Set(all).size, all.length);
  for (const id of all) assert.ok(qualityById(id), id);
  assert.deepEqual(chordsAtLevel(1), ['maj']);
  assert.deepEqual(chordsAtLevel(3), ['maj', 'min', 'dim', 'aug']);
  for (let n = 2; n <= CHORD_LEVELS.length; n++) {
    const below = chordsAtLevel(n - 1);
    assert.deepEqual(chordsAtLevel(n).slice(0, below.length), below);
  }
  assert.equal(chordsAtLevel(0).length, 1);
  assert.equal(chordsAtLevel(99).length, all.length);
  /* Every ladder quality fits the pads with roots to spare. */
  assert.deepEqual(QUIZ_QUALITIES, all);
  for (const id of all) assert.ok(qualitySpan(qualityById(id)) <= PAD_SPAN - 4, id);
});

test('nameChord: root position as before, inversions and slash chords on request', () => {
  assert.equal(nameChord([64, 67, 71]), 'Em');
  assert.equal(nameChord([64, 67, 72]), null, 'off by default: the song name lane is unchanged');
  /* Every inversion of every ladder quality is named over its own root. */
  for (const id of [].concat(...CHORD_LEVELS)) {
    const q = qualityById(id);
    const root = buildChord(60, q);
    for (let k = 1; k < q.intervals.length && q.intervals[k] < 12; k++) {
      const inv = root.slice(k).concat(root.slice(0, k).map((p) => p + 12));
      const name = nameChord(inv, 0, { inversions: true });
      assert.ok(name, `${id} inversion ${k} unnamed`);
      /* Unambiguous shapes name their own root. The rest are honestly
       * ambiguous: Csus2 over D is Gsus4/D, an augmented triad or a dim7 is
       * symmetric, C E G A is C6 before it is Am7/C. */
      if (['maj', 'min', 'dim', '7', 'maj7', 'mMaj7'].indexOf(id) >= 0) {
        assert.ok(name.startsWith('C' + q.suffix + '/'), `${id}/${k}: ${name}`);
      }
    }
  }
  assert.equal(nameChord([64, 67, 72], 0, { inversions: true }), 'C/E');
  assert.equal(nameChord([67, 72, 76], 0, { inversions: true }), 'C/G');
  assert.equal(nameChord([60, 62, 66, 69], 0, { inversions: true }), 'D7/C');
  /* A bass a chord tone away reads as that chord (D F# A over C is D7/C, C
   * E G over D is Cadd9/D); a bass outside every reading is a slash chord. */
  assert.equal(nameChord([48, 62, 66, 69], 0, { inversions: true }), 'D7/C');
  assert.equal(nameChord([50, 60, 64, 67], 0, { inversions: true }), 'Cadd9/D');
  assert.equal(nameChord([48, 66, 70, 73], 0, { inversions: true }), 'F#/C');
  assert.equal(nameChord([60, 61, 62], 0, { inversions: true }), null, 'a cluster stays unnamed');
  assert.equal(nameChord([60, 61], 0, { inversions: true }), null);
});

test('chordPool keeps the order the chord drill always drew in', () => {
  const pool = chordPool({ qualities: ['maj', 'min'], roots: 'key' });
  const { lo, hi } = playableRange(DEFAULT_TRANSPOSE);
  const roots = scalePitches(0, 'major', lo, hi);
  let last = -1;
  for (const e of pool) {
    assert.ok(roots.indexOf(e.root) >= 0);
    assert.ok(e.root >= last);
    last = e.root;
    assert.ok(playable(e.pitches));
    assert.equal(e.inversion, 0);
  }
  assert.deepEqual(pool.slice(0, 2).map((e) => e.label), ['A', 'Am']);
});

test('chordPool roots: diatonic keeps the chords of the key', () => {
  /* A minor: Am, C, Dm, Em, F, G — and the dim on B, never E major. */
  const pool = chordPool({ qualities: ['maj', 'min', 'dim'], roots: 'diatonic', rootPc: 9, mode: 'minor' });
  const names = new Set(pool.map((e) => e.label));
  for (const n of ['Am', 'C', 'Dm', 'Em', 'F', 'G', 'Bdim']) assert.ok(names.has(n), n);
  for (const n of ['A', 'E', 'D', 'Cm']) assert.ok(!names.has(n), n);
  const chromatic = chordPool({ qualities: ['maj'], roots: 'chromatic' });
  assert.equal(new Set(chromatic.map((e) => e.root % 12)).size, 12);
});

test('chordPool inversions: the same tones over the 3rd and 5th, each named by its bass', () => {
  const pool = chordPool({ qualities: ['maj', '7'], roots: 'key', inversions: true });
  const c = pool.filter((e) => e.root === 60 && e.qualityId === 'maj');
  assert.deepEqual(c.map((e) => e.pitches), [[60, 64, 67], [64, 67, 72], [67, 72, 76]]);
  assert.deepEqual(c.map((e) => e.label), ['C', 'C/E', 'C/G']);
  const g7 = pool.filter((e) => e.root === 67 && e.qualityId === '7');
  for (const e of g7) {
    assert.deepEqual(e.pitches.map((p) => p % 12).sort((a, b) => a - b), [2, 5, 7, 11]);
    assert.ok(playable(e.pitches));
  }
});

test('matchChord: exact by pitch, or by name over pitch classes', () => {
  const am = [57, 60, 64];
  assert.equal(matchChord([], am), INCOMPLETE);
  assert.equal(matchChord([57, 60], am), INCOMPLETE);
  assert.equal(matchChord([57, 60, 64], am), CORRECT);
  assert.equal(matchChord([57, 61], am), WRONG);
  assert.equal(matchChord([60, 64, 69], am), WRONG, 'an inversion is not what was written');
  assert.equal(matchChord([60, 64, 69], am, 'name'), CORRECT);
  assert.equal(matchChord([60, 64, 69, 72], am, 'name'), CORRECT, 'a doubled note is fine');
  assert.equal(matchChord([60, 64, 70], am, 'name'), WRONG, 'a stray one is not');
  assert.equal(matchChord([64], am, 'name'), INCOMPLETE);
});
