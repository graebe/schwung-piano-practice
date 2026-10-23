// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * The chord trainer in the session: its ring, a circle's setup on the
 * Settings page, a round from Start, the result's next, the Back chain, a
 * setup remembered, Stats weakest first, and a round opened by its id.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { fakeHost, openPath } from './support/fake_host.mjs';
import { MENU, SETTINGS, GUESS_VIEW, RESULT_VIEW, INFO_VIEW, TRAINER_STATS } from '../src/session.mjs';

function start() {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Practice', 'Chords']);
  return h;
}
const S = (h) => h.session;
const row = (h, label) => S(h).settingsRows().findIndex((r) => r.label === label);

/* Answer every prompt right, by name or by playing it, until the round ends. */
function playRound(h, wrongFirst = () => false) {
  for (let i = 0; i < 200 && S(h).view === GUESS_VIEW; i++) {
    const q = S(h).quiz;
    if (q.solved) { h.run(100); continue; }
    if (q.kind === 'ear') {
      const right = q.choices.findIndex((c) => c.key === q.entry.answer);
      if (wrongFirst(q) && !q.missed) S(h).answer((right + 1) % q.choices.length);
      S(h).answer(right);
    } else {
      for (const p of q.prompt) S(h).play(p, 100);
      for (const p of q.prompt) S(h).release(p);
    }
    h.run(1600);
  }
  for (let i = 0; i < 40 && S(h).view !== RESULT_VIEW; i++) { S(h).activate(false); h.run(100); }
}

test('Practice › Chords is a ring of the five circles', () => {
  const h = start();
  const ring = S(h).nav[S(h).nav.length - 1].node;
  assert.deepEqual(ring.children.map((c) => c.label), ['Read', 'Hear', 'Play', 'Learn', 'Stats']);
  assert.deepEqual(ring.children.map((c) => c.icon), ['staff', 'ear', 'keyletter', 'book', 'progress']);
  assert.ok(S(h).onHome(), 'drawn as circles');
  openPath(S(h), ['Learn']);
  assert.equal(S(h).listTitle(), 'Chords: learn');
  assert.equal(S(h).nav[S(h).nav.length - 1].node.children[0].label, 'Triads');
});

test('a circle opens its setup on Start; Start runs a round; next is another', () => {
  const h = start();
  openPath(S(h), ['Read']);
  assert.equal(S(h).view, SETTINGS);
  assert.equal(S(h).settingsTitle(), 'Chords Read');
  const rows = S(h).settingsRows();
  assert.equal(S(h).settingsCursor, rows.length - 1);
  assert.equal(rows[rows.length - 1].act, 'start');
  S(h).activate(false);
  assert.equal(S(h).view, GUESS_VIEW);
  assert.equal(S(h).quizTitle(), 'CHORDS READ');
  playRound(h);
  assert.equal(S(h).view, RESULT_VIEW);
  assert.equal(S(h).lastResult.drill, 'chord:read:play:L1');
  assert.ok(S(h).progress.items['quiz:chord:read:play:L1'], 'filed under the trainer id');
  S(h).activate(false);
  assert.equal(S(h).view, GUESS_VIEW, 'the result\'s next is another round, as set up');
  assert.equal(S(h).quizTitle(), 'CHORDS READ');
});

test('Back: the round to its setup, the setup to the ring, the ring to Practice', () => {
  const h = start();
  openPath(S(h), ['Hear']);
  S(h).activate(false);
  assert.equal(S(h).view, GUESS_VIEW);
  S(h).back();
  assert.equal(S(h).view, SETTINGS);
  assert.equal(S(h).settingsTitle(), 'Chords Hear');
  S(h).back();
  assert.equal(S(h).view, MENU);
  assert.equal(S(h).nav[S(h).nav.length - 1].node.label, 'Chords');
  S(h).back();
  assert.equal(S(h).nav[S(h).nav.length - 1].node.label, 'Practice');
});

test('a setup is remembered per circle, and kept in the progress file', () => {
  const h = start();
  openPath(S(h), ['Play']);
  S(h).selectSettingRow(row(h, 'Level'));
  S(h).editRow(row(h, 'Level'), 1);
  S(h).editRow(row(h, 'Level'), 1);
  S(h).back();
  openPath(S(h), ['Play']);
  assert.equal(S(h).settingsRows()[row(h, 'Level')].value, '3 + dim aug');
  openPath(S(h), []);
  S(h).back();
  openPath(S(h), ['Read']);
  assert.equal(S(h).settingsRows()[row(h, 'Level')].value, '1 major', 'Read has its own');
  const saved = JSON.parse(h.files.get('progress.json'));
  assert.equal(saved.trainers.chord.play.level, 3);
});

