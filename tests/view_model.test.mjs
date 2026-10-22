// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * view_model.test.mjs — what a browser is sent is plain data, small enough for
 * Schwung's state key, and never gives an answer away.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeHost, openPath } from './support/fake_host.mjs';
import {
  viewModel, clockOf, encodeViewModel, decodeViewModel, encodedSize, STATE_LIMIT,
  NOTE_HIT, NOTE_PENDING, NOTE_MISSED, VM_VERSION,
} from '../src/view_model.mjs';
import { MENU, READY, RUNNING, GUESS_VIEW, RESULT_VIEW, PROGRESS_DETAIL } from '../src/session.mjs';
import * as GUESS from '../src/guess.mjs';

const plain = (vm) => JSON.parse(JSON.stringify(vm));

test('the list arrives decorated, with its path and cursor', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Practice']);
  const vm = viewModel(h.session);
  assert.equal(vm.v, VM_VERSION);
  assert.equal(vm.screen, MENU);
  assert.deepEqual(vm.nav.path, ['Piano', 'Practice'].slice(-vm.nav.path.length));
  assert.equal(vm.nav.title, 'Practice');
  assert.deepEqual(vm.nav.rows.map((r) => r.label), ['Scales', 'Chords', 'Progressions', 'Random', 'Songs']);
  assert.deepEqual(vm.hint, ['CLICK open  BACK up'], 'the footer the Move shows');
  assert.ok(vm.nav.rows.every((r) => r.folder));
  assert.deepEqual(vm, plain(vm), 'plain JSON');
});

test('a running drill sends its chart, judgements, markers and clock', () => {
  const h = fakeHost({ opts: { keepMarkersBeats: 16 } });
  h.session.init();
  openPath(h.session, ['Practice', 'Scales', 'Major', 'Up & down']);
  const ready = viewModel(h.session);
  assert.equal(ready.screen, READY);
  assert.equal(ready.chart.name, 'C Major');
  assert.equal(ready.chart.events.length, ready.run.notes.length);
  assert.ok(ready.run.notes.every((codes) => [...codes].every((c) => c === NOTE_PENDING)));
  assert.ok(ready.can.listen && ready.can.practice && ready.can.scrub);
  assert.deepEqual(ready.armed, { id: h.session.armedId, stage: 1 });

  h.session.recordButton();
  const beatMs = 60000 / h.session.chart.bpm;
  const first = h.session.chart.events[0];
  h.run((h.session.settings.countIn + first.beat) * beatMs);
  h.session.play(first.pitches[0], 100);
  h.session.play(61, 100);                       /* and a stray */
  h.run(12 * beatMs);                            /* the next notes go by unplayed */
  const vm = viewModel(h.session);
  assert.equal(vm.screen, RUNNING);
  assert.equal(vm.run.notes[0], NOTE_HIT);
  assert.ok(vm.run.notes.some((c) => c.includes(NOTE_MISSED)), 'a missed note shows');
  assert.equal(vm.run.markers.length, 2, 'both presses are marked');
  assert.equal(vm.run.stats.strays, 1);
  assert.equal(vm.can.scrub, false, 'no scrubbing while it runs');
  assert.ok(vm.clock.running);
  assert.ok(vm.clock.bar >= 1);
  assert.deepEqual(vm, plain(vm));
});

test('stuck on a note: the block index and the stuck cue say which', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Practice', 'Scales', 'Major', 'Up & down']);
  h.session.recordButton();
  h.run(10000);
  const vm = viewModel(h.session);
  assert.ok(vm.clock.blocked);
  assert.equal(vm.run.blockIndex, 0);
  assert.deepEqual(vm.cue.stuck, h.session.chart.events[0].pitches.slice().sort((a, b) => a - b));
});

test('listening: the cue names what is sounding', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Practice', 'Scales', 'Major', 'Up & down']);
  h.session.playButton();
  const beatMs = 60000 / h.session.chart.bpm;
  h.run((h.session.settings.countIn + 0.2) * beatMs);
  const vm = viewModel(h.session);
  assert.ok(vm.clock.listening);
  assert.ok(vm.cue.sounding.includes(h.session.chart.events[0].pitches[0]));
});

test('a hidden prompt is never sent — not its notes, not its name', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Quiz', 'Ear', 'Pitch & melody', 'Higher or lower', 'wide']);
  let vm = viewModel(h.session);
  assert.equal(vm.screen, GUESS_VIEW);
  assert.equal(vm.quiz.mode, 'ear');
  assert.equal(vm.quiz.prompt, null);
  assert.equal(vm.quiz.label, null);
  assert.ok(!JSON.stringify(vm.cue.prompt.length ? vm.cue : {}).includes('prompt'), 'nor lit');
  assert.ok(vm.quiz.options.length >= 2);
  assert.ok(vm.quiz.options.every((o) => o.colour), 'answer pads have colours');
  /* Answered: now it may be shown. */
  const q = h.session.quiz;
  for (let i = 0; i < q.choices.length && !q.solved; i++) h.session.answer(i);
  vm = viewModel(h.session);
  assert.ok(Array.isArray(vm.quiz.prompt) && vm.quiz.prompt.length > 0);
});

