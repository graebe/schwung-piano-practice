// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * The preview and test font (tools/screen_buffer.mjs) holds every character
 * of the Move's own font, so a preview or a pixel test draws what the device
 * draws: "ROCK & POP", not "ROCK ? POP".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreen, DEVICE_CHARS, CHAR_W, CHAR_H } from '../tools/screen_buffer.mjs';

/* A character as drawn: its 5x7 cell, row by row. */
function glyph(ch) {
  const c = createScreen();
  c.text(0, 0, ch, 1);
  let rows = '';
  for (let y = 0; y < CHAR_H; y++) {
    for (let x = 0; x < CHAR_W; x++) rows += c.pixels[y * 128 + x] ? '#' : '.';
    rows += '\n';
  }
  return rows;
}

test('the device charlist is the Move\'s: printable ASCII and ÄÖÜäöü€†‡°', () => {
  assert.equal([...DEVICE_CHARS].length, 105);
  for (let code = 32; code < 127; code++) assert.ok(DEVICE_CHARS.includes(String.fromCharCode(code)), code);
  for (const ch of 'ÄÖÜäöü€†‡°') assert.ok(DEVICE_CHARS.includes(ch), ch);
});

test('every character of the device font draws as its own glyph, never as "?"', () => {
  const unknown = glyph('?');
  const seen = new Map();
  for (const ch of DEVICE_CHARS) {
    const g = glyph(ch);
    if (ch !== '?') assert.notEqual(g, unknown, `"${ch}" draws as "?"`);
    if (ch !== ' ') assert.ok(g.includes('#'), `"${ch}" draws nothing`);
    assert.ok(!g.split('\n').some((row) => row[5] === '#'), `"${ch}" runs into the next character`);
    assert.ok(!seen.has(g), `"${ch}" draws as "${seen.get(g)}"`);
    seen.set(g, ch);
  }
});

test('"ROCK & POP" draws its ampersand', () => {
  const c = createScreen();
  c.text(0, 0, 'ROCK & POP', 1);
  const amp = createScreen();
  amp.text(5 * CHAR_W, 0, '&', 1);
  for (let y = 0; y < CHAR_H; y++) {
    for (let x = 5 * CHAR_W; x < 6 * CHAR_W; x++) assert.equal(c.pixels[y * 128 + x], amp.pixels[y * 128 + x]);
  }
  assert.notEqual(glyph('&'), glyph('?'));
});
