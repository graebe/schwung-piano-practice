/*
 * led_paint.test.mjs — the pad colours, tested for real.
 *
 * This logic used to live in ui.js, where only a regex could reach it, and it
 * shipped three bugs to hardware in a row. Each of those has a named test
 * below. It is also the hottest code in the module, so allocation is asserted
 * too, not assumed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createLedState, padColors } from '../src/led_paint.mjs';
import {
  PAD_FIRST, PAD_COUNT, padsForPitch, padPitch, DEFAULT_TRANSPOSE,
  LED_OFF, LED_ROOT, LED_SCALE, LED_PRESSED, LED_TARGET_FAR, LED_TARGET_NEAR, LED_MISS, LED_HIT,
} from '../src/padmap.mjs';
import { playLedColor, recordLedColor, READY, RUNNING, SUMMARY, MENU, SETTINGS, OFF }
  from '../src/controls.mjs';
import { MODES } from '../src/generator.mjs';

const MAJOR = MODES.major;

function baseState(over = {}) {
  return {
    transpose: DEFAULT_TRANSPOSE, rootPc: 0, intervals: MAJOR, phase: 1, now: 1000,
    heldPads: {}, flashes: {},
    soundingPitches: null, stuckPitches: null, targetPitches: null, targetNear: false,
    ...over,
  };
}

const paint = (over) => {
  const ws = createLedState();
  const out = new Array(PAD_COUNT);
  padColors(baseState(over), ws, out);
  return out;
};

const colourOf = (out, pitch, transpose = DEFAULT_TRANSPOSE) => {
  const pads = padsForPitch(pitch, transpose);
  assert.ok(pads.length, `no pad plays ${pitch}`);
  return out[pads[0] - PAD_FIRST];
};

/* ---- The base layer -------------------------------------------------------- */

test('every pad gets a colour, in every configuration', () => {
  const overrides = [{}, { rootPc: 7 }, { transpose: 0 }];
  /* Every one of Move's scales, not a chosen example: they range from five
   * notes to twelve, and the painter caches its pitch-class set by a key built
   * from the interval list. */
  for (const name of Object.keys(MODES)) overrides.push({ intervals: MODES[name] });
  for (const over of overrides) {
    const out = paint(over);
    assert.equal(out.length, PAD_COUNT);
    for (let i = 0; i < PAD_COUNT; i++) assert.equal(typeof out[i], 'number', `pad ${i} unset`);
  }
});

test('the key is shown underneath: root white, in-scale red, out of key dark', () => {
  const out = paint({ rootPc: 0 });
  assert.equal(colourOf(out, 60), LED_ROOT, 'C is the root');
  assert.equal(colourOf(out, 62), LED_SCALE, 'D is in the scale');
  assert.equal(colourOf(out, 61), LED_OFF, 'C# is not in C major');
});

test('changing key moves the colouring with it', () => {
  const out = paint({ rootPc: 2, intervals: MAJOR });
  assert.equal(colourOf(out, 62), LED_ROOT, 'D is now the root');
  assert.equal(colourOf(out, 66), LED_SCALE, 'F# belongs to D major');
  assert.equal(colourOf(out, 65), LED_OFF, 'F natural does not');
});

/* ---- Priority -------------------------------------------------------------- */

test('a press beats everything — not seeing your own pad light feels broken', () => {
  const pad = padsForPitch(60, DEFAULT_TRANSPOSE)[0];
  const pitch = padPitch(pad, DEFAULT_TRANSPOSE);
  const out = paint({
    heldPads: { [pad]: 1 },
    stuckPitches: [pitch], soundingPitches: [pitch], targetPitches: [pitch],
  });
  assert.equal(out[pad - PAD_FIRST], LED_PRESSED);
});

test('a judgement flash beats even a press, while it lasts', () => {
  const pad = padsForPitch(60, DEFAULT_TRANSPOSE)[0];
  const lit = paint({ heldPads: { [pad]: 1 }, flashes: { [pad]: { color: LED_HIT, untilMs: 2000 } } });
  assert.equal(lit[pad - PAD_FIRST], LED_HIT);
  const expired = paint({ heldPads: { [pad]: 1 }, flashes: { [pad]: { color: LED_HIT, untilMs: 500 } } });
  assert.equal(expired[pad - PAD_FIRST], LED_PRESSED, 'and stops when it expires');
});

test('the stuck note outranks guidance, which outranks the key', () => {
  /* D is in the scale but not the root, so each layer is distinguishable. */
  const stuck = paint({ stuckPitches: [62], targetPitches: [62], targetNear: true, phase: 1 });
  assert.equal(colourOf(stuck, 62), LED_ROOT, 'the stuck pulse wins over guidance');
  assert.equal(colourOf(paint({ targetPitches: [62], targetNear: true }), 62), LED_TARGET_NEAR);
  assert.equal(colourOf(paint({}), 62), LED_SCALE, 'and the key colouring is underneath');
});

test('guidance brightens as the note approaches', () => {
  assert.equal(colourOf(paint({ targetPitches: [62], targetNear: false }), 62), LED_TARGET_FAR);
  assert.equal(colourOf(paint({ targetPitches: [62], targetNear: true }), 62), LED_TARGET_NEAR);
});

