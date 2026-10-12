// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * fake_dsp.mjs — the piano DSP's page mailbox (dsp/piano/src/remote.rs) and
 * Schwung's web manager on the other side of it, in memory, on the test's clock.
 *
 * The DSP half keeps what remote.rs keeps — the picture, a rev, the actions
 * queued for ui.js, and when the picture was last read — and answers what it
 * answers. The manager half does what remote_ui.go does with an open Tool tab:
 * read the picture once on subscribe, and again whenever rev moves.
 */
export const WATCH_MS = 3000;   /* remote.rs: WATCH_BLOCKS */

export function fakeDsp(now) {
  let state = '';
  let rev = 0;
  let lastRead = -Infinity;
  let open = false;
  let seenRev = -1;
  const inbox = [];
  const pictures = [];

  const watched = () => now() - lastRead < WATCH_MS;

  function read() {
    lastRead = now();
    seenRev = rev;
    if (state) pictures.push(JSON.parse(state));
  }

  return {
    /* ui.js's side */
    set(key, val) {
      if (key === 'vm') { state = val; rev++; }
      else if (key === 'stale') rev++;
      if (open && rev !== seenRev) read();
    },
    get(key) {
      if (key !== 'inbox') return null;
      const lines = [watched() ? 'w' : '-', ...inbox.splice(0)];
      return lines.join('\n');
    },
    /* the page's side */
    openPage() { open = true; read(); },
    closePage() { open = false; },
    act(action) { inbox.push(JSON.stringify(action)); },
    /* what the page has been shown, decoded field by field */
    pictures,
    last() {
      const p = pictures[pictures.length - 1];
      if (!p) return null;
      const vm = {};
      for (const k of Object.keys(p)) vm[k] = JSON.parse(p[k]);
      return vm;
    },
    get rev() { return rev; },
  };
}
