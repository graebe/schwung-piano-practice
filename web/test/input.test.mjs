// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * input.test.mjs — the computer keyboard and MIDI, as notes and actions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { keyIntent, keyLabelFor, PIANO_KEYS, DEFAULT_OCTAVE_C, MIN_OCTAVE_C, MAX_OCTAVE_C } from '../src/input/keys.js';
import { decodeNote, isMoveName, connectMidi } from '../src/input/midi.js';
import { padPitch } from '../../src/padmap.mjs';

const key = (code, mods = {}) => ({ code, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...mods });

test('the home row is the white keys, from the octave\'s C', () => {
  const white = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'];
  assert.deepEqual(white.map((c) => keyIntent(key(c)).pitch), [60, 62, 64, 65, 67, 69, 71, 72]);
  const black = ['KeyW', 'KeyE', 'KeyT', 'KeyY', 'KeyU'];
  assert.deepEqual(black.map((c) => keyIntent(key(c)).pitch), [61, 63, 66, 68, 70]);
  assert.equal(keyIntent(key('KeyA'), 48).pitch, 48);
});

test('Z and X move the octave, within bounds', () => {
  assert.deepEqual(keyIntent(key('KeyZ')), { kind: 'octave', octaveC: 48 });
  assert.deepEqual(keyIntent(key('KeyX')), { kind: 'octave', octaveC: 72 });
  assert.equal(keyIntent(key('KeyZ'), MIN_OCTAVE_C).octaveC, MIN_OCTAVE_C);
  assert.equal(keyIntent(key('KeyX'), MAX_OCTAVE_C).octaveC, MAX_OCTAVE_C);
  assert.equal(keyIntent(key('Semicolon'), 120), null, 'past 127 plays nothing');
});

test('the Move\'s buttons, by meaning', () => {
  const act = (code, mods) => keyIntent(key(code, mods)).action;
  assert.deepEqual(act('Space'), { type: 'practice' });
  assert.deepEqual(act('Space', { shiftKey: true }), { type: 'listen' });
  assert.deepEqual(act('Enter'), { type: 'open' });
  assert.deepEqual(act('Enter', { shiftKey: true }), { type: 'skip' });
  assert.deepEqual(act('Escape'), { type: 'back' });
  assert.deepEqual(act('Backspace'), { type: 'back' });
  assert.deepEqual(act('ArrowDown'), { type: 'move', delta: 1 });
  assert.deepEqual(act('ArrowRight'), { type: 'move', delta: 1 });
  assert.deepEqual(act('ArrowUp'), { type: 'move', delta: -1 });
  assert.deepEqual(act('ArrowLeft'), { type: 'move', delta: -1 });
  assert.deepEqual(act('KeyI'), { type: 'info' });
  assert.deepEqual(act('Slash', { shiftKey: true }), { type: 'hint' });
  assert.equal(keyIntent(key('Slash')), null);
});

test('the browser keeps its own shortcuts, and Shift is not a note', () => {
  for (const mod of ['metaKey', 'ctrlKey', 'altKey']) assert.equal(keyIntent(key('KeyA', { [mod]: true })), null);
  assert.equal(keyIntent(key('KeyA', { shiftKey: true })), null);
  assert.equal(keyIntent(key('KeyQ')), null);
});

test('every key of the piano has a label', () => {
  for (const s of Object.values(PIANO_KEYS)) assert.ok(keyLabelFor(s));
  assert.equal(keyLabelFor(0), 'A');
  assert.equal(keyLabelFor(16), ';');
  assert.equal(keyLabelFor(99), null);
  assert.equal(DEFAULT_OCTAVE_C, 60);
});

test('MIDI: note-on, note-off, and note-on at velocity 0 as an off, on any channel', () => {
  assert.deepEqual(decodeNote([0x90, 60, 100]), { on: true, pitch: 60, vel: 100 });
  assert.deepEqual(decodeNote([0x95, 61, 30]), { on: true, pitch: 61, vel: 30 });
  assert.deepEqual(decodeNote([0x80, 60, 64]), { on: false, pitch: 60, vel: 0 });
  assert.deepEqual(decodeNote([0x90, 60, 0]), { on: false, pitch: 60, vel: 0 });
  assert.equal(decodeNote([0xb0, 64, 127]), null);
  assert.equal(decodeNote([0x90, 60]), null);
  assert.equal(decodeNote(null), null);
});

test('a Move\'s pads are read through the pad map, its other notes ignored', () => {
  assert.ok(isMoveName('Ableton Move'));
  assert.ok(!isMoveName('Keystep 37'));
  assert.ok(!isMoveName('Removal'));
  assert.deepEqual(decodeNote([0x90, 68, 90], { move: true }), { on: true, pitch: padPitch(68), vel: 90 });
  assert.equal(decodeNote([0x90, 68, 90], { move: true, transpose: 0 }).pitch, padPitch(68, 0));
  assert.equal(decodeNote([0x90, 5, 127], { move: true }), null, 'a knob touch is not a note');
});

test('without Web MIDI the page says so and carries on', async () => {
  assert.equal((await connectMidi({ onNote() {}, nav: {} })).available, false);
  const denied = await connectMidi({ onNote() {}, nav: { requestMIDIAccess: () => Promise.reject(new Error('no')) } });
  assert.equal(denied.available, false);
  assert.ok(denied.denied);
});

test('Web MIDI: every input plays, a Move is recognised, and a new one is bound', async () => {
  const inputs = new Map();
  const access = { inputs, onstatechange: null };
  const mk = (id, name) => ({ id, name, onmidimessage: null });
  inputs.set('a', mk('a', 'Keystep 37'));
  inputs.set('b', mk('b', 'Ableton Move'));
  const notes = [];
  let devices = [];
  const midi = await connectMidi({
    onNote: (n) => notes.push(n),
    onDevices: (d) => { devices = d; },
    nav: { requestMIDIAccess: async () => access },
  });
  assert.ok(midi.available);
  assert.deepEqual(devices.map((d) => d.move), [false, true]);
  inputs.get('a').onmidimessage({ data: [0x90, 64, 70] });
  inputs.get('b').onmidimessage({ data: [0x90, 70, 70] });
  assert.deepEqual(notes.map((n) => n.pitch), [64, padPitch(70)]);
  inputs.set('c', mk('c', 'Piano'));
  access.onstatechange();
  assert.equal(midi.devices.length, 3);
  inputs.get('c').onmidimessage({ data: [0x90, 50, 1] });
  assert.equal(notes.at(-1).pitch, 50);
  midi.close();
  assert.equal(inputs.get('a').onmidimessage, null);
  assert.equal(access.onstatechange, null);
});
