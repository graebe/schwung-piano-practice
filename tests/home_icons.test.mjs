// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * The home screen's icons: two sizes each, centred, inside their circles.
 * Imports only src/home, so it runs unchanged in Drums Practice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ICONS, PRACTICE_DRUMS, PRACTICE_PIANO } from '../src/home/icons.mjs';
import { R_SMALL, R_LARGE, circleRows } from '../src/home/render.mjs';

const ALL = { ...ICONS, practiceDrums: PRACTICE_DRUMS, practicePiano: PRACTICE_PIANO };

test('the shared icons: the home screen\'s and the rings\' one level down; practice is passed in', () => {
  assert.deepEqual(Object.keys(ICONS), ['path', 'quiz', 'progress', 'settings',
    'notes', 'kit', 'sticks', 'dice', 'folder', 'staff', 'ear', 'padpick', 'metronome', 'loop',
    'stairs', 'chord', 'progression', 'song', 'keyletter', 'note', 'interval', 'book']);
  assert.ok(Object.isFrozen(ICONS) && Object.isFrozen(PRACTICE_DRUMS) && Object.isFrozen(PRACTICE_PIANO));
});

test('every icon is 9x9 small and 13x13 large, ASCII rows of # and .', () => {
  for (const [name, set] of Object.entries(ALL)) {
    for (const [size, rows] of [[9, set.small], [13, set.large]]) {
      assert.equal(rows.length, size, `${name} ${size}`);
      for (const r of rows) assert.match(r, new RegExp(`^[#.]{${size}}$`), `${name} ${size}: ${r}`);
      assert.ok(rows.join('').includes('#'));
    }
  }
});

test('every icon sits inside its circle with a pixel to spare', () => {
  for (const [name, set] of Object.entries(ALL)) {
    for (const [r, rows] of [[R_SMALL, set.small], [R_LARGE, set.large]]) {
      const disc = circleRows(r - 1).fill;
      const off = (r - 1) - (rows.length >> 1);
      rows.forEach((row, y) => [...row].forEach((ch, x) => {
        if (ch === '#') assert.equal(disc[y + off][x + off], '#', `${name} at r ${r}: ${x},${y}`);
      }));
    }
  }
});

test('the six icons are six different pictures at both sizes', () => {
  for (const size of ['small', 'large']) {
    const shapes = Object.values(ALL).map((set) => set[size].join('|'));
    assert.equal(new Set(shapes).size, shapes.length, size);
  }
});

/* The rings one level down, as the modules build them. */
const RINGS = {
  'practice-drums': ['notes', 'kit', 'sticks', 'dice', 'folder'],
  'quiz-drums': ['staff', 'ear', 'padpick', 'metronome', 'loop'],
  'songs-piano': ['note', 'loop', 'metronome', 'chord'],
  /* Practice as five trainers, and the five circles every trainer has. */
  'subjects-piano': ['note', 'interval', 'stairs', 'chord', 'progression'],
  'trainer-piano': ['staff', 'ear', 'keyletter', 'book', 'progress'],
};

test('no subject icon is a circle icon: the two levels never look alike', () => {
  for (const s of RINGS['subjects-piano']) assert.ok(RINGS['trainer-piano'].indexOf(s) < 0, s);
});

test('the icons of one ring are told apart: no two alike, at either size', () => {
  for (const [ring, keys] of Object.entries(RINGS)) {
    for (const size of ['small', 'large']) {
      const shapes = keys.map((k) => ICONS[k][size].join('|'));
      assert.equal(new Set(shapes).size, keys.length, `${ring} ${size}`);
      /* Apart by more than a pixel or two: every pair differs in at least 8. */
      for (let a = 0; a < keys.length; a++) {
        for (let b = a + 1; b < keys.length; b++) {
          const x = ICONS[keys[a]][size].join('');
          const y = ICONS[keys[b]][size].join('');
          let d = 0;
          for (let i = 0; i < x.length; i++) d += x[i] !== y[i] ? 1 : 0;
          assert.ok(d >= 8, `${ring} ${size}: ${keys[a]} and ${keys[b]} differ in ${d} pixels`);
        }
      }
    }
  }
});