test('a Play quiz shows its row: by name with the names, by staff without', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Quiz', 'Keys', 'Notes by alphabet']);
  let vm = viewModel(h.session);
  assert.equal(vm.quiz.read, 'name');
  assert.equal(vm.quiz.queue.length, GUESS.LOOKAHEAD);
  assert.deepEqual(vm.quiz.queue.map((e) => e.index), [0, 1, 2, 3, 4, 5]);
  assert.ok(vm.quiz.queue.every((e) => typeof e.name === 'string' && e.name.length));
  h.session.back();
  h.session.back();
  openPath(h.session, ['Reading', 'Chords by staff']);
  vm = viewModel(h.session);
  assert.equal(vm.quiz.read, 'staff');
  assert.ok(vm.quiz.queue.every((e) => e.name === null), 'no names to read off');
  assert.ok(vm.quiz.queue.every((e) => e.pitches.length >= 3));
  h.session.recordButton(true);                 /* Help */
  vm = viewModel(h.session);
  assert.equal(h.session.quiz.hint, 1);
  assert.ok(vm.quiz.queue[0].name, 'Help names the prompt');
  assert.equal(vm.quiz.queue[1].name, null, 'and only the prompt');
  const q = h.session.quiz;
  for (const p of q.prompt) h.session.play(p, 90);
  h.run(600);
  vm = viewModel(h.session);
  assert.equal(vm.quiz.queue[0].index, 1, 'the row moved on by one');
});

test('a Play quiz shows its prompt; a Name quiz lights it as the question', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Quiz', 'Keys', 'Notes by alphabet']);
  let vm = viewModel(h.session);
  assert.equal(vm.quiz.mode, 'play');
  assert.equal(vm.quiz.prompt.length, 1);
  assert.deepEqual(vm.cue.prompt, [], 'the answer is not lit');
  h.session.back();                              /* to Keys */
  openPath(h.session, ['Name notes']);
  vm = viewModel(h.session);
  assert.equal(vm.quiz.mode, 'pick');
  assert.deepEqual(vm.cue.prompt, vm.quiz.prompt, 'the lit pad is the question');
});

test('results and progress charts are data', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Quiz', 'Keys', 'Name notes']);
  for (let i = 0; i < 40 && h.session.view === GUESS_VIEW; i++) {
    const q = h.session.quiz;
    h.session.answer(q.choices.findIndex((c) => c.pitches.join() === q.prompt.join()));
    h.run(500);
  }
  let vm = viewModel(h.session);
  assert.equal(vm.screen, RESULT_VIEW);
  assert.equal(vm.result.kind, 'quiz');
  assert.equal(vm.result.n, 10);
  assert.ok(Array.isArray(vm.result.records));
  h.session.back();
  h.session.back();
  h.session.back();
  h.session.back();
  openPath(h.session, ['Progress']);
  h.session.selectProgress(0);
  h.session.activate(false);
  vm = viewModel(h.session, { plotW: 300, plotH: 100 });
  assert.equal(vm.screen, PROGRESS_DETAIL);
  assert.equal(vm.progress.detail.kind, 'overview');
  assert.ok(vm.progress.rows.length >= 5);
  assert.deepEqual(vm, plain(vm));
});

test('encode and decode round-trip, one string per field', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Practice', 'Scales', 'Major', 'Up & down']);
  const vm = viewModel(h.session);
  const flat = encodeViewModel(vm);
  for (const v of Object.values(flat)) assert.equal(typeof v, 'string');
  assert.deepEqual(decodeViewModel(flat), plain(vm));
  assert.equal(decodeViewModel({ broken: '{' }).broken, null, 'a damaged field reads as empty');
});

test('every bundled song at every level fits Schwung\'s 64KB state key', () => {
  const h = fakeHost();
  h.session.init();
  let largest = { size: 0, name: '' };
  let checked = 0;
  for (const category of ['Classics', 'Electronic', 'Techno', 'Styles']) {
    h.session.init();
    openPath(h.session, ['Practice', 'Songs', category]);
    const songs = h.session.nav[3].node.children;
    for (let s = 0; s < songs.length; s++) {
      h.session.selectRow(s);
      h.session.activate(false);
      const levels = h.session.nav.length > 4 ? h.session.nav[4].node.children : [null];
      for (let l = 0; l < levels.length; l++) {
        if (levels[l]) {
          h.session.selectRow(l);
          h.session.activate(false);
        }
        assert.equal(h.session.view, READY, `${category} ${s}/${l} armed`);
        h.session.recordButton();
        h.run(2000);
        const size = encodedSize(viewModel(h.session));
        if (size > largest.size) largest = { size, name: h.session.chart.name };
        checked++;
        h.session.back();                         /* restart */
        h.session.back();                         /* to the levels */
      }
      if (levels[0]) h.session.back();            /* to the songs */
    }
  }
  assert.ok(checked > 60, `checked ${checked}`);
  assert.ok(largest.size < STATE_LIMIT, `${largest.name}: ${largest.size} bytes`);
});

