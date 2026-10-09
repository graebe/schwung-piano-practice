// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  TERMS, infoFor, infoParagraphs, wrapLines, chordFormula, chordInC, stepPattern,
} from '../src/info.mjs';
import { buildCatalog, isFolder } from '../src/catalog.mjs';
import { buildProgram, programFolder, trackSteps } from '../src/program.mjs';
import { parseManifest, parseCategories, parseExercise } from '../src/exercise_io.mjs';
import { qualityById, ALL_QUALITIES } from '../src/chords.mjs';
import { MODES } from '../src/generator.mjs';
import { EXERCISES } from '../src/ear.mjs';
import { drillId } from '../src/stats.mjs';
import { createScreen } from '../tools/screen_buffer.mjs';
import { INFO_TEXT_PX } from '../src/layout.mjs';

const dir = new URL('../src/exercises/', import.meta.url);
const manifest = readFileSync(new URL('index.json', dir), 'utf8');
const songs = parseManifest(manifest).map((row) => ({
  chart: parseExercise(readFileSync(new URL(row.file, dir), 'utf8'), row.id).chart,
  category: row.category,
}));
const tracks = buildProgram({ songs });
const root = buildCatalog({
  songs, categories: parseCategories(manifest), lead: [programFolder(tracks)],
});
const env = { songs: Object.fromEntries(songs.map((s) => [s.chart.id, s.chart])) };

/* Every row a player can put the cursor on, lazy folders opened. */
function everyNode(node, out = []) {
  for (const child of node.children) {
    out.push(child);
    if (isFolder(child) && !child.untracked) everyNode(child, out);
  }
  return out;
}

const QUIZ_IDS = ['quiz', 'quiz/hear', 'quiz/play', 'quiz/name'];
for (const kind of ['notes', 'chords']) {
  for (const pick of [false, true]) {
    for (const opts of kind === 'notes'
      ? [{ halfTones: false }, { halfTones: true }]
      : [{ chordSet: 'triads' }, { chordSet: 'types' }, { chordSet: 'advanced' }]) {
      QUIZ_IDS.push('quiz:' + drillId({ kind, pick, ...opts }));
    }
  }
}
for (const ex of EXERCISES) QUIZ_IDS.push('quiz/hear/' + ex.key);

test('every row of the lesson tree has an Info page', () => {
  const missing = [];
  for (const node of everyNode(root)) {
    if (node.continueRow || node.skipRow) continue;
    if (!infoFor({ id: node.id, label: node.label }, env)) missing.push(node.id);
  }
  assert.deepEqual(missing, []);
});

test('every step of the program and every quiz drill has one too', () => {
  const ids = QUIZ_IDS.slice();
  for (const t of tracks) for (const step of trackSteps(t)) ids.push(step.id);
  const missing = ids.filter((id) => !infoFor({ id }, env));
  assert.deepEqual(missing, []);
});

test('the rows with no id, and the result screen, have pages of their own', () => {
  for (const kind of ['continue', 'skip', 'progress', 'result']) {
    assert.ok(infoFor({ kind }), kind);
  }
  assert.equal(infoFor(null), null);
  assert.equal(infoFor({ id: '' }), null);
  assert.equal(infoFor({ id: 'nothing/like/this' }), null);
});

test('every term a page uses is in the glossary, and every glossary term is used', () => {
  const used = new Set();
  const ids = QUIZ_IDS.concat(everyNode(root).map((n) => n.id).filter(Boolean));
  for (const kind of ['continue', 'skip', 'progress', 'result']) ids.push({ kind });
  for (const id of ids) {
    const p = infoFor(typeof id === 'string' ? { id } : id, env);
    if (!p) continue;
    for (const t of p.terms) {
      assert.ok(TERMS[t], `${p.key} uses "${t}", which the glossary does not define`);
      used.add(t);
    }
  }
  const unused = Object.keys(TERMS).filter((t) => !used.has(t));
  assert.deepEqual(unused, [], 'defined but never shown');
});

