// Copied from neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/test/ground-geometry.test.mjs), MIT, Torben Gräber.
// Changed: the import paths, to web/src/kit/lib.
/*
 * The ground's geometry: rects, scale and backing pixels.
 * Copyright (c) 2026 Torben Gräber. MIT.
 *
 * Every editor here scales its <main> with a CSS transform, and the ground's
 * canvas lives inside it. These pin the arithmetic that turns what the page
 * measures into what the field simulates in -- the part that was wrong: the
 * walls were measured in on-screen px and used as layout px, so at any scale
 * but 1 the panels the rings reflect off were not where the panels are.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { viewScale, toCanvasRects, sameRects, backingRatio } from '../../src/kit/lib/ground-geometry.js';

test('the scale is the on-screen width over the layout width', () => {
  assert.equal(viewScale({ width: 412 }, 824), 0.5);
  assert.equal(viewScale({ width: 1648 }, 824), 2);
  /* Unmeasurable yet: 1, never 0 or NaN, which would poison every division. */
  assert.equal(viewScale({ width: 0 }, 0), 1);
  assert.equal(viewScale({ width: 100 }, 0), 1);
  assert.equal(viewScale(null, 824), 1);
  assert.equal(viewScale({ width: 0 }, 824), 1);
});

test('rects come back in the canvas\'s layout px at any scale', () => {
  /* A 304x140 panel at (304, 32) in an 824-wide design, shown at half size in a
   * canvas whose top-left is at (10, 20) on screen. */
  const k = 0.5;
  const base = { left: 10, top: 20, width: 824 * k, height: 700 * k };
  const panel = { left: 10 + 304 * k, top: 20 + 32 * k, width: 304 * k, height: 140 * k };
  assert.deepEqual(toCanvasRects(base, [panel], k), [{ x: 304, y: 32, w: 304, h: 140 }]);

  /* The old conversion -- scale ignored -- is what put the walls in the wrong
   * place, and this is how wrong. */
  assert.notDeepEqual(toCanvasRects(base, [panel], 1), [{ x: 304, y: 32, w: 304, h: 140 }]);
});

test('a box with no area is dropped', () => {
  const base = { left: 0, top: 0 };
  assert.deepEqual(
    toCanvasRects(base, [{ left: 5, top: 5, width: 0, height: 10 }, { left: 1, top: 1, width: 2, height: 2 }]),
    [{ x: 1, y: 1, w: 2, h: 2 }],
  );
});

test('sameRects tells an unchanged layout from a moved one', () => {
  const a = [{ x: 1, y: 2, w: 3, h: 4 }];
  assert.equal(sameRects(a, [{ x: 1, y: 2, w: 3, h: 4 }]), true);
  assert.equal(sameRects(a, [{ x: 1, y: 2, w: 3, h: 5 }]), false);
  assert.equal(sameRects(a, []), false);
  assert.equal(sameRects([], []), true);
  assert.equal(sameRects(null, []), false);
});

test('the backing ratio is dpr times scale, snapped to a whole-pixel pitch', () => {
  assert.equal(backingRatio(1, 1, 12), 1);
  assert.equal(backingRatio(2, 1, 12), 2);
  assert.equal(backingRatio(2, 0.5, 12), 1);
  /* 12 * 1.66 = 19.92 -> 20 backing px per pitch. */
  assert.equal(backingRatio(2, 0.83, 12) * 12, 20);
  /* Never below one backing pixel per pitch, and nonsense reads as 1. */
  assert.ok(backingRatio(1, 0.001, 12) * 12 >= 1);
  assert.equal(backingRatio(0, 0, 12), 1);
  assert.equal(backingRatio(NaN, 1, 12), 1);
});