test('Custom: the tick list, its row, and a round of only the picked', () => {
  const h = start();
  openPath(S(h), ['Read']);
  S(h).selectSettingRow(row(h, 'Level'));
  for (let i = 0; i < 12; i++) S(h).editRow(row(h, 'Level'), 1);
  const at = row(h, 'Chords');
  assert.equal(S(h).settingsRows()[at].act, 'custom');
  S(h).selectSettingRow(at);
  S(h).activate(false);
  assert.equal(S(h).settingsTitle(), 'Chords custom');
  const ticks = S(h).settingsRows();
  S(h).selectSettingRow(ticks.findIndex((r) => r.item === 'm7'));
  S(h).activate(false);
  S(h).selectSettingRow(ticks.findIndex((r) => r.item === 'dim'));
  S(h).activate(false);
  S(h).back();
  assert.equal(S(h).settingsTitle(), 'Chords Read');
  assert.equal(S(h).settingsRows()[S(h).settingsCursor].act, 'custom', 'back on the row that opened it');
  S(h).selectSettingRow(S(h).settingsRows().length - 1);
  S(h).activate(false);
  const kinds = new Set(S(h).quiz.pool.map((e) => e.qualityId));
  assert.deepEqual([...kinds].sort(), ['dim', 'm7']);
});

test('an empty Custom pick does not start', () => {
  const h = start();
  openPath(S(h), ['Read']);
  S(h).selectSettingRow(row(h, 'Level'));
  for (let i = 0; i < 12; i++) S(h).editRow(row(h, 'Level'), 1);
  S(h).selectSettingRow(S(h).settingsRows().length - 1);
  S(h).activate(false);
  assert.equal(S(h).view, SETTINGS);
  assert.ok(h.said().some((t) => /Pick something first/.test(t)));
});

test('Stats: weakest first, a row\'s detail, Back to the ring', () => {
  const h = start();
  openPath(S(h), ['Hear']);
  S(h).selectSettingRow(row(h, 'Answer'));
  S(h).editRow(row(h, 'Answer'), 1);
  S(h).selectSettingRow(S(h).settingsRows().length - 1);
  S(h).activate(false);
  /* Miss every minor chord once. */
  playRound(h, (q) => q.entry.answer === 'min');
  assert.equal(S(h).view, RESULT_VIEW);
  S(h).back(); S(h).back();
  if (S(h).view === GUESS_VIEW) S(h).back();
  if (S(h).view === SETTINGS) S(h).back();
  openPath(S(h), ['Stats']);
  assert.equal(S(h).view, TRAINER_STATS);
  const rows = S(h).statsRows;
  assert.deepEqual(rows.map((r) => r.item), ['min', 'maj']);
  assert.equal(rows[0].cells[0], null, 'never read');
  assert.ok(rows[0].cells[1] < 100);
  assert.equal(rows[1].cells[1], 100);
  S(h).activate(false);
  assert.equal(S(h).view, INFO_VIEW);
  assert.equal(S(h).info.title, 'Minor');
  assert.ok(S(h).info.paragraphs.some((p) => /^Hear: \d+ of \d+ right$/.test(p.text)));
  S(h).back();
  assert.equal(S(h).view, TRAINER_STATS);
  S(h).moveSelection(1);
  assert.equal(S(h).statsCursor, 1);
  S(h).back();
  assert.equal(S(h).view, MENU);
});

test('a round opens by its id, as Review and Continue open it', () => {
  const h = start();
  S(h).openItem('quiz:chord:hear:name:L3');
  assert.equal(S(h).view, GUESS_VIEW);
  assert.equal(S(h).quizTitle(), 'CHORDS HEAR');
  /* Level 3 in C major, diatonic: no augmented chord to ask, so none offered. */
  assert.deepEqual(S(h).quiz.answers.map((a) => a.key), ['maj', 'min', 'dim']);
  /* Pinned: the setup page is not changed by it. */
  S(h).back();
  assert.notEqual(S(h).view, SETTINGS);
  /* A Custom pick nobody played cannot be found, and does not open. */
  const h2 = start();
  S(h2).openItem('quiz:chord:read:play:C-zzzzzz');
  assert.equal(S(h2).view, MENU);
});
