// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * session_backends.test.mjs — the page's two sessions answer the same way:
 * the browser's own, on a fake clock and a fake piano, and the Move's, through
 * a fake Schwung bridge fed the encoded view model the Move will send.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createLocalSession, bundleExercises } from '../src/session/local.js';
import { createSchwungSession } from '../src/session/schwung.js';
import { chooseBackend } from '../src/session/select.js';
import { encodeViewModel, viewModel } from '../../src/view_model.mjs';

const EX = new URL('../../src/exercises/', import.meta.url).pathname;
const exercises = bundleExercises(Object.fromEntries(
  readdirSync(EX).map((f) => ['../../src/exercises/' + f, readFileSync(EX + f, 'utf8')])));

function fakePiano() {
  const log = [];
  return {
    log,
    state: 'running',
    strike: (p, v) => log.push(['on', p, v]),
    release: (p) => log.push(['off', p]),
    silence: () => log.push(['silence']),
  };
}

function memoryStorage() {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
}

function local(opts = {}) {
  let t = 1000;
  let timerFn = null;
  const piano = fakePiano();
  const storage = memoryStorage();
  storage.setItem('piano-practice:settings.json', JSON.stringify({ version: 7, autoInfo: false, quizSounds: false }));
  const backend = createLocalSession({
    piano,
    storage,
    exercises,
    now: () => t,
    wallNow: () => Date.UTC(2026, 9, 9) + t,
    setTimer: (fn) => { timerFn = fn; return 1; },
    clearTimer: () => { timerFn = null; },
    ...opts,
  });
  return {
    backend, piano, storage,
    advance(ms) { for (let i = 0; i < ms; i += 4) { t += 4; if (timerFn) timerFn(); } },
    get running() { return timerFn !== null; },
  };
}

const select = (l, label) => {
  const vm = l.backend.viewModel;
  const i = vm.nav.rows.findIndex((r) => r.label === label);
  assert.ok(i >= 0, `no row ${label}`);
  l.backend.dispatch({ type: 'select', index: i });
  l.backend.dispatch({ type: 'open' });
};

test('the browser session starts on the list and publishes view models', () => {
  const l = local();
  const seen = [];
  l.backend.subscribe((vm) => seen.push(vm));
  l.backend.start();
  assert.ok(l.running, 'it ticks');
  assert.equal(seen.at(-1).screen, 'menu');
  assert.ok(seen.at(-1).nav.rows.some((r) => r.label === 'Classics'), 'the bundled songs are there');
  assert.equal(seen.at(-1).announcement.text, 'Piano Practice. Pick an exercise.');
  assert.ok(l.backend.capabilities.audio);
  l.backend.stop();
  assert.ok(!l.running);
});

test('a late subscriber gets the current picture at once', () => {
  const l = local();
  l.backend.start();
  let got = null;
  l.backend.subscribe((vm) => { got = vm; });
  assert.equal(got.screen, 'menu');
});

test('practice through the browser: notes reach the piano and the judgement comes back', () => {
  const l = local();
  l.backend.start();
  for (const label of ['Basics', 'Scales', 'Major', 'Up & down']) select(l, label);
  assert.equal(l.backend.viewModel.screen, 'ready');
  l.backend.dispatch({ type: 'practice' });
  l.advance(4000);
  const out = l.backend.dispatch({ type: 'noteOn', pitch: 61, vel: 80 });
  assert.equal(out.result, 'stray');
  assert.deepEqual(l.piano.log.filter((e) => e[0] === 'on').at(-1), ['on', 61, 80]);
  l.backend.dispatch({ type: 'noteOff', pitch: 61 });
  assert.equal(l.backend.viewModel.run.stats.strays, 1);
  assert.equal(l.backend.viewModel.run.markers.length, 1);
  assert.ok(l.backend.clock().beats > -4);
});

