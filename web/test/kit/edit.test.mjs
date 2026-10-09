// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
// From the neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/test/edit.test.mjs).
// Changed: the import paths, to web/src/kit/lib.
/*
 * An in-place edit ends once, and Escape abandons it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTextEdit } from '../../src/kit/lib/edit.js';

const run = (events) => {
  const log = [];
  const e = createTextEdit({ onCommit: (v) => log.push(`commit ${v}`), onClose: () => log.push('close') });
  for (const [kind, arg, value] of events) {
    if (kind === 'key') e.keyDown(arg, value); else e.blur(value);
  }
  return log;
};

/* THE BUG: removing the field on Escape fired blur, and blur committed. */
test('Escape, then the blur that removing the field causes, commits nothing', () => {
  assert.deepEqual(run([['key', 'Escape', '99'], ['blur', null, '99']]), ['close']);
});

test('Enter commits once even though a blur follows', () => {
  assert.deepEqual(run([['key', 'Enter', '40 ms'], ['blur', null, '40 ms']]), ['commit 40 ms', 'close']);
});

test('clicking away commits what was typed', () => {
  assert.deepEqual(run([['key', '4', '4'], ['blur', null, '4']]), ['commit 4', 'close']);
});

test('other keys do not end the edit', () => {
  const e = createTextEdit({});
  assert.equal(e.keyDown('a', 'a'), false);
  assert.equal(e.done, false);
  assert.equal(e.keyDown('Escape', 'a'), true);
  assert.equal(e.done, true);
});
