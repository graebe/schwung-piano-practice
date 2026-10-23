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
import { MENU, SETTINGS, GUESS_VIEW, RESULT_VIEW, INFO_VIEW, TRAINER_STATS, TRAINER_SETUP } from '../src/session.mjs';
import * as CTRL from '../src/controls.mjs';

function start() {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Practice', 'Chords']);
  return h;
}
const S = (h) => h.session;
/* A setting's tile, and the knob that turns it. */
const tile = (h, field) => S(h).knobSetup().knobs.find((k) => k.field === field);
const knob = (h, field) => tile(h, field).n;

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
  assert.equal(S(h).listTitle(), 'Chords');
  assert.equal(S(h).nav[S(h).nav.length - 1].node.children[0].label, 'Triads');
});

test('a circle opens its knob screen; PLAY runs a round; next is another', () => {
  const h = start();
  openPath(S(h), ['Read']);
  assert.equal(S(h).view, TRAINER_SETUP);
  const ks = S(h).knobSetup();
  assert.equal(ks.title, 'CHORDS READ');
  assert.equal(ks.focus, 1, 'it opens on Level, knob 1');
  assert.deepEqual(ks.knobs.map((k) => k.field), ['level', 'answer', 'key', 'scale', 'roots', 'inversions', 'round'],
    'only the settings Read has: no Sound, no empty knob');
  assert.deepEqual(ks.knobs.map((k) => k.n), [1, 2, 3, 4, 5, 6, 7]);
  S(h).activate(false);
  assert.equal(S(h).view, TRAINER_SETUP, 'a click starts nothing');
  S(h).playButton();
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

test('knobs: each turns its own setting; a touch names one; the jog walks the used ones', () => {
  const h = start();
  openPath(S(h), ['Hear']);
  const before = JSON.stringify(S(h).knobSetup().knobs.map((k) => k.short));
  S(h).knobTouch(5);
  assert.equal(S(h).knobSetup().focus, 5, 'touched: in focus');
  assert.equal(JSON.stringify(S(h).knobSetup().knobs.map((k) => k.short)), before, 'and nothing changed');
  assert.ok(h.said().some((t) => /^Knob 5, Roots: diatonic/.test(t)));
  assert.deepEqual(S(h).knobSetup().feedback, {
    n: 5, label: 'Roots', text: 'diatonic', brief: null,
  }, 'the PLAY strip names it in full');
  h.run(2100);
  assert.equal(S(h).knobSetup().feedback, null, 'for two seconds');
  for (const [n, field, want] of [[2, 'answer', 'nm'], [1, 'level', 'L3'], [3, 'key', 'C#'], [4, 'scale', 'm'],
    [5, 'roots', 'ik'], [6, 'inversions', 'on'], [7, 'sound', 'bn'], [8, 'round', '20']]) {
    S(h).knobStep(n, 1);
    const k = S(h).knobSetup().knobs[n - 1];
    assert.equal(k.field, field);
    assert.equal(k.short, want, field);
    assert.equal(S(h).knobSetup().focus, n);
  }
  S(h).knobStep(2, -1);                              /* back to play: Level stays at 2 */
  const saved = JSON.parse(h.files.get('progress.json')).trainers.chord.hear;
  assert.equal(saved.round, 20);
  /* The jog walks the tiles. Chords › Play has six: no Answer, no Sound. */
  S(h).back();
  openPath(S(h), ['Play']);
  assert.equal(S(h).knobSetup().knobs.length, 6);
  S(h).knobTouch(5);
  S(h).moveSelection(1);
  assert.equal(S(h).knobSetup().focus, 6);
  S(h).moveSelection(1);
  assert.equal(S(h).knobSetup().focus, 6, 'clamped');
  for (let i = 0; i < 9; i++) S(h).moveSelection(-1);
  assert.equal(S(h).knobSetup().focus, 1);
  S(h).knobStep(7, 1);
  S(h).knobTouch(8);
  assert.equal(S(h).knobSetup().focus, 1, 'a knob with no tile does nothing');
});

test('Back: the round to its knobs, focus kept; the knobs to the ring; the ring to Practice', () => {
  const h = start();
  openPath(S(h), ['Hear']);
  S(h).knobTouch(8);
  S(h).playButton();
  assert.equal(S(h).view, GUESS_VIEW);
  S(h).back();
  assert.equal(S(h).view, TRAINER_SETUP);
  assert.equal(S(h).knobSetup().focus, 8, 'where it was');
  S(h).back();
  assert.equal(S(h).view, MENU);
  assert.equal(S(h).nav[S(h).nav.length - 1].node.label, 'Chords');
  S(h).back();
  assert.equal(S(h).nav[S(h).nav.length - 1].node.label, 'Practice');
});

test('a setup is remembered per circle, and kept in the progress file', () => {
  const h = start();
  openPath(S(h), ['Play']);
  S(h).knobStep(1, 1);
  S(h).knobStep(1, 1);
  S(h).back();
  openPath(S(h), ['Play']);
  assert.equal(tile(h, 'level').text, '3  maj m dim aug');
  S(h).back();
  openPath(S(h), ['Read']);
  assert.equal(tile(h, 'level').short, 'L1', 'Read has its own');
  const saved = JSON.parse(h.files.get('progress.json'));
  assert.equal(saved.trainers.chord.play.level, 3);
});

test('Custom: a click opens the tick list, Back returns to the knobs; a round of only the picked', () => {
  const h = start();
  openPath(S(h), ['Read']);
  S(h).knobStep(1, 6);
  assert.equal(tile(h, 'level').short, 'L2', 'one step a click');
  for (let i = 0; i < 7; i++) S(h).knobStep(1, 1);       /* 2 -> ... -> 8 -> custom */
  assert.equal(tile(h, 'level').short, 'Cu');
  assert.equal(tile(h, 'level').digit, 'Cu');
  assert.deepEqual(tile(h, 'level').blurb, ['27 chords', '27 ticked']);
  assert.deepEqual(S(h).hint(), ['KNOB set  PLAY start', 'CLICK custom']);
  S(h).activate(false);
  assert.equal(S(h).view, SETTINGS);
  assert.equal(S(h).settingsTitle(), 'Chords custom');
  assert.equal(S(h).settingsRows().filter((r) => r.value === 'on').length, 27, 'from level 8: all of it');
  for (const r of S(h).settingsRows()) {
    if (r.item === 'm7' || r.item === 'dim') continue;
    S(h).selectSettingRow(S(h).settingsRows().findIndex((x) => x.item === r.item));
    S(h).activate(false);
  }
  S(h).back();
  assert.equal(S(h).view, TRAINER_SETUP, 'Back: the knobs');
  assert.equal(tile(h, 'level').text, 'custom  dim m7');
  S(h).playButton();
  const kinds = new Set(S(h).quiz.pool.map((e) => e.qualityId));
  assert.deepEqual([...kinds].sort(), ['dim', 'm7']);
});

test('PLAY waits for enough ticked: one to play, two to name; the Play LED goes dark', () => {
  const h = start();
  openPath(S(h), ['Read']);
  S(h).knobStep(1, 1);
  for (let i = 0; i < 7; i++) S(h).knobStep(1, 1);
  S(h).activate(false);
  const untick = (item) => {
    S(h).selectSettingRow(S(h).settingsRows().findIndex((x) => x.item === item));
    S(h).activate(false);
  };
  for (const r of S(h).settingsRows().filter((x) => x.value === 'on')) untick(r.item);
  S(h).back();
  assert.equal(S(h).knobSetup().blocked, 'tick 1 chord');
  assert.deepEqual(S(h).hint(), ['KNOB set', 'tick 1 chord', 'CLICK custom'], 'the reason where PLAY start was');
  assert.equal(CTRL.playLedColor('trainer-setup', 1, false, false, true), CTRL.OFF);
  assert.notEqual(CTRL.playLedColor('trainer-setup', 1, false, false, false), CTRL.OFF);
  S(h).playButton();
  assert.equal(S(h).view, TRAINER_SETUP, 'nothing starts');
  assert.ok(h.said().some((t) => /Not yet: tick 1 chord/.test(t)));
  /* Naming: one ticked is still not enough. */
  S(h).knobStep(knob(h, 'answer'), 1);
  S(h).knobTouch(knob(h, 'level'));
  S(h).activate(false);
  untick('maj');
  S(h).back();
  assert.equal(S(h).knobSetup().blocked, 'tick 2 chords');
  S(h).activate(false);
  untick('min');
  S(h).back();
  assert.equal(S(h).knobSetup().blocked, null);
  S(h).playButton();
  assert.equal(S(h).view, GUESS_VIEW);
});

test('Shift + click shows the setup as a list, Start last; Back is the knobs again', () => {
  const h = start();
  openPath(S(h), ['Read']);
  S(h).activate(true);
  assert.equal(S(h).view, SETTINGS);
  const rows = S(h).settingsRows();
  assert.equal(rows.at(-1).act, 'start');
  assert.equal(S(h).settingsCursor, rows.length - 1);
  S(h).back();
  assert.equal(S(h).view, TRAINER_SETUP);
  S(h).activate(true);
  S(h).activate(false);
  assert.equal(S(h).view, GUESS_VIEW, 'Start in the list starts too');
});

test('Stats: weakest first, a row\'s detail, Back to the ring', () => {
  const h = start();
  openPath(S(h), ['Hear']);
  S(h).knobStep(knob(h, 'answer'), 1);
  S(h).playButton();
  /* Miss every minor chord once. */
  playRound(h, (q) => q.entry.answer === 'min');
  assert.equal(S(h).view, RESULT_VIEW);
  S(h).back(); S(h).back();
  if (S(h).view === GUESS_VIEW) S(h).back();
  if (S(h).view === TRAINER_SETUP) S(h).back();
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

/* ---- Scales ------------------------------------------------------------------ */

/* Every note of the armed chart, on time, to its result. */
function playChart(h) {
  S(h).recordButton();
  const beatMs = 60000 / S(h).chart.bpm;
  const t0 = h.ms;
  for (const e of S(h).chart.events) {
    const at = t0 + (S(h).settings.countIn + e.beat) * beatMs;
    if (at > h.ms) h.run(at - h.ms);
    for (const p of e.pitches) S(h).play(p, 100);
    for (const p of e.pitches) S(h).release(p);
  }
  h.run(4000);
}

test('Scales: read and play is a chart; its result files the scale; next is another', () => {
  const h = fakeHost();
  S(h).init();
  openPath(S(h), ['Practice', 'Scales']);
  const ring = S(h).nav[S(h).nav.length - 1].node;
  assert.deepEqual(ring.children.map((c) => c.label), ['Read', 'Hear', 'Play', 'Learn', 'Stats']);
  openPath(S(h), ['Learn']);
  assert.equal(S(h).listTitle(), 'Scales');
  S(h).back();
  openPath(S(h), ['Read']);
  S(h).playButton();
  assert.equal(S(h).view, 'ready');
  assert.equal(S(h).armedId, 'quiz:scale:read:play:L1');
  const name = S(h).chart.name;
  assert.match(name, /^C (Major|Minor)$/);
  playChart(h);
  for (let i = 0; i < 20 && S(h).view !== RESULT_VIEW; i++) { S(h).activate(false); h.run(200); }
  assert.equal(S(h).view, RESULT_VIEW);
  const items = JSON.parse(h.files.get('stats.json')).items.scale;
  const id = name.endsWith('Major') ? 'major' : 'minor';
  assert.deepEqual(items[id].read, [1, 1]);
  assert.ok(S(h).progress.items['quiz:scale:read:play:L1']);
  S(h).activate(false);
  assert.equal(S(h).view, 'ready', 'next: another scale');
  S(h).back();
  assert.equal(S(h).view, TRAINER_SETUP, 'Back from its ready screen: the setup');
});

test('Scales: heard and played back, note by note, filed under hear', () => {
  const h = fakeHost();
  S(h).init();
  openPath(S(h), ['Practice', 'Scales', 'Hear']);
  S(h).playButton();
  assert.equal(S(h).view, GUESS_VIEW);
  assert.equal(S(h).quizTitle(), 'SCALES HEAR');
  for (let i = 0; i < 400 && S(h).view === GUESS_VIEW; i++) {
    const q = S(h).quiz;
    if (!q.solved) for (const p of q.entry.line) { S(h).play(p + 12, 100); S(h).release(p + 12); }
    h.run(1600);
  }
  for (let i = 0; i < 20 && S(h).view !== RESULT_VIEW; i++) { S(h).activate(false); h.run(200); }
  assert.equal(S(h).lastResult.drill, 'scale:hear:play:L1');
  const items = JSON.parse(h.files.get('stats.json')).items.scale;
  const heard = Object.values(items).reduce((n, r) => n + r.hear[0], 0);
  assert.equal(heard, 10);
});

/* ---- Progressions ------------------------------------------------------------ */

test('Progressions: Key all 12 walks the circle, a chart a key; Learn keeps its charts', () => {
  const h = fakeHost();
  S(h).init();
  openPath(S(h), ['Practice', 'Progressions', 'Learn']);
  assert.equal(S(h).nav[S(h).nav.length - 1].node.children[0].id, 'basics/progressions/I-IV-V-I');
  S(h).back();
  openPath(S(h), ['Read']);
  for (let i = 0; i < 13; i++) S(h).knobStep(knob(h, 'key'), 1);   /* Key: all 12 */
  assert.equal(tile(h, 'key').short, 'al');
  S(h).playButton();
  assert.equal(S(h).view, 'ready');
  const first = S(h).chart.name;
  assert.match(first, /^Cm? /);
  playChart(h);
  for (let i = 0; i < 20 && S(h).view !== RESULT_VIEW; i++) { S(h).activate(false); h.run(200); }
  S(h).activate(false);                       /* next */
  assert.equal(S(h).view, 'ready');
  assert.equal(S(h).chart.name.replace(/^\S+ /, ''), first.replace(/^\S+ /, ''), 'the same progression');
  assert.match(S(h).chart.name, /^Fm? /, 'in the next key round the circle');
});

test('Progressions: heard and played back, chord by chord, filed under hear', () => {
  const h = fakeHost();
  S(h).init();
  openPath(S(h), ['Practice', 'Progressions', 'Hear']);
  S(h).playButton();
  assert.equal(S(h).quizTitle(), 'PROGS HEAR');
  for (let i = 0; i < 400 && S(h).view === GUESS_VIEW; i++) {
    const q = S(h).quiz;
    if (!q.solved) for (const c of q.entry.chords) { for (const p of c) S(h).play(p, 100); for (const p of c) S(h).release(p); }
    h.run(1600);
  }
  for (let i = 0; i < 20 && S(h).view !== RESULT_VIEW; i++) { S(h).activate(false); h.run(200); }
  assert.equal(S(h).lastResult.drill, 'prog:hear:play:L1');
  const items = JSON.parse(h.files.get('stats.json')).items.prog;
  assert.equal(Object.values(items).reduce((n, r) => n + r.hear[1], 0), 10);
});

/* ---- The Learning Path's steps ----------------------------------------------- */

test('a path step that was a quiz opens its trainer round, and keeps its tick', () => {
  const h = fakeHost();
  S(h).init();
  /* Find the notes › Name notes: a lit pad named, before the trainers. */
  S(h).openItem('quiz:pick:notes:key');
  assert.equal(S(h).quizTitle(), 'NOTES READ', 'Read, name now: off the staff');
  playRound(h);
  assert.equal(S(h).view, RESULT_VIEW);
  const it = S(h).progress.items['quiz:pick:notes:key'];
  assert.ok(it && it.stages.some((st) => st.best > 0), 'filed under the step\'s own id');
  assert.ok(!S(h).progress.items['quiz:note:read:name:L3'], 'not under a trainer id');
  /* Kept drills still open as they were. */
  S(h).openItem('quiz:ear:home:major');
  assert.equal(S(h).quizTitle(), null);
  assert.equal(S(h).quiz.exercise.key, 'home');
});

/* ---- The page's picture -------------------------------------------------------- */

import { viewModel } from '../src/view_model.mjs';
import { applyAction } from '../src/actions.mjs';

test('the page gets a line, a row of chords, a setup and Stats as the Move draws them', () => {
  const h = fakeHost();
  S(h).init();
  openPath(S(h), ['Practice', 'Scales', 'Play']);
  let vm = viewModel(S(h));
  assert.equal(vm.screen, TRAINER_SETUP);
  assert.equal(vm.trainerSetup.title, 'SCALES PLAY');
  assert.deepEqual(vm.trainerSetup.knobs.map((k) => k.field), ['level', 'key', 'direction', 'round']);
  assert.deepEqual(vm.trainerSetup.knobs.map((k) => k.n), [1, 2, 3, 4]);
  assert.deepEqual(vm.trainerSetup.knobs[0], {
    n: 1, field: 'level', kind: 'level', row: -1, col: 0, label: 'Level', short: 'L1', plain: '1 major minor',
    text: '1  Major Minor', tile: ['1 major minor'], pos: 0, count: 11, digit: '1', blurb: ['major minor'],
  });
  assert.equal(vm.trainerSetup.focus, 1);
  assert.equal(vm.trainerSetup.feedback, null);
  assert.equal(vm.trainerSetup.blocked, null);
  S(h).playButton();
  vm = viewModel(S(h));
  assert.equal(vm.quiz.mode, 'line');
  assert.equal(vm.quiz.read, null, 'no row of names: the line is the prompt');
  assert.equal(vm.quiz.line.shown, 0);
  assert.match(vm.quiz.line.label, /^[A-G][#b]? /);
  const line = S(h).quiz.entry.line;
  S(h).play(line[0], 90);
  vm = viewModel(S(h));
  assert.equal(vm.quiz.line.shown, 1);
  assert.equal(vm.quiz.sheet.length, 1, 'the staff shows what is played');
  S(h).back(); S(h).back();
  S(h).back();
  openPath(S(h), ['Progressions', 'Hear']);
  S(h).playButton();
  vm = viewModel(S(h));
  assert.equal(vm.quiz.mode, 'row');
  assert.ok(vm.quiz.row.tokens.every((w) => w === '?'), 'heard: the numerals withheld');
  assert.equal(vm.quiz.row.label, null, 'and the name');
  S(h).back(); S(h).back();
  openPath(S(h), ['Stats']);
  vm = viewModel(S(h));
  assert.equal(vm.screen, TRAINER_STATS);
  assert.deepEqual(vm.trainerStats.rows, []);
  assert.equal(applyAction(S(h), { type: 'trainerStats', index: 3 }), null);
});

test('a knob on the Move moves its setting a value per ten units; Settings too', () => {
  const h = start();
  openPath(S(h), ['Hear']);
  const level = () => S(h).knobSetup().knobs.find((k) => k.field === 'level').short;
  const n = S(h).knobSetup().knobs.find((k) => k.field === 'level').n;
  for (let i = 0; i < 9; i++) { S(h).knobTurn(n, 1); h.run(20); }
  assert.equal(level(), 'L1', 'nine units: nothing yet');
  assert.equal(S(h).knobSetup().focus, n, 'but the knob is in focus');
  S(h).knobTurn(n, 1);
  assert.equal(level(), 'L2', 'the tenth: one value');
  S(h).knobTurn(n, 40);
  assert.equal(level(), 'L3', 'a flick: one value, no more');
  h.run(700);
  for (let i = 0; i < 9; i++) S(h).knobTurn(n, -1);
  assert.equal(level(), 'L3', 'turning back starts the count again');
  /* Settings: the same feel. */
  for (let i = 0; i < 6; i++) S(h).back();
  S(h).openSettingsPage();
  const before = S(h).settingsRows()[0].value;
  for (let i = 0; i < 9; i++) S(h).settingsKnob(0, 1);
  assert.equal(S(h).settingsRows()[0].value, before, 'nine units on a Settings row: nothing');
  S(h).settingsKnob(0, 1);
  assert.notEqual(S(h).settingsRows()[0].value, before, 'the tenth: one value');
});
