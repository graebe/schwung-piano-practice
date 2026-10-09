// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * app_logic.test.mjs — the page's two pure decisions: what the keys show, and
 * how a run's judgements become the staff's.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { feedbackFor, keyStates, padStates, keyboardRange } from '../src/app/feedback.js';
import { staffEvents, staffJudgements, staffMarkers, runSummary } from '../src/app/chart-view.js';

test('a press earns a flash: wrong on the key, a right answer lit whole', () => {
  assert.deepEqual(feedbackFor(null, 60, null), []);
  assert.deepEqual(feedbackFor({ kind: 'judged', result: 'perfect' }, 60), [[60, 'hit']]);
  assert.deepEqual(feedbackFor({ kind: 'judged', result: 'hit' }, 60), [[60, 'hit']]);
  assert.deepEqual(feedbackFor({ kind: 'judged', result: 'late' }, 60), [[60, 'miss']]);
  assert.deepEqual(feedbackFor({ kind: 'judged', result: 'stray' }, 61), [[61, 'miss']]);
  assert.deepEqual(feedbackFor({ kind: 'quiz', res: 'wrong' }, 61), [[61, 'miss']]);
  assert.deepEqual(feedbackFor({ kind: 'quiz', res: 'correct' }, 60, { quiz: { prompt: [60, 64, 67] } }),
    [[60, 'hit'], [64, 'hit'], [67, 'hit']]);
  assert.deepEqual(feedbackFor({ kind: 'quiz', res: 'correct' }, 60, { quiz: { prompt: null } }), [[60, 'hit']]);
  assert.deepEqual(feedbackFor({ kind: 'quiz', res: 'incomplete' }, 60), []);
});

test('the keys show the cue, under the hands, under a flash', () => {
  assert.equal(keyStates(null).size, 0);
  const vm = { cue: { target: [60], near: true, stuck: [62], sounding: [64], prompt: [65] }, revealed: [67] };
  const s = keyStates(vm, new Set([62]), new Map([[64, { state: 'miss', until: 1 }]]));
  assert.equal(s.get(60), 'target');
  assert.equal(s.get(62), 'held', 'a finger outranks the cue');
  assert.equal(s.get(64), 'miss', 'a flash outranks everything');
  assert.equal(s.get(65), 'lit');
  assert.equal(s.get(67), 'hit');
});

test('the pads say how close the next note is', () => {
  assert.equal(padStates(null).size, 0);
  assert.equal(padStates({ cue: { target: [60], near: false } }).get(60), 'coming');
  assert.equal(padStates({ cue: { target: [60], near: true } }).get(60), 'now');
  const s = padStates({ cue: { stuck: [62], sounding: [64], prompt: [65] }, revealed: [67] },
    new Set([69]), new Map([[71, { state: 'hit', until: 1 }]]));
  assert.deepEqual([62, 64, 65, 67, 69, 71].map((p) => s.get(p)), ['now', 'now', 'now', 'hit', 'held', 'hit']);
});

test('the keyboard spans the piece, from a C, within bounds', () => {
  assert.deepEqual(keyboardRange(null), { lowest: 48, octaves: 3 });
  assert.deepEqual(keyboardRange({ chart: { events: [{ pitches: [62] }, { pitches: [74] }] } }), { lowest: 60, octaves: 2 });
  assert.deepEqual(keyboardRange({ chart: { events: [{ pitches: [40, 100] }] } }), { lowest: 36, octaves: 4 });
  assert.deepEqual(keyboardRange({ chart: { events: [{ pitches: [40, 100] }] } }, { max: 2 }), { lowest: 36, octaves: 2 });
  assert.deepEqual(keyboardRange({ screen: 'guess', quiz: { prompt: [70] }, chart: null }), { lowest: 60, octaves: 2 });
});

const chart = {
  bpm: 60,
  events: [
    { beat: 0, dur: 1, pitches: [67, 60, 64], hand: 'r', symbol: 'C' },
    { beat: 1, dur: 1, pitches: [62], hand: 'r', symbol: null },
    { beat: 2, dur: 2, pitches: [65], hand: 'l', symbol: null },
  ],
};

test('events keep their order and gain an index', () => {
  assert.deepEqual(staffEvents(null), []);
  const ev = staffEvents(chart);
  assert.deepEqual(ev.map((e) => e.index), [0, 1, 2]);
  assert.equal(ev[2].durBeats, 2);
  assert.equal(ev[0].symbol, 'C');
});

test('judgements follow the written order, graded by the scoring windows', () => {
  assert.deepEqual(staffJudgements(null, null), []);
  /* The run keeps notes sorted: 60, 64, 67. At 60bpm a beat is 1000ms. */
  const run = { notes: ['hhm', 'h', 'p'], offsets: [[0.03, 0.1, 0], [0.5], [0]] };
  const j = staffJudgements(chart, run);
  assert.deepEqual(j[0], ['missed', 'hit', 'good'], 'written 67,60,64 -> sorted codes m,h,h');
  assert.deepEqual(j[1], ['late']);
  assert.deepEqual(j[2], ['pending']);
});

test('a press near no note of its pitch is a stray', () => {
  assert.deepEqual(staffMarkers(null, null), []);
  const m = staffMarkers(chart, { markers: [[0.05, 60], [1.2, 62], [1.1, 70]] });
  assert.deepEqual(m.map((x) => x.stray), [false, false, true]);
  assert.equal(runSummary(null), null);
  assert.deepEqual(runSummary({ stats: { hits: 2, misses: 1, strays: 3, total: 9 } }), { hits: 2, misses: 1, strays: 3, total: 9 });
});

import { readFileSync } from 'node:fs';
import { inPageWords, PHRASES } from '../src/app/words.js';

test('the session\'s Move words are said the page\'s way', () => {
  assert.equal(inPageWords('Ode. Stage 1. Press play to start.'), 'Ode. Stage 1. Listen or Practice to start.');
  assert.equal(inPageWords(null), '');
  /* Every announcement in the session that names a Move control is covered. */
  const src = readFileSync(new URL('../../src/session.mjs', import.meta.url), 'utf8');
  const said = [...src.matchAll(/announce\(([^;]*)\);/g)].map((m) => m[1]);
  const naming = said.filter((s) => /\b(jog|click|pads?|press play|record|shift)\b/i.test(s));
  for (const s of naming) {
    assert.ok(PHRASES.some(([move]) => s.includes(move.trim())), `not in words.js: ${s}`);
  }
});
