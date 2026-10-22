// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGlide, easeOut, GLIDE_MS } from '../src/music/glide.js';

test('the curve leaves quickly and arrives gently, from 0 to 1', () => {
  assert.equal(easeOut(0), 0);
  assert.equal(easeOut(1), 1);
  assert.ok(easeOut(0.5) > 0.5);
});

test('it starts where it is sent, then glides to the next place in GLIDE_MS', () => {
  let t = 0;
  const g = createGlide(() => t);
  assert.equal(g(3), 3);
  t = 100;
  assert.equal(g(3), 3, 'at rest');
  const mid = (t = 100 + GLIDE_MS / 2, g(4));
  assert.equal(mid, 3, 'the move starts now');
  t += GLIDE_MS / 2;
  const half = g(4);
  assert.ok(half > 3.5 && half < 4, String(half));
  t += GLIDE_MS;
  assert.equal(g(4), 4);
});

test('a target that moves on mid-glide carries on from where it is', () => {
  let t = 0;
  const g = createGlide(() => t);
  g(0);
  g(1);
  t = GLIDE_MS / 3;
  const here = g(1);
  const next = g(2);
  assert.equal(next, here, 'no jump');
  t += GLIDE_MS;
  assert.equal(g(2), 2);
});

test('a new round lands at once', () => {
  let t = 0;
  const g = createGlide(() => t);
  g(12);
  t = 10;
  assert.equal(g(0), 0);
});
