// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * pads.test.mjs -- what each pad shows (web/src/music/pads.js), and the
 * pointer logic the keyboard and the pads share (play-pointer.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { padRows, padViews, keyState, ROWS, COLS } from '../src/music/pads.js';
import { createPlayPointer } from '../src/music/play-pointer.js';
import { PAD_FIRST, padPitch } from '../../src/padmap.mjs';
import { answerPads } from '../../src/answer_pads.mjs';

test('rows run top to bottom as the player sees them, pad 68 bottom left', () => {
  const rows = padRows();
  assert.equal(rows.length, ROWS);
  assert.ok(rows.every((r) => r.length === COLS));
  assert.equal(rows.at(-1)[0], PAD_FIRST);
  assert.equal(rows[0].at(-1), PAD_FIRST + 31);
  assert.deepEqual(padViews().map((v) => v.pad), rows.flat());
});

test('the grid is the engine\'s: a semitone right, five up, transposed', () => {
  const views = padViews({ transpose: 12 });
  const at = (pad) => views.find((v) => v.pad === pad);
  assert.equal(at(68).pitch, padPitch(68, 12));
  assert.equal(at(69).pitch - at(68).pitch, 1);
  assert.equal(at(76).pitch - at(68).pitch, 5);
  assert.equal(padViews({ transpose: 0 })[24].pitch, padPitch(68, 0));
});

test('the key: root, scale and out of key; no root, no colouring', () => {
  const views = padViews({ rootPc: 0 });
  for (const v of views) {
    const pc = v.pitch % 12;
    const want = pc === 0 ? 'root' : [2, 4, 5, 7, 9, 11].includes(pc) ? 'scale' : 'off';
    assert.equal(v.state, want, `${v.pitch}`);
  }
  assert.ok(padViews().every((v) => v.state === 'off'));
  assert.equal(keyState(68, 12, 9, [0, 2, 3, 5, 7, 8, 10]), 'root', 'A minor: pad 68 is A3');
});

test('note states outrank the key and light every twin', () => {
  const pitch = padPitch(73, 12);
  const views = padViews({ rootPc: 0, states: new Map([[pitch, 'now']]) });
  const lit = views.filter((v) => v.state === 'now');
  assert.ok(lit.length >= 2, 'a pitch on several pads lights them all');
  assert.ok(lit.every((v) => v.pitch === pitch));
  const obj = padViews({ states: { [pitch]: 'miss' } });
  assert.ok(obj.some((v) => v.state === 'miss'));
  const junk = padViews({ rootPc: 0, states: { [pitch]: 'sparkle' } });
  assert.ok(!junk.some((v) => v.state === 'sparkle'), 'an unknown state falls back to the key');
});

test('the answer bar: its pads in their colours, struck dark, the gaps inert', () => {
  const answers = [{ label: 'Major 3rd', key: 'M3' }, { label: 'Minor 3rd' }, { label: 'Fifth', struck: true }];
  const views = padViews({ rootPc: 0, answers, states: { [padPitch(PAD_FIRST, 12)]: 'now' } });
  const bar = views.filter((v) => v.pad < PAD_FIRST + 8);
  assert.ok(bar.every((v) => v.inert), 'the bottom row plays no notes');
  const shown = bar.filter((v) => v.answer).map((v) => v.pad);
  assert.deepEqual(shown, answerPads(3));
  const first = bar.find((v) => v.pad === answerPads(3)[0]);
  assert.equal(first.state, 'answer');
  assert.equal(first.answer.colour, 'blue');
  assert.equal(first.answer.key, 'M3');
  assert.equal(bar.find((v) => v.pad === answerPads(3)[2]).state, 'struck');
  assert.ok(bar.filter((v) => !v.answer).every((v) => v.state === 'off'));
  assert.ok(views.filter((v) => v.pad >= PAD_FIRST + 8).every((v) => !v.inert));
  const nine = padViews({ answers: Array.from({ length: 9 }, () => ({ label: 'x' })) });
  assert.equal(nine.filter((v) => v.inert).length, 16, 'two rows past eight answers');
});

/* ------------------------------------------------------ play-pointer -- */

function harness(map) {
  const log = [];
  const p = createPlayPointer({
    find: (x) => map[x] ?? null,
    on: (t) => log.push(`on ${t.note}`),
    off: (t) => log.push(`off ${t.note}`),
  });
  const ev = (pointerId, x, extra = {}) => ({
    pointerId, clientX: x, clientY: 0, button: 0, preventDefault() {}, currentTarget: { setPointerCapture() {} }, ...extra,
  });
  return { p, log, ev };
}

test('a press plays what is under it and the release lets it go', () => {
  const { p, log, ev } = harness({ 1: { note: 60, velocity: 90 } });
  p.handlers.onPointerDown(ev(1, 1));
  assert.equal(p.isHeld(60), true);
  p.handlers.onPointerUp(ev(1, 1));
  p.handlers.onLostPointerCapture(ev(1, 1));
  assert.deepEqual(log, ['on 60', 'off 60']);
  assert.equal(p.isHeld(60), false);
});

test('a drag slides from note to note, over gaps, releasing each', () => {
  const { p, log, ev } = harness({ 1: { note: 60 }, 2: { note: 62 }, 4: { note: 64 } });
  p.handlers.onPointerDown(ev(1, 1));
  p.handlers.onPointerMove(ev(1, 1));
  p.handlers.onPointerMove(ev(1, 2));
  p.handlers.onPointerMove(ev(1, 3));
  p.handlers.onPointerMove(ev(1, 4));
  p.handlers.onPointerCancel(ev(1, 4));
  assert.deepEqual(log, ['on 60', 'off 60', 'on 62', 'off 62', 'on 64', 'off 64']);
  p.handlers.onPointerMove(ev(1, 1));
  assert.equal(log.length, 6, 'a move with no finger down does nothing');
});

test('two fingers on one note: released with the last', () => {
  const { p, log, ev } = harness({ 1: { note: 60 }, 2: { note: 60 } });
  p.handlers.onPointerDown(ev(1, 1));
  p.handlers.onPointerDown(ev(2, 2));
  p.handlers.onPointerUp(ev(1, 1));
  assert.deepEqual(log, ['on 60']);
  p.handlers.onPointerUp(ev(2, 2));
  assert.deepEqual(log, ['on 60', 'off 60']);
});

test('other buttons are ignored; the computer keyboard counts with the fingers; releaseAll lets go', () => {
  const { p, log, ev } = harness({ 1: { note: 60 } });
  p.handlers.onPointerDown(ev(1, 1, { button: 2 }));
  assert.deepEqual(log, []);
  p.press({ note: 67 });
  p.handlers.onPointerDown(ev(1, 1));
  p.press(null);
  p.release(null);
  p.releaseAll();
  assert.deepEqual(log.sort(), ['off 60', 'off 67', 'on 60', 'on 67']);
  assert.equal(p.isHeld(60), false);
  p.release({ note: 60 });
  assert.equal(log.length, 4);
});
