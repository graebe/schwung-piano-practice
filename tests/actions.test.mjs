// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * actions.test.mjs — every action a page can send means what the Move's button
 * for it means, and a malformed one does nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeHost, openPath } from './support/fake_host.mjs';
import { applyAction, ACTIONS } from '../src/actions.mjs';
import {
  MENU, READY, RUNNING, SETTINGS, GUESS_VIEW, RESULT_VIEW, PROGRESS_VIEW, PROGRESS_DETAIL, INFO_VIEW,
} from '../src/session.mjs';

function ready() {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Basics', 'Scales', 'Major', 'Up & down']);
  return h;
}

test('a malformed action does nothing', () => {
  const h = fakeHost();
  h.session.init();
  for (const a of [null, undefined, {}, { type: 7 }, { type: 'nope' }, { type: 'noteOn', pitch: 300 },
    { type: 'noteOn', pitch: 1.5 }, { type: 'noteOff', pitch: -1 }, { type: 'move' }]) {
    assert.equal(applyAction(h.session, a), null);
  }
  assert.equal(h.session.view, MENU);
  assert.ok(!h.log.some((e) => e[0] === 'strike'));
});

test('select and open walk the list; back steps out', () => {
  const h = fakeHost();
  h.session.init();
  applyAction(h.session, { type: 'select', index: 1 });
  applyAction(h.session, { type: 'open' });
  assert.equal(h.session.nav[1].node.label, 'Basics');
  applyAction(h.session, { type: 'move', delta: 3 });
  assert.equal(h.session.nav[1].cursor, 1, 'the jog moves one row whatever the delta');
  applyAction(h.session, { type: 'back' });
  assert.equal(h.session.nav.length, 1);
});

test('settings opens from the list only', () => {
  const h = fakeHost();
  h.session.init();
  applyAction(h.session, { type: 'settings' });
  assert.equal(h.session.view, SETTINGS);
  applyAction(h.session, { type: 'selectSetting', index: 2 });
  assert.equal(h.session.settingsCursor, 2);
  applyAction(h.session, { type: 'editSetting', index: 0, delta: 3 });
  assert.equal(h.session.settings.bpm, 83);
  applyAction(h.session, { type: 'editSetting', index: 0, delta: 0 });
  assert.equal(h.session.settings.bpm, 83);
});

test('notes: a velocity of 0 or none plays at 100; the outcome comes back', () => {
  const h = ready();
  applyAction(h.session, { type: 'practice' });
  assert.equal(h.session.view, RUNNING);
  h.run(4000);
  const out = applyAction(h.session, { type: 'noteOn', pitch: 61, vel: 0 });
  assert.equal(out.result, 'stray');
  assert.deepEqual(h.log.filter((e) => e[0] === 'strike').at(-1), ['strike', 61, 100]);
  applyAction(h.session, { type: 'noteOff', pitch: 61 });
  assert.deepEqual(h.log.filter((e) => e[0] === 'release').at(-1), ['release', 61]);
});

test('listen and practice toggle their own mode', () => {
  const h = ready();
  applyAction(h.session, { type: 'listen' });
  assert.ok(h.session.listening);
  h.run(500);
  applyAction(h.session, { type: 'listen' });
  assert.ok(h.session.paused);
});

test('stage picks the stage on the ready screen, and only a real change moves it', () => {
  const h = ready();
  applyAction(h.session, { type: 'stage', stage: 2 });
  assert.equal(h.session.stage, 2);
  applyAction(h.session, { type: 'stage', stage: 2 });
  assert.equal(h.session.stage, 2);
  applyAction(h.session, { type: 'stage', stage: 3 });
  assert.equal(h.session.stage, 2);
  applyAction(h.session, { type: 'stage', stage: 1 });
  assert.equal(h.session.stage, 1);
});

test('scrubTo moves a parked playhead to a beat, and is refused while running', () => {
  const h = ready();
  applyAction(h.session, { type: 'scrubTo', beat: 8 });
  assert.ok(Math.abs(h.session.songBeats - 8) < 0.12, String(h.session.songBeats));
  applyAction(h.session, { type: 'scrubTo', beat: 'x' });
  assert.ok(Math.abs(h.session.songBeats - 8) < 0.12);
  applyAction(h.session, { type: 'practice' });
  const at = h.session.songBeats;
  applyAction(h.session, { type: 'scrubTo', beat: 2 });
  assert.equal(h.session.songBeats, at);
});

