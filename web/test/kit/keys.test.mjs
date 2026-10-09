// Copied from neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/test/keys.test.mjs), MIT, Torben Gräber.
// Changed: the import paths, to web/src/kit/lib.
/*
 * The keyboard, for every control that takes a pointer.
 * Copyright (c) 2026 Torben Gräber. MIT.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridMove, padKey, sliderKey, tabMove } from '../../src/kit/lib/keys.js';

test('arrows move through a grid of 16 to a row and stop at its edges', () => {
  assert.equal(gridMove('ArrowRight', 3, 32, 16), 4);
  assert.equal(gridMove('ArrowRight', 31, 32, 16), 31);
  assert.equal(gridMove('ArrowLeft', 0, 32, 16), 0);
  assert.equal(gridMove('ArrowDown', 3, 32, 16), 19);
  assert.equal(gridMove('ArrowDown', 19, 32, 16), 19);
  assert.equal(gridMove('ArrowUp', 19, 32, 16), 3);
  assert.equal(gridMove('ArrowDown', 3, 16, 16), 3, 'one row: nowhere to go');
  assert.equal(gridMove('Home', 21, 32, 16), 16);
  assert.equal(gridMove('End', 17, 20, 16), 19, 'a short last row ends early');
  assert.equal(gridMove('x', 3, 32, 16), null);
});

test('a pad toggles on Space and Enter, ties with shift, and alt-arrows its amount', () => {
  assert.deepEqual(padKey({ key: ' ' }, 0, 16, 16), { toggle: true, tie: false });
  assert.deepEqual(padKey({ key: 'Enter', shiftKey: true }, 0, 16, 16), { toggle: true, tie: true });
  assert.deepEqual(padKey({ key: 'ArrowUp', altKey: true }, 0, 16, 16), { depth: 0.1 });
  assert.deepEqual(padKey({ key: 'ArrowDown', altKey: true, shiftKey: true }, 0, 16, 16), { depth: -0.01 });
  assert.deepEqual(padKey({ key: 'ArrowRight' }, 0, 16, 16), { move: 1 });
  assert.equal(padKey({ key: 'a' }, 0, 16, 16), null);
});

test('a slider answers the knob\'s keys, limited to its axis', () => {
  assert.deepEqual(sliderKey({ key: 'ArrowRight' }, 'x'), { delta: 0.01 });
  assert.deepEqual(sliderKey({ key: 'ArrowLeft', shiftKey: true }, 'x'), { delta: -0.002 });
  assert.equal(sliderKey({ key: 'ArrowUp' }, 'x'), null);
  assert.deepEqual(sliderKey({ key: 'ArrowUp' }, 'y'), { delta: 0.01 });
  assert.deepEqual(sliderKey({ key: 'PageDown' }), { delta: -0.1 });
  assert.deepEqual(sliderKey({ key: 'End' }), { to: 1 });
  assert.equal(sliderKey({ key: 'Tab' }), null);
});

test('tabs move with the arrows and wrap', () => {
  assert.equal(tabMove('ArrowDown', 1, 2), 0);
  assert.equal(tabMove('ArrowUp', 0, 2), 1);
  assert.equal(tabMove('Home', 1, 2), 0);
  assert.equal(tabMove('Enter', 1, 2), null);
});

test('a count steps by one, pages by four, and stops at its ends', async () => {
  const { countKey } = await import('../../src/kit/lib/keys.js');
  assert.equal(countKey({ key: 'ArrowUp' }, 16, 1, 128), 17);
  assert.equal(countKey({ key: 'ArrowLeft' }, 1, 1, 128), 1);
  assert.equal(countKey({ key: 'PageUp' }, 126, 1, 128), 128);
  assert.equal(countKey({ key: 'Home' }, 16, 1, 128), 1);
  assert.equal(countKey({ key: ' ' }, 16, 1, 128), null);
});
