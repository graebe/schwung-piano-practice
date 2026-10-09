// Copied from neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/src/lib/drag.js), MIT, Torben Gräber.
/*
 * One drag gesture, tracked on the window.
 * Copyright (c) 2026 Torben Gräber. MIT.
 *
 * LISTENERS GO ON THE WINDOW, NOT THE ELEMENT, and that is the whole reason
 * this file exists. Both the knob and the pads attached `pointermove` to the
 * element under the cursor, so a drag stopped tracking the moment the pointer
 * left the 48px knob or the 40px pad -- which reads as "it didn't take until
 * I clicked again", because the next press starts a fresh gesture that does
 * work for its first few pixels.
 *
 * `setPointerCapture` is the other half of the same trap: it is fine when it
 * works and silent when it does not. A window listener needs neither.
 */

/**
 * Begin a drag. `onMove(ev)` is called for every move until the pointer is
 * released anywhere; `onEnd()` once, always — including when the pointer is
 * cancelled by the system, which is the case that otherwise leaves a control
 * stuck in a gesture forever.
 */
export function startDrag(onMove, onEnd) {
  const move = (ev) => onMove(ev);
  const end = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    onEnd?.();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  return end;
}
