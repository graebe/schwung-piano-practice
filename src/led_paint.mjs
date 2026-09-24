/*
 * led_paint.mjs — what colour every pad should be. Pure.
 *
 * This lived in ui.js, where nothing but a regex could test it, and it broke
 * three times in a row on hardware: the Play button dark in READY (so the
 * screen said "press play" while the only control that would start anything
 * was unlit), the guesser's pad blinking, and the quiz lighting its own
 * answer. Each was found by playing the thing, which is the expensive way.
 *
 * It is also the hottest code in the module. ui.js repaints on every tick
 * while a run is going — 500Hz — so this must not allocate: at 32 pads a
 * single `{}` per call is 16,000 objects a second on an embedded CPU, and the
 * old version managed about 68 per call. Everything here writes into
 * caller-owned arrays and reads from a cached scale set.
 */

import {
  PAD_FIRST, PAD_LAST, PAD_COUNT, padPitch, padsForPitch,
  LED_OFF, LED_ROOT, LED_SCALE, LED_PRESSED, LED_TARGET_FAR, LED_TARGET_NEAR,
} from './padmap.mjs';

/*
 * Marker values for the scratch layer. `mark` keeps the HIGHEST, so these must
 * ascend in priority: guidance is the weakest hint, the stuck note overrides it
 * (the music has actually stopped for that one), and Listen's own playback
 * overrides both.
 */
const NONE = 0;
const TARGET_FAR = 1;
const TARGET_NEAR = 2;
const STUCK = 3;
const SOUNDING = 4;

/*
 * A reusable workspace. One per caller, created once and handed back on every
 * call; nothing inside it is reallocated.
 */
export function createLedState() {
  return {
    layer: new Uint8Array(PAD_COUNT),
    scalePcs: new Uint8Array(12),
    scaleKey: '',
  };
}

/*
 * The in-key colouring underneath everything. Cached because it only changes
 * when the key, scale or octave does — recomputing a pitch-class set 500 times
 * a second to answer a question whose inputs did not move is pure waste.
 */
function refreshScale(ws, rootPc, intervals, transpose) {
  const key = rootPc + '/' + transpose + '/' + intervals.length + ':' + intervals[intervals.length - 1];
  if (ws.scaleKey === key) return;
  ws.scaleKey = key;
  ws.scalePcs.fill(0);
  for (let i = 0; i < intervals.length; i++) {
    ws.scalePcs[(((rootPc + intervals[i]) % 12) + 12) % 12] = 1;
  }
}

function mark(layer, pads, value) {
  for (let i = 0; i < pads.length; i++) {
    const idx = pads[i] - PAD_FIRST;
    if (idx >= 0 && idx < PAD_COUNT && layer[idx] < value) layer[idx] = value;
  }
}

/*
 * Fill `out` with a colour for each of the 32 pads.
 *
 * Priority, strongest first — a press must always win, because it is the one
 * thing the player just did and not seeing it feels broken:
 *
 *   flash      a judgement that just landed: green right, red wrong
 *   held       a pad under a finger
 *   sounding   Listen is playing this note (blue) — the point of that mode
 *   stuck      wait-mode is frozen on this note (pulsing white): "this one, now"
 *   target     guidance, ahead of time (blue, brighter as it nears)
 *   base       the key: root white, in-scale red, out of key dark
 *
 * `state` is plain data so this can be exercised without a Move:
 *   { transpose, rootPc, intervals, phase, now,
 *     heldPads, flashes,                     // maps keyed by pad number
 *     soundingPitches, stuckPitches, targetPitches, targetNear }
 */
export function padColors(state, ws, out) {
  const layer = ws.layer;
  layer.fill(NONE);

  refreshScale(ws, state.rootPc, state.intervals, state.transpose);

  if (state.soundingPitches) markPitches(layer, state.soundingPitches, state.transpose, SOUNDING);
  if (state.stuckPitches) markPitches(layer, state.stuckPitches, state.transpose, STUCK);
  if (state.targetPitches) {
    markPitches(layer, state.targetPitches, state.transpose,
      state.targetNear ? TARGET_NEAR : TARGET_FAR);
  }

  const flashes = state.flashes;
  const held = state.heldPads;
  const now = state.now;

  for (let pad = PAD_FIRST; pad <= PAD_LAST; pad++) {
    const idx = pad - PAD_FIRST;
    const flash = flashes && flashes[pad];
    if (flash && flash.untilMs > now) {
      out[idx] = flash.color;
      continue;
    }
    if (held && held[pad]) {
      out[idx] = LED_PRESSED;
      continue;
    }
    switch (layer[idx]) {
      case SOUNDING:
        out[idx] = LED_TARGET_NEAR;
        break;
      case STUCK:
        /* Pulsing: the music has stopped and is waiting for exactly this pad. */
        out[idx] = state.phase ? LED_ROOT : LED_OFF;
        break;
      case TARGET_NEAR:
        out[idx] = LED_TARGET_NEAR;
        break;
      case TARGET_FAR:
        out[idx] = LED_TARGET_FAR;
        break;
      default: {
        const pc = (((padPitch(pad, state.transpose) % 12) + 12) % 12);
        out[idx] = pc === (((state.rootPc % 12) + 12) % 12)
          ? LED_ROOT
          : (ws.scalePcs[pc] ? LED_SCALE : LED_OFF);
        break;
      }
    }
  }
  return out;
}

/* padsForPitch allocates, so it is only called for the handful of pitches that
 * are actually lit — never per pad. */
function markPitches(layer, pitches, transpose, value) {
  for (let i = 0; i < pitches.length; i++) {
    mark(layer, padsForPitch(pitches[i], transpose), value);
  }
}

export { NONE, SOUNDING, STUCK, TARGET_FAR, TARGET_NEAR };