test('every page wraps to the screen, and nothing is lost in the wrapping', () => {
  const c = createScreen();
  const width = (s) => c.textWidth(s);
  const ids = QUIZ_IDS.concat(everyNode(root).map((n) => n.id).filter(Boolean));
  for (const id of ids) {
    const p = infoFor({ id }, env);
    if (!p) continue;
    const paras = infoParagraphs(p);
    const lines = wrapLines(paras, INFO_TEXT_PX, width);
    for (const l of lines) assert.ok(width(l.text) <= INFO_TEXT_PX, `${id}: "${l.text}"`);
    const words = (xs) => xs.map((x) => x.text).join(' ').split(/\s+/).filter(Boolean).join(' ');
    assert.equal(words(lines), words(paras), id);
  }
});

test('a word longer than a line is cut, not run off the screen', () => {
  const lines = wrapLines([{ text: 'a ' + 'x'.repeat(30) + ' b', head: false }], 60, (s) => s.length * 6 - 1);
  assert.ok(lines.every((l) => l.text.length * 6 - 1 <= 60));
  assert.equal(lines.map((l) => l.text).join(''), 'a' + 'x'.repeat(30) + 'b');
});

test('headings keep their case: ii-V-I is not II-V-I', () => {
  const p = infoFor({ id: 'basics/progressions/ii-V-I/3' });
  const head = infoParagraphs(p).find((x) => x.head);
  assert.equal(head.text, 'ii-V-I');
});

test('chord formulas are spelled from C by letter, so the notes agree with them', () => {
  assert.deepEqual(chordFormula(qualityById('min')), ['1', 'b3', '5']);
  assert.equal(chordInC(qualityById('maj')), 'C E G');
  assert.equal(chordInC(qualityById('min')), 'C Eb G');
  assert.equal(chordInC(qualityById('dim7')), 'C Eb Gb Bbb');
  assert.equal(chordInC(qualityById('aug')), 'C E G#');
  assert.equal(chordInC(qualityById('m7b5')), 'C Eb Gb Bb');
  assert.equal(chordInC(qualityById('13')), 'C E G Bb D A');
  for (const q of ALL_QUALITIES) {
    assert.ok(!/undefined|NaN/.test(chordInC(q)), q.id);
    assert.equal(chordFormula(q).length, q.intervals.length, q.id);
  }
});

test('scale step patterns come from the scale itself', () => {
  assert.equal(stepPattern(MODES.major), 'W W H W W W H');
  assert.equal(stepPattern(MODES.minor), 'W H W W H W W');
  assert.equal(stepPattern(MODES.harmonicMinor), 'W H W W H W+H H');
  assert.equal(stepPattern(MODES.majorPent), 'W W W+H W W+H');
});

test('progressions read in C, or in A minor', () => {
  const text = (id) => infoParagraphs(infoFor({ id })).map((x) => x.text).join(' ');
  assert.match(text('basics/progressions/I-V-vi-IV'), /In C: C G Am F/);
  assert.match(text('basics/progressions/i-VI-III-VII'), /In A minor: Am F C G/);
  assert.match(text('basics/progressions/ii-V-I'), /In C: Dm7 G7 Cmaj7/);
});

test('a page is one per kind of practice, so the first-time Info shows once a kind', () => {
  const key = (id) => infoFor({ id }, env).key;
  assert.equal(key('basics/scales/major/up'), key('basics/scales/dorian/thirds'));
  assert.equal(key('song:ode-to-joy/1r'), key('song:twinkle/3'));
  assert.notEqual(key('quiz:ear:steps:key'), key('quiz:ear:thirds:up'));
  assert.equal(key('quiz:ear:thirds:up'), key('quiz:ear:thirds:down'));
});

test('a song page names its key signature and tempo', () => {
  const text = infoParagraphs(infoFor({ id: 'song:twinkle/3' }, env)).map((x) => x.text).join(' ');
  assert.match(text, /3 sharps/);
  assert.match(text, /Tempo \d+/);
  assert.match(text, /L3: both hands/);
});