test('the playhead moves without republishing every tick', () => {
  const l = local();
  l.backend.start();
  for (const label of ['Basics', 'Scales', 'Major', 'Up & down']) select(l, label);
  let published = 0;
  l.backend.subscribe(() => published++);
  l.backend.dispatch({ type: 'listen' });
  const before = published;
  const a = l.backend.clock().beats;
  l.advance(3000);
  assert.ok(l.backend.clock().beats > a + 2);
  assert.ok(published - before < 3000 / 4 / 4, `published ${published - before} times in 750 ticks`);
});

test('settings are kept in storage across a reload', () => {
  const l = local();
  l.backend.start();
  l.backend.dispatch({ type: 'settings' });
  l.backend.dispatch({ type: 'editSetting', index: 0, delta: 7 });
  l.advance(1500);
  l.backend.stop();
  const saved = JSON.parse(l.storage.getItem('piano-practice:settings.json'));
  assert.equal(saved.bpm, 87);
  /* A new page over the same storage. */
  const again = createLocalSession({ piano: fakePiano(), storage: l.storage, exercises, setTimer: () => 1, clearTimer: () => {} });
  again.start();
  assert.equal(again.session.settings.bpm, 87);
});

test('a storage that refuses (private mode) does not stop practice', () => {
  const l = local({ storage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } });
  l.backend.start();
  l.backend.dispatch({ type: 'settings' });
  l.backend.dispatch({ type: 'editSetting', index: 0, delta: 1 });
  l.advance(1500);
  assert.equal(l.backend.viewModel.screen, 'settings');
});

test('a heard answer is revealed on the keyboard for a while, then not', () => {
  const l = local();
  l.backend.start();
  for (const label of ['Quiz', 'Hear', 'Pitch & melody', 'Higher or lower', 'wide']) select(l, label);
  l.advance(1500);
  const q = l.backend.session.quiz;
  for (let i = 0; i < q.choices.length && !q.solved; i++) l.backend.dispatch({ type: 'answer', index: i });
  assert.deepEqual(new Set(l.backend.viewModel.revealed), new Set(q.prompt));
  l.advance(2000);
  l.backend.dispatch({ type: 'move', delta: 1 });
  assert.deepEqual(l.backend.viewModel.revealed, []);
});

test('without a piano the session still runs, silently', () => {
  const l = local({ piano: null });
  l.backend.start();
  assert.equal(l.backend.capabilities.audio, false);
  for (const label of ['Basics', 'Scales', 'Major', 'Up & down']) select(l, label);
  l.backend.dispatch({ type: 'listen' });
  l.advance(6000);                               /* past the four-beat count-in */
  assert.ok(l.backend.clock().beats > 2);
});

/* ---- The Move's session, through Schwung's bridge ---------------------------- */

function fakeBridge() {
  const sent = [];
  let listener = null;
  return {
    sent,
    onParamChange(fn) { listener = fn; return () => { listener = null; }; },
    setParam(key, value) { sent.push([key, value]); },
    push(flat) { if (listener) listener(Object.fromEntries(Object.entries(flat).map(([k, v]) => ['overtake_dsp:' + k, v]))); },
    get listening() { return listener !== null; },
  };
}

test('the Move\'s view model arrives through the bridge, field by field', () => {
  const src = local();
  src.backend.start();
  for (const label of ['Basics', 'Scales', 'Major', 'Up & down']) select(src, label);
  const flat = encodeViewModel(viewModel(src.backend.session));

  let t = 0;
  const bridge = fakeBridge();
  const remote = createSchwungSession({ bridge, now: () => t });
  const seen = [];
  remote.subscribe((vm) => seen.push(vm));
  remote.start();
  assert.ok(bridge.listening);
  bridge.push({ ...flat, unrelated: '1' });
  assert.equal(seen.at(-1).screen, 'ready');
  assert.equal(seen.at(-1).chart.name, 'C Major');
  assert.equal(remote.capabilities.audio, false, 'the Move makes the sound');

  remote.stop();
  assert.ok(!bridge.listening);
});