test('the clock alone is small and moves with the run', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Practice', 'Scales', 'Major', 'Up & down']);
  h.session.playButton();
  const a = clockOf(h.session);
  h.run(1000);
  const b = clockOf(h.session);
  assert.ok(b.beats > a.beats);
  assert.ok(JSON.stringify(b).length < 300);
});

test('the clock says when it was taken, how long a beat is, and where it will wait', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Practice', 'Scales', 'Major', 'Up & down']);
  h.session.recordButton();
  h.run(500);
  const c = clockOf(h.session, 12345.5);
  assert.equal(c.t, 12345.5);
  assert.equal(c.perBeatMs, 60000 / h.session.chart.bpm);
  assert.equal(c.waitAt, h.session.chart.events[0].beat, 'waiting for the first note');
  assert.equal(clockOf(h.session).t, null, 'no time given, none claimed');
  assert.equal(viewModel(h.session, { t: 7 }).clock.t, 7);
  /* Listening never waits. */
  const l = fakeHost();
  l.session.init();
  openPath(l.session, ['Practice', 'Scales', 'Major', 'Up & down']);
  l.session.playButton();
  l.run(500);
  assert.equal(clockOf(l.session).waitAt, null);
});

/* A keyboard on a page shows what the Move plays wherever it is: a pad held
 * in the list lights its key; the click does not. */
test('cue.playing is every note sounding, on any screen, but the click', () => {
  const h = fakeHost({ settings: { version: 7, autoInfo: false, quizSounds: false, click: true } });
  h.session.init();
  assert.equal(h.session.view, 'menu');
  h.session.play(64, 100);
  assert.deepEqual(viewModel(h.session).cue.playing, [64], 'a pad held in the list');
  h.session.release(64);
  assert.deepEqual(viewModel(h.session).cue.playing, []);
  openPath(h.session, ['Practice', 'Scales', 'Major', 'Up & down']);
  h.session.playButton();
  let clicked = false;
  for (let i = 0; i < 400 && !clicked; i++) {
    h.run(10);
    const struck = h.log.some((e) => e[0] === 'strike' && (e[1] === 91 || e[1] === 96));
    if (struck) {
      clicked = true;
      const playing = viewModel(h.session).cue.playing;
      assert.ok(!playing.includes(91) && !playing.includes(96), `the click is not a note: ${playing}`);
    }
  }
  assert.ok(clicked, 'the click sounded');
});

test('without the option, marks go at the panel\'s edge, as on the Move', () => {
  /* Wait off, so the scroll keeps moving and the mark scrolls away. */
  const h = fakeHost({ settings: { version: 7, autoInfo: false, quizSounds: false, waitForNote: false } });
  h.session.init();
  openPath(h.session, ['Practice', 'Scales', 'Major', 'Up & down']);
  h.session.recordButton();
  h.run(5000);
  h.session.play(61, 90);
  assert.equal(viewModel(h.session).run.markers.length, 1);
  h.run(5000);
  assert.equal(viewModel(h.session).run.markers.length, 0);
});

test('the sheet, a card and the settings page are data too', () => {
  const h = fakeHost({ progress: null });
  h.session.init();
  let vm = viewModel(h.session);
  assert.equal(vm.screen, 'card');
  assert.deepEqual(vm.card, {
    kind: 'welcome', title: 'Welcome',
    paragraphs: ['Piano Practice takes you from your first note to pro, one step a day.'],
    lines: false, choices: null, choice: 0, page: 0, pages: 4,
  });
  assert.deepEqual(vm.hint, ['JOG page  CLICK go on']);
  h.session.back();
  h.session.selectRow(1);
  h.session.activate(true);
  vm = viewModel(h.session);
  assert.equal(vm.screen, 'card', 'the sheet\'s first-visit tip');
  h.session.back();
  vm = viewModel(h.session);
  assert.deepEqual(vm.sheet, { title: 'Path', cursor: 0, items: ['Settings...'] });
  assert.equal(vm.card, null);
  h.session.pickSheet(0);
  openPath(h.session, ['Help']);
  vm = viewModel(h.session);
  assert.equal(vm.settings.title, 'Help');
  assert.deepEqual(vm.settings.rows.map((r) => [r.row, r.label, r.act]), [
    [0, 'Auto info', null], [1, 'Show tips again', 'tips'], [2, 'Welcome again', 'welcome'],
  ]);
  assert.ok(vm.settings.rows[0].index >= 0 && vm.settings.rows[1].index === -1);
  assert.deepEqual(vm, plain(vm));
});
