// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * play-pointer.js -- pressing notes with pointers, for the keyboard and the
 * pads alike.
 *
 * One pointer is one finger: it presses what is under it, and while it stays
 * down and moves it slides from note to note -- a glissando -- releasing each
 * as it leaves. The pointer is CAPTURED on the press, so a finger that slides
 * off the instrument still lets go of its note when it lifts, and a cancel
 * (the system taking the touch for a scroll) releases it too.
 *
 * NOTES ARE COUNTED, NOT FLAGGED. Two fingers can hold one pitch -- the pads
 * repeat every pitch on several pads -- and the pitch is released when the
 * last of them lets go, not the first.
 *
 * `find(clientX, clientY)` says what is under a point: { note, velocity,
 * ...anything the caller wants back } or null. `on(target)` and `off(target)`
 * are told about each note once per change of its count between 0 and 1.
 */
export function createPlayPointer({ find, on, off }) {
  const fingers = new Map();  // pointerId -> target under it, or null
  const held = new Map();     // note -> { count, target }: how many hold it, and the first

  const press = (t) => {
    if (!t) return;
    const h = held.get(t.note);
    if (h) {
      h.count++;
      return;
    }
    held.set(t.note, { count: 1, target: t });
    on(t);
  };
  const release = (t) => {
    const h = t && held.get(t.note);
    if (!h) return;
    if (--h.count > 0) return;
    held.delete(t.note);
    off(h.target);
  };

  const down = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget?.setPointerCapture?.(e.pointerId);
    const t = find(e.clientX, e.clientY);
    fingers.set(e.pointerId, t);
    press(t);
  };
  const move = (e) => {
    if (!fingers.has(e.pointerId)) return;
    const was = fingers.get(e.pointerId);
    const t = find(e.clientX, e.clientY);
    if ((was?.note ?? null) === (t?.note ?? null)) return;
    fingers.set(e.pointerId, t);
    release(was);
    press(t);
  };
  const up = (e) => {
    if (!fingers.has(e.pointerId)) return;
    release(fingers.get(e.pointerId));
    fingers.delete(e.pointerId);
  };

  return {
    handlers: {
      onPointerDown: down,
      onPointerMove: move,
      onPointerUp: up,
      onPointerCancel: up,
      onLostPointerCapture: up,
    },
    /** A press and a release from elsewhere -- the computer keyboard -- counted
     *  with the fingers. */
    press,
    release,
    /** Let go of everything: the instrument is going away or turning off. */
    releaseAll() {
      fingers.clear();
      for (const h of [...held.values()]) off(h.target);
      held.clear();
    },
    /** Whether a note is held by any finger. */
    isHeld: (note) => held.has(note),
  };
}
