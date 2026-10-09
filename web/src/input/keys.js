// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * keys.js — the computer keyboard as a piano, and as the Move's buttons. Pure.
 *
 * The home row is the white keys and the row above it the black ones, the
 * layout every software instrument uses, so a hand that has used one finds
 * this one:
 *
 *      W E   T Y U   O P
 *     A S D F G H J K L ;        C D E F G A B C D E   from the octave's C
 *
 * Z and X move the octave down and up. Everything else is the Move's buttons
 * by what they mean: Space practises (Record), Shift+Space listens (Play),
 * Enter opens (the jog's click), Escape is Back, the arrows are the jog, I is
 * Info (Menu), and ? is a quiz's help.
 *
 * Keys are read by `code`, the key's place on the board, not by the letter it
 * prints — so the piano keeps its shape on an AZERTY or a Dvorak keyboard.
 */

/* Semitones above the octave's C, by key position. */
export const PIANO_KEYS = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7,
  KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15,
  Semicolon: 16,
};

export const DEFAULT_OCTAVE_C = 60;   /* middle C under A */
export const MIN_OCTAVE_C = 24;
export const MAX_OCTAVE_C = 96;

/*
 * What a key press means: a note, an octave change, an action for the
 * session, or nothing (null). Modifier keys other than Shift are left alone,
 * so the browser's own shortcuts keep working.
 */
export function keyIntent(e, octaveC = DEFAULT_OCTAVE_C) {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.code in PIANO_KEYS && !e.shiftKey) {
    const pitch = octaveC + PIANO_KEYS[e.code];
    return pitch <= 127 ? { kind: 'note', pitch } : null;
  }
  switch (e.code) {
    case 'KeyZ': return { kind: 'octave', octaveC: Math.max(MIN_OCTAVE_C, octaveC - 12) };
    case 'KeyX': return { kind: 'octave', octaveC: Math.min(MAX_OCTAVE_C, octaveC + 12) };
    case 'Space': return { kind: 'action', action: { type: e.shiftKey ? 'listen' : 'practice' } };
    case 'Enter': return { kind: 'action', action: { type: e.shiftKey ? 'skip' : 'open' } };
    case 'Escape':
    case 'Backspace': return { kind: 'action', action: { type: 'back' } };
    case 'ArrowDown':
    case 'ArrowRight': return { kind: 'action', action: { type: 'move', delta: 1 } };
    case 'ArrowUp':
    case 'ArrowLeft': return { kind: 'action', action: { type: 'move', delta: -1 } };
    case 'KeyI': return { kind: 'action', action: { type: 'info' } };
    case 'Slash': return e.shiftKey ? { kind: 'action', action: { type: 'hint' } } : null;
    default: return null;
  }
}

/* The label a key carries on screen, by semitone above the octave's C. */
export function keyLabelFor(semitone) {
  for (const [code, s] of Object.entries(PIANO_KEYS)) {
    if (s === semitone) return code === 'Semicolon' ? ';' : code.slice(3);
  }
  return null;
}
