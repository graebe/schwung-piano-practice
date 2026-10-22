// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  welcomePages, tipCard, welcomeDue, TIP_KEYS, WELCOME, SHEET, PRACTICE, QUIZ, PLACEMENT,
} from '../src/tips.mjs';
import { emptyProgress, tipSeen, markTipSeen, clearTips, parseProgress, serialiseProgress } from '../src/progress.mjs';

const words = (page) => page.paragraphs.map((p) => p.text).join(' ');

test('the welcome is four pages, in the shared words', () => {
  const [one, lit, two, three] = welcomePages();
  assert.equal(one.title, 'Welcome');
  assert.equal(words(one), 'Piano Practice takes you from your first note to pro, one step a day.');
  assert.equal(lit.title, 'Welcome');
  assert.equal(words(lit), 'Lit pads can be pressed.', 'a page of its own: a welcome page never scrolls');
  assert.equal(two.title, 'Keys');
  assert.ok(two.lines, 'a table: its lines are kept');
  assert.deepEqual(two.paragraphs.map((p) => p.text),
    ['JOG   move', 'CLICK open', 'BACK  up one level', 'MENU  help, anywhere', 'SHIFT+CLICK  options']);
  assert.equal(three.title, 'New to piano?');
  assert.deepEqual(three.choices, ['From the start', 'I already play']);
  assert.equal(welcomePages('Drums Practice', 'drums', 'beat')[3].title, 'New to drums?');
  assert.match(words(welcomePages('Drums Practice', 'drums', 'beat')[0]), /from your first beat to pro/);
});

test('the tips, in the shared words', () => {
  assert.deepEqual(TIP_KEYS, [WELCOME, SHEET, PRACTICE, QUIZ]);
  assert.equal(words(tipCard(SHEET)), 'Options for this row. JOG choose, CLICK do it, BACK close.');
  assert.equal(words(tipCard(PRACTICE)), 'REC plays and scores it, PLAY lets you listen first. MENU: help.');
  assert.equal(words(tipCard(QUIZ)), 'Answer with the lit pads or the jog. MENU: help.');
  assert.equal(words(tipCard(PLACEMENT)),
    'Know a stage already? SHIFT+CLICK a stage, then Test out: checkpoint. Pass it and the path moves on.');
  assert.equal(tipCard('nothing'), null);
});

test('the welcome is due for somebody new, silent for a learner, never twice', () => {
  assert.equal(welcomeDue(false, false), 'show');
  assert.equal(welcomeDue(false, true), 'silent');
  assert.equal(welcomeDue(true, false), null);
  assert.equal(welcomeDue(true, true), null);
});

test('seen tips are a list in the progress file, kept, and cleared on request', () => {
  const p = emptyProgress();
  assert.equal(tipSeen(p, SHEET), false);
  markTipSeen(p, SHEET);
  markTipSeen(p, SHEET);
  assert.deepEqual(p.tips, [SHEET], 'once');
  const back = parseProgress(serialiseProgress(p));
  assert.ok(tipSeen(back, SHEET));
  clearTips(back);
  assert.equal(tipSeen(back, SHEET), false);
  assert.deepEqual(parseProgress(JSON.stringify({ tips: ['a', 'a', 3, 'b'] })).tips, ['a', 'b'], 'cleaned');
  assert.deepEqual(parseProgress(JSON.stringify({ tips: 'x' })).tips, []);
  const old = emptyProgress();
  delete old.tips;
  assert.equal(tipSeen(old, SHEET), false, 'a store from before tips');
  markTipSeen(old, SHEET);
  assert.deepEqual(old.tips, [SHEET]);
});
