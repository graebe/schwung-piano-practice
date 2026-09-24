/*
 * controls.test.mjs — the transport lights and the jog.
 *
 * The first test here is a regression guard for a bug that reached hardware:
 * the Play button was lit only while a run was already going and switched off
 * in READY, so the one control that could start an exercise was dark while the
 * screen asked you to press it. The tester pressed a pad instead, which is the
 * only sane reading of "play" at a keyboard.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MENU, READY, RUNNING, SUMMARY, SETTINGS,
  OFF, GREEN, GREEN_DIM, RED, RED_DIM, PULSE_MS,
  pulsePhase, playLedColor, recordLedColor,
  jogAction, jogClickAction, shouldRebuildChart, countInRemaining, GUESS,
  referenceVelocity, referenceAudible,
} from '../src/controls.mjs';

/* ---- Play LED ----------------------------------------------------------- */

test('the Play button is never dark while the screen is asking you to press it', () => {
  for (const phase of [0, 1]) {
    assert.notEqual(playLedColor(READY, phase), OFF, `READY phase ${phase} must be lit`);
    assert.notEqual(playLedColor(SUMMARY, phase), OFF, `SUMMARY phase ${phase} must be lit`);
  }
});

test('READY pulses — the two phases differ, and both are green', () => {
  const a = playLedColor(READY, 0);
  const b = playLedColor(READY, 1);
  assert.notEqual(a, b, 'a steady light does not read as "press me"');
  assert.equal(a, GREEN_DIM);
  assert.equal(b, GREEN);
});

test('the active mode goes solid and the other dims, so the lights say what is happening', () => {
  /* Play listens, Record practises. */
  assert.equal(playLedColor(RUNNING, 0, true), GREEN, 'listening: Play solid');
  assert.equal(playLedColor(RUNNING, 1, true), GREEN, 'and not blinking');
  assert.equal(recordLedColor(RUNNING, true, 0), RED_DIM, 'listening: Record steps back');
  assert.equal(recordLedColor(RUNNING, true, 1), RED_DIM);

  assert.equal(recordLedColor(RUNNING, false, 0), RED, 'practising: Record solid');
  assert.equal(recordLedColor(RUNNING, false, 1), RED);
  assert.equal(playLedColor(RUNNING, 0, false), GREEN_DIM, 'practising: Play steps back');
  assert.equal(playLedColor(RUNNING, 1, false), GREEN_DIM);
});

test('Play is dark where it would do nothing', () => {
  for (const phase of [0, 1]) {
    assert.equal(playLedColor(MENU, phase), OFF);
    assert.equal(playLedColor(SETTINGS, phase), OFF);
  }
});

test('the pulse alternates on a human timescale', () => {
  assert.equal(pulsePhase(0), 0);
  assert.equal(pulsePhase(PULSE_MS), 1);
  assert.equal(pulsePhase(PULSE_MS * 2), 0);
  assert.notEqual(pulsePhase(0), pulsePhase(PULSE_MS));
  /* Two flips a second: fast enough to read as blinking, slow enough not to
   * flood the 16-writes-per-tick LED queue. */
  assert.ok(PULSE_MS >= 250 && PULSE_MS <= 1000);
});

/* ---- Record LED --------------------------------------------------------- */

test('both buttons are live on the ready screen, and both pulse', () => {
  /* Two choices, presented as equals — the screen names them, the lights say
   * both will do something. */
  for (const view of [READY, SUMMARY]) {
    assert.notEqual(recordLedColor(view, false, 0), OFF, `${view} Record must be lit`);
    assert.notEqual(recordLedColor(view, false, 1), OFF);
    assert.notEqual(playLedColor(view, 0), OFF);
    assert.notEqual(playLedColor(view, 1), OFF);
    assert.notEqual(recordLedColor(view, false, 0), recordLedColor(view, false, 1), 'Record pulses');
    assert.notEqual(playLedColor(view, 0), playLedColor(view, 1), 'Play pulses');
  }
});

test('neither button is lit where it would do nothing', () => {
  for (const phase of [0, 1]) {
    assert.equal(recordLedColor(MENU, false, phase), OFF);
    assert.equal(recordLedColor(SETTINGS, false, phase), OFF);
  }
});

/* ---- Jog ---------------------------------------------------------------- */

test('a jog nudge cannot abandon a run in progress', () => {
  for (const delta of [1, -1, 5, -3]) {
    assert.deepEqual(jogAction(RUNNING, delta, 2, 7), { action: 'ignore', index: 2 });
  }
});

test('the jog moves the highlight in a list', () => {
  assert.deepEqual(jogAction(MENU, 1, 2, 7), { action: 'cursor', index: 3 });
  assert.deepEqual(jogAction(MENU, -1, 2, 7), { action: 'cursor', index: 1 });
  assert.deepEqual(jogAction(SETTINGS, 1, 0, 9), { action: 'cursor', index: 1 });
});

test('the jog does nothing outside the lists', () => {
  /* It used to swap the exercise straight from the ready screen and from inside
   * a quiz, so a knock changed what you were playing. To pick something else
   * you go Back to the list first. */
  for (const view of [READY, SUMMARY, RUNNING, 'guess']) {
    for (const delta of [1, -1, 9, -9]) {
      assert.deepEqual(jogAction(view, delta, 2, 7), { action: 'ignore', index: 2 }, view);
    }
  }
});