test('between updates the Move\'s playhead is carried forward, unless it stands still', () => {
  let t = 0;
  const bridge = fakeBridge();
  const remote = createSchwungSession({ bridge, now: () => t });
  assert.equal(remote.clock(), null);
  remote.start();
  const clock = { beats: 2, bpm: 120, running: true, paused: false, blocked: false };
  bridge.push({ screen: JSON.stringify('running'), clock: JSON.stringify(clock) });
  t += 1000;
  assert.equal(remote.clock().beats, 4, 'two beats a second at 120');
  bridge.push({ clock: JSON.stringify({ ...clock, blocked: true }) });
  t += 1000;
  assert.equal(remote.clock().beats, 2, 'waiting on a note: it stands');
});

test('a field that did not change keeps its object, so the staff is not rebuilt', () => {
  const src = local();
  src.backend.start();
  for (const label of ['Basics', 'Scales', 'Major', 'Up & down']) select(src, label);
  const flat = encodeViewModel(viewModel(src.backend.session));
  const bridge = fakeBridge();
  const remote = createSchwungSession({ bridge, now: () => 0 });
  const seen = [];
  remote.subscribe((vm) => seen.push(vm));
  remote.start();
  bridge.push(flat);
  bridge.push({ ...flat, clock: JSON.stringify({ ...JSON.parse(flat.clock), beats: 1 }) });
  assert.equal(seen.length, 2);
  assert.equal(seen[1].chart, seen[0].chart, 'the same chart object');
  assert.notEqual(seen[1].clock, seen[0].clock);
  const other = JSON.stringify({ ...JSON.parse(flat.chart), name: 'Other' });
  bridge.push({ chart: other });
  assert.notEqual(seen.at(-1).chart, seen[0].chart, 'a new chart is a new object');
  assert.equal(seen.at(-1).chart.name, 'Other');
  const before = seen.length;
  bridge.push({ chart: other });
  assert.equal(seen.length, before, 'the same text again is no update at all');
});

/* The Move stamps its clock with its own time: a picture that arrives late
 * puts the playhead where the Move is NOW, not where it was. */
test('a late picture still puts the playhead where the Move is now', () => {
  let t = 0;
  const bridge = fakeBridge();
  const remote = createSchwungSession({ bridge, now: () => t });
  remote.start();
  const clock = { beats: 0, bpm: 120, perBeatMs: 500, running: true, paused: false, blocked: false, waitAt: null };
  /* Move time 10000 is page time 100 + 20 ms of delay. */
  t = 10020;
  bridge.push({ screen: JSON.stringify('running'), clock: JSON.stringify({ ...clock, t: 10000 }) });
  /* The next picture, taken at Move time 11000 (beat 2), arrives 300 ms late. */
  t = 11320;
  bridge.push({ clock: JSON.stringify({ ...clock, t: 11000, beats: 2 }) });
  assert.ok(Math.abs(remote.clock().beats - 2.6) < 0.01, `beat ${remote.clock().beats}`);
});

test('actions go to the Move as one parameter write each', () => {
  const bridge = fakeBridge();
  const remote = createSchwungSession({ bridge });
  remote.dispatch({ type: 'noteOn', pitch: 60, vel: 90 });
  assert.deepEqual(bridge.sent, [['overtake_dsp:action', '{"type":"noteOn","pitch":60,"vel":90}']]);
});

test('the page picks the Move when Schwung is there, and can be told', () => {
  assert.equal(chooseBackend({}), 'local');
  assert.equal(chooseBackend({ bridge: {} }), 'schwung');
  assert.equal(chooseBackend({ bridge: {}, search: '?backend=local' }), 'local');
  assert.equal(chooseBackend({ search: '?backend=schwung' }), 'schwung');
  assert.equal(chooseBackend({ search: '?backend=bogus' }), 'local');
});
