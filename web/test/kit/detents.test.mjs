// Copied from neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/test/detents.test.mjs), MIT, Torben Gräber.
// Changed: the import paths, to web/src/kit/lib.
/*
 * Detents: the values a control holds on while it is dragged past them.
 * Copyright (c) 2026 Torben Gräber. MIT.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DETENT_HOLD_PX, detentTravel, detentValue, dragValue, nextDetent,
} from '../../src/kit/lib/detents.js';
import { countKey } from '../../src/kit/lib/keys.js';

/* The Length knob at 1/32 in 4/4: 16, 32, 64 and 128 steps, normalised the
 * way the parameter is, over the knob's 200px of travel. */
const norm = (steps) => (steps - 1) / 127;
const D = [16, 32, 64, 128].map(norm);
const TRAVEL = 200;
const HOLD = DETENT_HOLD_PX / TRAVEL;
const steps = (v) => Math.round(v * 127) + 1;
/* Where a drag that started at `from` steps is after `dy` px upwards. */
const drag = (from, dy, opts = {}) =>
  steps(dragValue(norm(from), dy, { travel: TRAVEL, detents: D, ...opts }));

test('the hold is a fixed distance, chosen to land on but never stick', () => {
  assert.ok(DETENT_HOLD_PX >= 12 && DETENT_HOLD_PX <= 16, `${DETENT_HOLD_PX}px`);
});

test('without detents the mapping is the identity', () => {
  for (const v of [0, 0.25, 0.5, 1]) {
    assert.equal(detentTravel(v, [], HOLD), v);
    assert.equal(detentValue(v, [], HOLD), v);
  }
  assert.equal(dragValue(0.5, 20, { travel: 200 }), 0.6);
});

test('a drag passing near a detent lands on it and holds there', () => {
  /* From 20 steps, 32 is 12 steps -- 18.9px -- up. Anywhere over the next
   * DETENT_HOLD_PX the knob says 32. */
  const reach = (32 - 20) / 127 * TRAVEL;
  assert.equal(drag(20, reach - 1.6), 31, 'one step short is not yet on it');
  for (let px = 0; px <= DETENT_HOLD_PX; px += 0.5) {
    assert.equal(drag(20, reach + px), 32, `${px}px into the hold`);
  }
  assert.equal(drag(20, reach + DETENT_HOLD_PX + 1.6), 33, 'and then it moves on');
});

test('the hold is the same distance coming down', () => {
  const reach = (40 - 32) / 127 * TRAVEL;
  assert.equal(drag(40, -(reach - 1.6)), 33);
  for (let px = 0; px <= DETENT_HOLD_PX; px += 0.5) {
    assert.equal(drag(40, -(reach + px)), 32, `${px}px into the hold`);
  }
  assert.equal(drag(40, -(reach + DETENT_HOLD_PX + 1.6)), 31);
});

test('a drag that starts on a detent leaves it after half the hold, either way', () => {
  const half = DETENT_HOLD_PX / 2;
  assert.equal(drag(32, half - 0.5), 32);
  assert.equal(drag(32, -(half - 0.5)), 32);
  assert.equal(drag(32, half + 1.6), 33);
  assert.equal(drag(32, -(half + 1.6)), 31);
  /* A press and no move is no change. */
  assert.equal(dragValue(norm(32), 0, { travel: TRAVEL, detents: D }), norm(32));
});

test('the mapping is monotonic and reaches both ends', () => {
  let last = -1;
  for (let u = 0; u <= 1 + HOLD * D.length; u += 0.001) {
    const v = detentValue(u, D, HOLD);
    assert.ok(v >= last - 1e-12, `not monotonic at ${u}`);
    last = v;
  }
  assert.equal(detentValue(0, D, HOLD), 0);
  assert.equal(detentValue(1 + HOLD * D.length, D, HOLD), 1);
  assert.equal(drag(1, 1000), 128);
  assert.equal(drag(128, -1000), 1);
});

test('travel and value are inverses off the detents, and a detent is its hold\'s middle', () => {
  for (const v of [0.01, 0.2, 0.4, 0.9]) {
    assert.ok(Math.abs(detentValue(detentTravel(v, D, HOLD), D, HOLD) - v) < 1e-12);
  }
  const u = detentTravel(D[1], D, HOLD);
  assert.equal(detentValue(u - HOLD / 2 + 1e-9, D, HOLD), D[1]);
  assert.equal(detentValue(u + HOLD / 2 - 1e-9, D, HOLD), D[1]);
});

test('a fine drag ignores the detents', () => {
  /* Shift divides the travel by 5, and moves straight through 32. */
  const fine = TRAVEL * 5;
  const reach = (32 - 31) / 127 * fine;
  assert.equal(drag(31, reach, { travel: fine, fine: true }), 32);
  assert.equal(drag(31, reach + 8, { travel: fine, fine: true }), 33);
});

test('detents out of range or unsorted are tolerated', () => {
  const messy = [norm(64), 2, norm(16), -1, NaN, norm(32), norm(16)];
  assert.equal(steps(detentValue(detentTravel(norm(32), messy, HOLD), messy, HOLD)), 32);
  assert.equal(nextDetent(norm(20), messy, 1), norm(32));
});

test('Page Up and Down go to the next detent, and past the last there is none', () => {
  assert.equal(nextDetent(norm(20), D, 1), norm(32));
  assert.equal(nextDetent(norm(20), D, -1), norm(16));
  assert.equal(nextDetent(norm(32), D, 1), norm(64), 'from on one, the next');
  assert.equal(nextDetent(norm(32), D, -1), norm(16));
  assert.equal(nextDetent(norm(128), D, 1), null);
  assert.equal(nextDetent(norm(10), D, -1), null);
  assert.equal(nextDetent(0.5, [], 1), null);
});

test('a count pages between detents, and by its page where there is none', () => {
  const at = [16, 32, 64, 128];
  assert.equal(countKey({ key: 'PageUp' }, 20, 1, 128, 4, at), 32);
  assert.equal(countKey({ key: 'PageDown' }, 20, 1, 128, 4, at), 16);
  assert.equal(countKey({ key: 'PageUp' }, 128, 1, 128, 4, at), 128);
  assert.equal(countKey({ key: 'PageDown' }, 10, 1, 128, 4, at), 6, 'none below: the page');
  assert.equal(countKey({ key: 'PageUp' }, 20, 1, 128, 4), 24, 'no detents: the page');
  assert.equal(countKey({ key: 'ArrowUp' }, 20, 1, 128, 4, at), 21, 'arrows stay one');
  assert.equal(countKey({ key: 'ArrowDown' }, 32, 1, 128, 4, at), 31);
});