test('the stuck note pulses — the music has stopped and is waiting for it', () => {
  assert.equal(colourOf(paint({ stuckPitches: [62], phase: 1 }), 62), LED_ROOT);
  assert.equal(colourOf(paint({ stuckPitches: [62], phase: 0 }), 62), LED_OFF);
});

test('Listen lights what it is playing, steadily', () => {
  assert.equal(colourOf(paint({ soundingPitches: [62], phase: 1 }), 62), LED_TARGET_NEAR);
  assert.equal(colourOf(paint({ soundingPitches: [62], phase: 0 }), 62), LED_TARGET_NEAR,
    'it must not blink: there is nothing urgent about a demonstration');
});

test('every pad that sounds a lit pitch lights, because the grid has twins', () => {
  const out = paint({ soundingPitches: [72] });
  const twins = padsForPitch(72, DEFAULT_TRANSPOSE);
  assert.ok(twins.length > 1, 'C5 should appear on more than one pad');
  for (const pad of twins) assert.equal(out[pad - PAD_FIRST], LED_TARGET_NEAR, `pad ${pad}`);
});

/* ---- The three bugs that shipped ------------------------------------------- */

test('REGRESSION: the Play button is never dark while the screen asks for it', () => {
  /* Shipped as `view === RUNNING ? 127 : 0` — unlit in exactly the state whose
   * whole job is to say "press me". The first thing that went wrong on hardware. */
  for (const phase of [0, 1]) {
    assert.notEqual(playLedColor(READY, phase), OFF);
    assert.notEqual(recordLedColor(READY, false, phase), OFF);
    assert.notEqual(playLedColor(SUMMARY, phase), OFF);
  }
});

test('REGRESSION: a quiz never lights its own answer, at either phase', () => {
  /* Shipped lit when Guide pads was on, which answers the question being asked.
   * The guessing views pass no target or stuck pitches at all. */
  for (const phase of [0, 1]) {
    const out = paint({ phase, targetPitches: null, stuckPitches: null });
    for (let i = 0; i < PAD_COUNT; i++) {
      assert.ok(
        out[i] === LED_OFF || out[i] === LED_SCALE || out[i] === LED_ROOT,
        `pad ${i} shows ${out[i]}, which is not part of the key colouring`,
      );
    }
  }
});

test('REGRESSION: nothing blinks unless it is the stuck note', () => {
  /* The guesser's answer pulsed because it was folded into the stuck layer. */
  const a = paint({ phase: 0, targetPitches: [62], soundingPitches: [64] });
  const b = paint({ phase: 1, targetPitches: [62], soundingPitches: [64] });
  assert.deepEqual(a, b, 'only the stuck layer may differ between pulse phases');
});

/* ---- Performance ----------------------------------------------------------- */

test('painting allocates nothing: it runs in the frame path', () => {
  /* The old version built ~68 objects per call and ran at the full 500Hz tick,
   * roughly 34,000 allocations a second on the Move's CPU. */
  const ws = createLedState();
  const out = new Array(PAD_COUNT);
  const state = baseState({ soundingPitches: [60], stuckPitches: [64], targetPitches: [67] });

  padColors(state, ws, out);
  const layer = ws.layer;
  const scale = ws.scalePcs;
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 20000; i++) padColors(state, ws, out);
  const grew = process.memoryUsage().heapUsed - before;

  assert.equal(ws.layer, layer, 'the workspace must be reused, not rebuilt');
  assert.equal(ws.scalePcs, scale, 'and the scale set cached');
  assert.ok(grew < 2 * 1024 * 1024, `20k repaints grew the heap by ${grew} bytes`);
});

test('the scale set is only rebuilt when the key actually changes', () => {
  const ws = createLedState();
  const out = new Array(PAD_COUNT);
  padColors(baseState({ rootPc: 0 }), ws, out);
  const key = ws.scaleKey;
  padColors(baseState({ rootPc: 0 }), ws, out);
  assert.equal(ws.scaleKey, key, 'same key, no rebuild');
  padColors(baseState({ rootPc: 5 }), ws, out);
  assert.notEqual(ws.scaleKey, key, 'new key, rebuilt');
  assert.equal(colourOf(out, 65), LED_ROOT, 'and the colours followed');
});

test('a pitch with no pad on the grid is simply not lit', () => {
  assert.doesNotThrow(() => paint({ soundingPitches: [12, 126], stuckPitches: [0] }));
});

test('the multiple-choice prompt is lit, because there it is the question', () => {
  /* "Never light the answer in a quiz" still holds: in that drill the answer is
   * the NAME, and the lit pad is what you are being asked about. */
  const out = paint({ promptPitches: [62] });
  assert.equal(colourOf(out, 62), LED_ROOT);
  /* It outranks guidance and the key, and is beaten by a press. */
  assert.equal(colourOf(paint({ promptPitches: [62], targetPitches: [62] }), 62), LED_ROOT);
  const pad = padsForPitch(62, DEFAULT_TRANSPOSE)[0];
  assert.equal(paint({ promptPitches: [62], heldPads: { [pad]: 1 } })[pad - PAD_FIRST], LED_PRESSED);
});

test('the prompt does not blink — it is a question, not an urgency', () => {
  assert.deepEqual(paint({ promptPitches: [62], phase: 0 }), paint({ promptPitches: [62], phase: 1 }));
});
