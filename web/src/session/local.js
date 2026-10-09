// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * local.js — practising in the browser itself: the module's own session, run
 * beside the page.
 *
 *   const backend = createLocalSession({ piano, storage, exercises });
 *   backend.subscribe((vm) => ...);   // a new view model whenever it changes
 *   backend.clock();                   // the playhead, read every frame
 *   backend.dispatch({ type: 'open' });
 *   backend.start(); ... backend.stop();
 *
 * The session is session.mjs, the same file the Move runs. What this adds is
 * a host for it: a clock, a piano, files, a voice.
 *
 *   time       performance.now(); the session ticks every 4ms, apart from the
 *              page's 60Hz drawing, so the click and the reference line land
 *              in time rather than on frame boundaries
 *   sound      the piano engine (web/src/audio) — the Move's engine as wasm
 *   files      settings, stats and progress in localStorage; the exercises
 *              bundled with the page
 *   announce   kept as `announcement` in the view model for an aria-live region
 *
 * Everything here takes its browser parts as arguments, so a test can drive it
 * with a fake clock and no audio at all.
 */
import { createSession } from '../../../src/session.mjs';
import { viewModel, clockOf } from '../../../src/view_model.mjs';
import { applyAction } from '../../../src/actions.mjs';

const KEY = 'piano-practice:';
const TICK_MS = 4;
/* A browser lane shows several beats of what was just played. */
const KEEP_MARKERS_BEATS = 12;

export function createLocalSession({
  piano,
  storage = null,
  exercises = {},
  now = () => performance.now(),
  wallNow = () => Date.now(),
  setTimer = (fn, ms) => setInterval(fn, ms),
  clearTimer = (id) => clearInterval(id),
  plot = { w: 320, h: 120 },
} = {}) {
  const listeners = new Set();
  /* Pitches revealed as the answer (a heard interval, a named pad), with when
   * the reveal ends: the keyboard shows them, as the Move flashes its pads. */
  const revealed = new Map();
  let announcement = '';
  let announced = 0;
  let rev = 0;
  let timer = null;
  let vm = null;

  const fx = {
    now,
    wallNow,
    strike: (pitch, vel) => piano && piano.strike(pitch, vel),
    release: (pitch) => piano && piano.release(pitch),
    silence: () => piano && piano.silence(),
    announce(text) {
      announcement = text;
      announced++;
    },
    readText(name) {
      if (name.startsWith('exercises/')) return exercises[name.slice(10)] ?? null;
      try {
        return storage ? storage.getItem(KEY + name) : null;
      } catch (e) {
        return null;
      }
    },
    writeText(name, text) {
      try {
        if (storage) storage.setItem(KEY + name, text);
        return true;
      } catch (e) {
        return false;      /* private mode, or full: practise anyway */
      }
    },
    /* The page has nowhere to exit to; the top of the list is home. */
    exit() {},
    settingChanged() {},
    reveal(pitches, ms) {
      const until = now() + ms;
      for (const p of pitches) revealed.set(p, until);
    },
  };

  const session = createSession(fx, { keepMarkersBeats: KEEP_MARKERS_BEATS });

  function snapshot() {
    const t = now();
    for (const [p, until] of revealed) if (until <= t) revealed.delete(p);
    vm = {
      ...viewModel(session, { plotW: plot.w, plotH: plot.h }),
      revealed: [...revealed.keys()],
      announcement: { text: announcement, n: announced },
      rev,
    };
    return vm;
  }

  function publish() {
    rev++;
    const next = snapshot();
    for (const fn of listeners) fn(next);
  }

  /*
   * The session marks itself dirty whenever there is something new to show.
   * While a run is moving that is every tick — the panel redraws the scroll —
   * but the page draws the scroll from clock() each frame, so it republishes
   * only when the picture changes, not when the playhead does.
   */
  let lastShape = '';
  function shapeOf() {
    const run = session.run;
    return [
      session.view, session.blocked, session.paused, session.listening, session.stage,
      run ? run.hits + ':' + run.misses + ':' + run.strays + ':' + run.markers.length + ':' + run.cursor : '',
      revealed.size, announced, session.quiz ? session.quiz.hint + ':' + session.quiz.solved : '',
      Math.floor(session.songBeats < 0 ? session.songBeats : 0),
    ].join('|');
  }

  /* Sounding notes light the keyboard while listening: the cue changes with
   * every note, so a listening run republishes as often as notes change. */
  function soundingKey() {
    session.collectSounding();
    return session.soundingBuf.join(',');
  }

  function frame() {
    session.tick(now());
    session.flushSettings(false);
    if (!session.dirty && !session.ledDirty) return;
    session.ledDirty = false;
    session.dirty = false;
    const key = shapeOf() + '#' + soundingKey();
    if (key !== lastShape) {
      lastShape = key;
      publish();
    }
  }

  return {
    kind: 'local',
    session,
    capabilities: { audio: Boolean(piano && piano.state !== 'unavailable'), notes: true, files: Boolean(storage) },
    start() {
      session.init();
      fx.announce('Piano Practice. Pick an exercise.');
      publish();
      if (timer === null) timer = setTimer(frame, TICK_MS);
    },
    stop() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      session.silence();
      session.flushSettings(true);
    },
    /* Run one tick now: for tests, and for a hidden tab's catch-up. */
    tick: frame,
    subscribe(fn) {
      listeners.add(fn);
      if (vm) fn(vm);
      return () => listeners.delete(fn);
    },
    get viewModel() {
      return vm;
    },
    clock: () => clockOf(session),
    dispatch(action) {
      const out = applyAction(session, action);
      /* Anything an action changes is shown at once, not on the next tick. */
      session.dirty = false;
      session.ledDirty = false;
      lastShape = shapeOf() + '#' + soundingKey();
      publish();
      return out;
    },
  };
}

/*
 * The exercises as the page bundles them: Vite reads every file in
 * src/exercises at build time, keyed as the session asks for them.
 */
export function bundleExercises(globbed) {
  const out = {};
  for (const [path, text] of Object.entries(globbed)) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    out[name] = typeof text === 'string' ? text : text.default;
  }
  return out;
}
