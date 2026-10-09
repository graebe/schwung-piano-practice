// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
// From the neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/src/lib/edit.js).
/*
 * One edit of a text field: it ends exactly once, and Escape means no.
 *
 * THE BUG IT EXISTS FOR. The knob's readout and the pads' arrival numbers
 * closed their field on Escape -- and removing a focused input fires `blur`,
 * whose handler committed. So Escape committed anyway, and Enter could commit
 * twice. Listen-In's name field already had this right; this is its rule, once,
 * for every field that edits in place.
 */

/**
 * `onCommit(value)` for Enter or blur, nothing for Escape; `onClose()` either
 * way, once. Whatever arrives after the first ending is ignored.
 */
export function createTextEdit({ onCommit, onClose }) {
  let done = false;
  const finish = (value, commit) => {
    if (done) return;
    done = true;
    if (commit) onCommit?.(value);
    onClose?.();
  };
  return {
    /** Returns true when the key ended the edit. */
    keyDown(key, value) {
      if (key === 'Enter') finish(value, true);
      else if (key === 'Escape') finish(value, false);
      else return false;
      return true;
    },
    blur(value) { finish(value, true); },
    get done() { return done; },
  };
}
