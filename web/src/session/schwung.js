// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * schwung.js — watching and steering the session that runs ON A MOVE, from the
 * module's page in Schwung's web manager (move.local:7700 › Remote UI › Tool).
 *
 * The same interface as local.js, so the page does not know which it has:
 *
 *   subscribe(fn)   a view model whenever the Move's changes
 *   clock()         the playhead, extrapolated between updates
 *   dispatch(a)     an action (src/actions.mjs), applied by ui.js on the Move
 *
 * WHAT THE MOVE MUST DO FOR THIS (docs/schwung-web.md; not built yet):
 *   - its DSP answers get_param("module_id") with "piano-practice", which is
 *     what makes Schwung offer this page at all
 *   - get_param("state") answers the view model encoded by encodeViewModel —
 *     one flat object, a JSON string per field, under 64KB
 *   - get_param("rui_poll") answers "rev:on:tick:bpm", so the manager reads
 *     `state` again only when rev moves
 *   - set_param("action", json) is handed to ui.js, which applies it with
 *     applyAction — the same function the browser's own session uses
 *
 * Here: the bridge Schwung injects (window.schwungRemote, from
 * /static/schwung-remote-api.js) delivers each field as `overtake_dsp:<field>`
 * through onParamChange; actions go out through setParam. The bridge is passed
 * in, so a test drives this with a fake one.
 */
import { decodeViewModel } from '../../../src/view_model.mjs';

const PREFIX = 'overtake_dsp:';

export function createSchwungSession({ bridge, now = () => performance.now() }) {
  const listeners = new Set();
  const fields = {};
  let vm = null;
  let clockAt = 0;
  let unsubscribe = null;

  function rebuild() {
    vm = decodeViewModel(fields);
    if (!vm.clock) return;
    clockAt = now();
    for (const fn of listeners) fn(vm);
  }

  function onChange(changes) {
    let touched = false;
    for (const [key, value] of Object.entries(changes)) {
      if (!key.startsWith(PREFIX)) continue;
      fields[key.slice(PREFIX.length)] = String(value);
      touched = true;
    }
    if (touched) rebuild();
  }

  return {
    kind: 'schwung',
    /* The Move makes the sound and reads its own pads; the page only shows. */
    capabilities: { audio: false, notes: true, files: false },
    start() {
      const off = bridge.onParamChange(onChange);
      unsubscribe = typeof off === 'function' ? off : null;
    },
    stop() {
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
    },
    tick() {},
    subscribe(fn) {
      listeners.add(fn);
      if (vm) fn(vm);
      return () => listeners.delete(fn);
    },
    get viewModel() {
      return vm;
    },
    /*
     * The Move sends its clock only when the picture changes, so between
     * updates the playhead is carried forward at the tempo — unless it is
     * standing still: paused, waiting on a note, or not running at all.
     */
    clock() {
      if (!vm || !vm.clock) return null;
      const c = vm.clock;
      if (!c.running || c.paused || c.blocked) return c;
      const beats = c.beats + ((now() - clockAt) * c.bpm) / 60000;
      return { ...c, beats };
    },
    dispatch(action) {
      bridge.setParam(PREFIX + 'action', JSON.stringify(action));
      return null;
    },
  };
}
