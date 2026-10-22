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

test('the shared icons are path, quiz, progress and settings; practice is passed in', () => {
  assert.deepEqual(Object.keys(ICONS), ['path', 'quiz', 'progress', 'settings']);
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
