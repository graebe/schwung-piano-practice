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
 * WHAT THE MOVE DOES FOR THIS (docs/schwung-web.md):
 *   - its DSP answers get_param("module_id") with "piano-practice", which is
 *     what makes Schwung offer this page at all
 *   - get_param("state") answers the view model encoded by encodeViewModel —
 *     one flat object, a JSON string per field, under 64KB
 *   - get_param("rui_poll") answers "rev:on:tick:bpm", so the manager reads
 *     `state` again only when rev moves
 *   - set_param("action", json) is queued for ui.js, which collects it and
 *     applies it with applyAction — the function the browser's own session uses
 *
 * Here: the bridge Schwung injects (window.schwungRemote, from
 * /static/schwung-remote-api.js) delivers each field as `overtake_dsp:<field>`
 * through onParamChange; actions go out through setParam. The bridge is passed
 * in, so a test drives this with a fake one.
 */
import { decodeViewModel } from '../../../src/view_model.mjs';
import { createPlayhead } from './clocksync.js';

const PREFIX = 'overtake_dsp:';

export function createSchwungSession({ bridge, now = () => performance.now() }) {
  const listeners = new Set();
  /* field -> { raw, value }: what arrived, and what it decoded to. */
  const fields = new Map();
  let vm = null;
  let unsubscribe = null;
  const playhead = createPlayhead();

  /*
   * ONLY WHAT CHANGED IS DECODED. Every picture carries every field, and a
   * field decoded afresh is a new object even when its text is the same --
   * so the chart, the bulk of the picture and the same piece for minutes at a
   * time, would be a new chart on every update, and the staff would rebuild
   * every note in it several times a second. A field whose text did not
   * change keeps the object it decoded to.
   */
  function rebuild(changed) {
    if (!changed.size && vm) return;
    const next = {};
    for (const [key, f] of fields) {
      if (changed.has(key)) f.value = decodeViewModel({ [key]: f.raw })[key];
      next[key] = f.value;
    }
    if (!next.clock) return;
    vm = next;
    if (changed.has('clock')) {
      const c = vm.clock;
      /* An older module's clock has no perBeatMs; its bpm says the same. */
      if (!(c.perBeatMs > 0) && c.bpm > 0) c.perBeatMs = 60000 / c.bpm;
      playhead.anchor(c, now());
    }
    for (const fn of listeners) fn(vm);
  }

  function onChange(changes) {
    const changed = new Set();
    for (const [key, value] of Object.entries(changes)) {
      if (!key.startsWith(PREFIX)) continue;
      const name = key.slice(PREFIX.length);
      const raw = String(value);
      const f = fields.get(name);
      if (f && f.raw === raw) continue;
      fields.set(name, { raw, value: undefined });
      changed.add(name);
    }
    if (changed.size) rebuild(changed);
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
     * updates the playhead is carried forward -- from the Move's own time,
     * at the Move's tempo, never past where it waits for a note, and with a
     * correction eased in rather than stepped (clocksync.js).
     */
    clock() {
      if (!vm || !vm.clock) return null;
      const beats = playhead.at(now());
      return beats === vm.clock.beats ? vm.clock : { ...vm.clock, beats };
    },
    dispatch(action) {
      bridge.setParam(PREFIX + 'action', JSON.stringify(action));
      return null;
    },
  };
}