test('no call anywhere can return the old select action', () => {
  for (const view of [MENU, READY, RUNNING, SUMMARY, SETTINGS, 'guess']) {
    for (const delta of [1, -1]) {
      for (const [i, n] of [[0, 0], [0, 7], [3, 7], [6, 7]]) {
        assert.notEqual(jogAction(view, delta, i, n).action, 'select');
      }
    }
  }
});

test('the list clamps rather than wraps', () => {
  assert.deepEqual(jogAction(MENU, 1, 6, 7), { action: 'cursor', index: 6 });
  assert.deepEqual(jogAction(MENU, -1, 0, 7), { action: 'cursor', index: 0 });
});

test('any accumulated delta counts as one step', () => {
  /* The host batches encoder ticks, so d2 can decode to several at once. */
  assert.deepEqual(jogAction(MENU, 9, 2, 7), { action: 'cursor', index: 3 });
  assert.deepEqual(jogAction(MENU, -9, 2, 7), { action: 'cursor', index: 1 });
});

test('an empty list is inert', () => {
  assert.equal(jogAction(MENU, 1, 0, 0).action, 'ignore');
  assert.equal(jogAction(READY, 1, 0, 0).action, 'ignore');
});

/* ---- Jog click ---------------------------------------------------------- */

test('shift-click reaches settings and comes back', () => {
  assert.equal(jogClickAction(READY, true, true), 'settings');
  assert.equal(jogClickAction(MENU, true, false), 'settings');
  assert.equal(jogClickAction(SETTINGS, true, true), 'ready');
  assert.equal(jogClickAction(SETTINGS, true, false), 'menu', 'nothing armed, so go to the list');
});

test('plain click edits in settings, opens in the menu, and lists elsewhere', () => {
  assert.equal(jogClickAction(SETTINGS, false, true), 'toggle-edit');
  assert.equal(jogClickAction(MENU, false, true), 'open');
  assert.equal(jogClickAction(READY, false, true), 'menu');
  assert.equal(jogClickAction(SUMMARY, false, true), 'menu');
});

/* ---- Rebuilding the armed exercise -------------------------------------- */

test('an armed generated exercise may be rebuilt', () => {
  assert.equal(shouldRebuildChart(READY, undefined), true);
  assert.equal(shouldRebuildChart(SUMMARY, undefined), true);
});

test('hand-written exercises are fixed notes, not a recipe', () => {
  assert.equal(shouldRebuildChart(READY, 'file'), false);
  assert.equal(shouldRebuildChart(SETTINGS, 'file'), false);
});

test('nothing is rebuilt mid-run', () => {
  assert.equal(shouldRebuildChart(RUNNING, undefined), false);
  assert.equal(shouldRebuildChart(MENU, undefined), false);
});

test('changing the key from the settings page still takes effect', () => {
  assert.equal(shouldRebuildChart(SETTINGS, undefined), true);
});

/* ---- Count-in ----------------------------------------------------------- */

test('the count-in counts whole beats down to the first note', () => {
  assert.equal(countInRemaining(-4), 4);
  assert.equal(countInRemaining(-3.9), 4);
  assert.equal(countInRemaining(-3.0), 3);
  assert.equal(countInRemaining(-0.1), 1);
  assert.equal(countInRemaining(0), 0);
  assert.equal(countInRemaining(2.5), 0);
});

test('the countdown never skips a number', () => {
  const seen = [];
  for (let b = -4; b < 0; b += 0.05) {
    const n = countInRemaining(b);
    if (seen[seen.length - 1] !== n) seen.push(n);
  }
  assert.deepEqual(seen, [4, 3, 2, 1]);
});

/* ---- Reference playback -------------------------------------------------- */

test('the reference sounds by default, softer than your own playing', () => {
  const vel = referenceVelocity(false, true, 70);
  assert.ok(vel > 0, 'on by default means audible');
  assert.ok(vel < 90, 'but under your pads, so a flam is audible when you are late');
});

test('turning the reference off silences it without touching Listen', () => {
  assert.equal(referenceVelocity(false, false, 70), 0);
  assert.equal(referenceVelocity(true, false, 70), 90, 'Listen mode still plays');
  assert.equal(referenceVelocity(true, true, 70), 90);
});

test('nothing sounds during the count-in', () => {
  assert.equal(referenceAudible(-2, false, true), false);
  assert.equal(referenceAudible(-0.01, true, true), false);
  assert.equal(referenceAudible(0, false, true), true);
  assert.equal(referenceAudible(1, false, false), false, 'off is off');
  assert.equal(referenceAudible(1, true, false), true, 'Listen overrides the setting');
});

test('both buttons are live in a quiz — they used to fall through to dark', () => {
  /* playLedColor and recordLedColor only answered for RUNNING, READY and
   * SUMMARY, so in a quiz two working controls sat unlit. */
  for (const phase of [0, 1]) {
    assert.notEqual(playLedColor(GUESS, phase), OFF, 'Play sounds the prompt there');
    assert.notEqual(recordLedColor(GUESS, false, phase, false), OFF, 'Record is the help button');
  }
});

test('neither pulses in a quiz — nothing there is urgent', () => {
  assert.equal(playLedColor(GUESS, 0), playLedColor(GUESS, 1));
  assert.equal(recordLedColor(GUESS, false, 0, false), recordLedColor(GUESS, false, 1, false));
});

test('Record dims once the help is used up, so the button says so', () => {
  assert.notEqual(recordLedColor(GUESS, false, 1, true), recordLedColor(GUESS, false, 1, false));
  assert.notEqual(recordLedColor(GUESS, false, 1, true), OFF, 'dim, not dark');
});