test('tempo changes the Tempo setting', () => {
  const h = ready();
  applyAction(h.session, { type: 'tempo', delta: -10 });
  assert.equal(h.session.settings.bpm, 70);
  assert.equal(h.session.chart.bpm, 70, 'a generated drill follows the tempo');
});

test('info opens and closes the Info page', () => {
  const h = ready();
  applyAction(h.session, { type: 'info' });
  assert.equal(h.session.view, INFO_VIEW);
  applyAction(h.session, { type: 'info' });
  assert.equal(h.session.view, READY);
});

test('quiz: hear, hint and answer', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Quiz', 'Name', 'Notes']);
  assert.equal(h.session.view, GUESS_VIEW);
  applyAction(h.session, { type: 'hint' });
  assert.equal(h.session.quiz.hint, 1);
  const q = h.session.quiz;
  const right = q.choices.findIndex((c) => c.pitches.join() === q.prompt.join());
  applyAction(h.session, { type: 'hear' });
  assert.equal(applyAction(h.session, { type: 'answer', index: right }), 'correct');
});

test('next, retry and skip act on a result, and only there', () => {
  const h = fakeHost();
  h.session.init();
  applyAction(h.session, { type: 'next' });
  applyAction(h.session, { type: 'skip' });
  applyAction(h.session, { type: 'retry' });
  assert.equal(h.session.view, MENU, 'nothing happens off a result');
  openPath(h.session, ['Quiz', 'Name', 'Notes']);
  for (let i = 0; i < 40 && h.session.view === GUESS_VIEW; i++) {
    const q = h.session.quiz;
    applyAction(h.session, { type: 'answer', index: q.choices.findIndex((c) => c.pitches.join() === q.prompt.join()) });
    h.run(500);
  }
  assert.equal(h.session.view, RESULT_VIEW);
  applyAction(h.session, { type: 'retry' });
  assert.equal(h.session.view, GUESS_VIEW, 'a fresh round');
});

test('progress opens a row\'s chart, and only from Progress', () => {
  const h = fakeHost();
  h.session.init();
  applyAction(h.session, { type: 'progress', index: 1 });
  assert.equal(h.session.view, MENU);
  openPath(h.session, ['Progress']);
  assert.equal(h.session.view, PROGRESS_VIEW);
  applyAction(h.session, { type: 'progress', index: 2 });
  assert.equal(h.session.view, PROGRESS_DETAIL);
  assert.equal(h.session.progressCursor, 2);
  applyAction(h.session, { type: 'progress', index: 0 });
  assert.equal(h.session.progressCursor, 0, 'from a chart, another chart');
});

test('the list of actions is the list the switch knows', () => {
  const h = fakeHost();
  h.session.init();
  for (const type of ACTIONS) applyAction(h.session, { type, index: 0, delta: 1, pitch: 60, vel: 90, beat: 1, stage: 1 });
});

/*
 * A page, and later a browser steering a Move, can send any action at any
 * moment. Thousands of them, in a seeded random order with time passing,
 * must never throw — and must never leave a note sounding that nothing will
 * release once everything is let go.
 */
test('any action, in any state, in any order: nothing throws, nothing sticks', () => {
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  for (let round = 0; round < 6; round++) {
    const h = fakeHost();
    h.session.init();
    const held = new Set();
    for (let i = 0; i < 1500; i++) {
      const type = pick(ACTIONS);
      const pitch = 48 + Math.floor(rand() * 36);
      const a = {
        type, index: Math.floor(rand() * 8) - 1, delta: pick([-1, 1, 3]), pitch,
        vel: Math.floor(rand() * 128), beat: rand() * 40 - 4, stage: pick([1, 2]),
      };
      if (type === 'noteOn') held.add(pitch);
      if (type === 'noteOff') held.delete(pitch);
      assert.doesNotThrow(() => applyAction(h.session, a), `${type} in ${h.session.view}`);
      if (rand() < 0.3) h.run(Math.floor(rand() * 400));
    }
    for (const p of held) applyAction(h.session, { type: 'noteOff', pitch: p });
    /* Let anything scheduled run out, then leave whatever is running. */
    for (let i = 0; i < 6; i++) applyAction(h.session, { type: 'back' });
    h.run(5000);
    assert.equal(h.sounding.size, 0, `round ${round}: still sounding ${[...h.sounding.keys()]}`);
  }
});
