// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * store.js — the page's state: the session's view model as a signal, what the
 * player's hands are doing, and the momentary feedback a press earns.
 *
 * The view model is the session's (src/view_model.mjs) and is replaced, never
 * edited. What is added here is only what a page knows and a session does not:
 * which keys are down under the player's fingers right now, and for a moment
 * after each press whether it was right — the same flash the Move gives its
 * pads.
 */
import { createSignal, batch } from 'solid-js';
import { feedbackFor, keyStates, padStates, FLASH_MS } from './feedback.js';

export function createStore(backend, { now = () => performance.now(), later = setTimeout } = {}) {
  const [vm, setVm] = createSignal(backend.viewModel, { equals: false });
  const [held, setHeld] = createSignal(new Set(), { equals: false });
  const [flash, setFlash] = createSignal(new Map(), { equals: false });
  backend.subscribe(setVm);

  function flashPitches(entries) {
    if (!entries.length) return;
    const until = now() + FLASH_MS;
    const map = flash();
    for (const [pitch, state] of entries) map.set(pitch, { state, until });
    setFlash(map);
    later(() => {
      const t = now();
      const m = flash();
      let changed = false;
      for (const [p, f] of m) if (f.until <= t) { m.delete(p); changed = true; }
      if (changed) setFlash(m);
    }, FLASH_MS + 10);
  }

  return {
    vm,
    held,
    flash,
    backend,
    clock: () => backend.clock(),
    dispatch: (action) => backend.dispatch(action),
    noteOn(pitch, vel = 100) {
      batch(() => {
        const h = held();
        h.add(pitch);
        setHeld(h);
        const out = backend.dispatch({ type: 'noteOn', pitch, vel });
        flashPitches(feedbackFor(out, pitch, vm()));
      });
    },
    noteOff(pitch) {
      const h = held();
      if (!h.delete(pitch)) return;
      setHeld(h);
      backend.dispatch({ type: 'noteOff', pitch });
    },
    /* Everything let go at once: a lost focus must not leave a key down. */
    releaseAll() {
      for (const pitch of [...held()]) this.noteOff(pitch);
    },
    keyStates: () => keyStates(vm(), held(), flash()),
    padStates: () => padStates(vm(), held(), flash()),
  };
}
