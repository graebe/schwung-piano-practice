// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * midi.js — a MIDI keyboard, or a Move on a USB cable, as notes.
 *
 *   const midi = await connectMidi({ onNote, onDevices });
 *   midi.devices   [{ id, name, move }]
 *   midi.close()
 *
 * Web MIDI exists only in a secure context (https, or localhost) and only in
 * the browsers that ship it; where it does not, connectMidi answers
 * { available: false } and the page plays from the computer keyboard and the
 * screen.
 *
 * A MOVE SENDS ITS PADS, NOT PITCHES: pads 68-99 as note numbers, bottom-left
 * first. Played as pitches those would be G#4 up to D#7 in a row, which is not
 * the grid. So a device whose name says Move is read through the module's own
 * pad map — the same isomorphic layout, transposed the same way — and a pad
 * plays the note it plays on the Move.
 */
import { isPad, padPitch, DEFAULT_TRANSPOSE } from '../../../src/padmap.mjs';

export const isMoveName = (name) => /\bmove\b/i.test(String(name || ''));

/*
 * One MIDI message to a note event, or null. Channel is ignored: a keyboard is
 * a keyboard on any channel. Note-on at velocity 0 is a note-off, as the spec
 * says and as every keyboard sends.
 */
export function decodeNote(data, { move = false, transpose = DEFAULT_TRANSPOSE } = {}) {
  if (!data || data.length < 3) return null;
  const status = data[0] & 0xf0;
  if (status !== 0x90 && status !== 0x80) return null;
  let pitch = data[1];
  if (move) {
    if (!isPad(pitch)) return null;   /* knob touches and the like */
    pitch = padPitch(pitch, transpose);
  }
  if (pitch < 0 || pitch > 127) return null;
  const on = status === 0x90 && data[2] > 0;
  return { on, pitch, vel: on ? data[2] : 0 };
}

export async function connectMidi({ onNote, onDevices, transpose = () => DEFAULT_TRANSPOSE, nav = globalThis.navigator }) {
  if (!nav || typeof nav.requestMIDIAccess !== 'function' || globalThis.isSecureContext === false) {
    return { available: false, devices: [], close() {} };
  }
  let access;
  try {
    access = await nav.requestMIDIAccess({ sysex: false });
  } catch (e) {
    return { available: false, denied: true, devices: [], close() {} };
  }
  const bound = new Map();
  const state = { available: true, devices: [] };

  function bind() {
    state.devices = [];
    for (const input of access.inputs.values()) {
      const move = isMoveName(input.name);
      state.devices.push({ id: input.id, name: input.name, move });
      if (bound.get(input) === move) continue;
      bound.set(input, move);
      input.onmidimessage = (msg) => {
        const note = decodeNote(msg.data, { move, transpose: transpose() });
        if (note) onNote(note);
      };
    }
    if (onDevices) onDevices(state.devices);
  }

  bind();
  access.onstatechange = bind;
  return {
    get available() { return true; },
    get devices() { return state.devices; },
    close() {
      access.onstatechange = null;
      for (const input of bound.keys()) input.onmidimessage = null;
      bound.clear();
    },
  };
}
