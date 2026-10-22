// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * layout_audit.test.mjs — nothing on any screen may overlap anything else.
 *
 * This exists because five of the nine screens shipped with a collision on
 * them, and none of the 422 tests noticed. Each one was invisible to the sort
 * of test we had: a pixel assertion says "there is ink at (x,y)", and two
 * strings printed on top of each other produce ink in exactly the same place
 * as one string does.
 *
 * So this audits the DRAW CALLS rather than the pixels. The ctx is wrapped to
 * record every text() with its measured width, and every full-width 1px
 * fillRect as a rule; four invariants are then checked per screen. The screens
 * are driven with worst-case content — three-digit rates and streaks, the
 * longest drill label, the longest footer each view can produce — because the
 * defects all needed a long number to show themselves and every one of them
 * looked fine with the tidy values a hand-written fixture uses.
 *
 * The eight failures found on 2026-09-24 are each a case below. A screen added
 * later gets the same coverage by being added to SCREENS.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createScreen } from '../tools/screen_buffer.mjs';
import * as V from '../src/view.mjs';
import * as L from '../src/layout.mjs';
import { makeRecord } from '../src/stats.mjs';
import { scaleRun } from '../src/generator.mjs';
import { createRun, expireMissed } from '../src/scoring.mjs';
import { hintFor } from '../src/hints.mjs';
import { welcomePages, tipCard, TIP_KEYS, PLACEMENT } from '../src/tips.mjs';
import { sheetFor, LABELS } from '../src/row_sheet.mjs';

/*
 * A ctx that draws normally and keeps a transcript of what it was asked to.
 *
 * Erasure has to be modelled or the transcript lies: the ready view draws the
 * whole reading view and then blanks the bottom band before writing its own
 * hint there, so the progress counter underneath is intent that never reaches
 * the screen. A text fully covered by a LATER blanking rect is dropped.
 */
function probe() {
  const c = createScreen();
  const texts = [];
  const rules = [];
  const erases = [];
  const text = c.text.bind(c);
  const fillRect = c.fillRect.bind(c);
  let seq = 0;
  c.text = (x, y, s, v) => {
    if (s) texts.push({ x, y, w: c.textWidth(s), s, seq: seq++ });
    return text(x, y, s, v);
  };
  c.fillRect = (x, y, w, h, v) => {
    if (v && x <= 0 && w >= L.SCREEN_W && h === 1) rules.push(y);
    if (!v) erases.push({ x, y, w, h, seq });
    seq++;
    return fillRect(x, y, w, h, v);
  };
  c.transcript = () => ({
    texts: texts.filter((t) => !erases.some((e) => e.seq > t.seq
      && e.x <= t.x && e.x + e.w >= t.x + t.w
      && e.y <= t.y && e.y + e.h >= t.y + L.TEXT_H)),
    rules,
  });
  return c;
}

/* Every way one draw can spoil another, as one list of complaints. */
function collisions(c) {
  const { texts, rules } = c.transcript();
  const bad = [];
  for (const t of texts) {
    if (t.x < 0 || t.x + t.w > L.SCREEN_W) {
      bad.push(`off screen: ${JSON.stringify(t.s)} spans x=${t.x}..${t.x + t.w}`);
    }
    if (t.y < 0 || t.y + L.TEXT_H > L.SCREEN_H) {
      bad.push(`off screen: ${JSON.stringify(t.s)} at y=${t.y}`);
    }
    for (const r of rules) {
      if (r > t.y && r < t.y + L.TEXT_H) {
        bad.push(`rule at y=${r} cuts ${JSON.stringify(t.s)} at y=${t.y}`);
      }
    }
  }
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i];
      const b = texts[j];
      if (Math.abs(a.y - b.y) >= L.TEXT_H) continue;
      if (a.x + a.w <= b.x || b.x + b.w <= a.x) continue;
      bad.push(`${JSON.stringify(a.s)} @${a.x},${a.y} over ${JSON.stringify(b.s)} @${b.x},${b.y}`);
    }
  }
  return bad;
}

const chart = scaleRun({ rootPc: 0, direction: 'updown', bpm: 80 });

/* A card as ui.js draws one: its paragraphs wrapped by the panel's font. */
function card(c, page, at, pages, footer) {
  return V.drawCard(c, {
    title: page.title, lines: V.cardLines(c, page), choices: page.choices || null, choice: 0,
    page: at, pages, footer,
  });
}

function records(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(makeRecord({
      drill: 'guess:chords:types', n: 20, ms: 9000 - i * 50, wrong: i % 5, hints: 0, at: i * 86400000,
    }));
  }
  return out;
}

/*
 * Worst case for each screen, not a typical one. Three digits everywhere a
 * number can reach three digits, and the longest string each view can select:
 * every collision found in the audit needed one of those to appear.
 */
/* An exercise's attempts, at the cap, every score from 0 to 100 and both stages. */
function attempts(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push([i, (i * 37) % 101, 1 + (i % 2), 80, 0]);
  return out;
}

const SCREENS = {
  'exercise result, worst case': (c) => V.drawExerciseResult(c, {
    name: 'Scarborough Fair L3 Both hands', percent: 100, hits: 188, total: 188, wrong: 120,
    stage: 2, passed: 2, isBest: true, history: attempts(24), footer: 'REC again  CLICK next',
  }),
  'exercise result, stage 1 passed': (c) => V.drawExerciseResult(c, {
    name: 'Major up & down', percent: 91, hits: 15, total: 15, wrong: 0,
    stage: 1, passed: 1, history: attempts(1), footer: 'CLICK S2  SHIFT next',
  }),
  'exercise result, first try': (c) => V.drawExerciseResult(c, {
    name: 'x', percent: 0, hits: 0, total: 999, wrong: 0, stage: 1, passed: 0, history: [],
  }),
  'quiz result, a stage passed with hints': (c) => V.drawRoundResult(c, {
    rate: 144, ms: 480000, n: 30, wrong: 12, bestStreak: 100, hints: 22,
    best: 144, isBest: false, records: records(12), passed: 1, footer: 'CLICK S2  SHIFT next',
  }),
  'quiz result, right %': (c) => V.drawResultPage(c, {
    page: 1, rate: 30, ms: 60000, n: 30, wrong: 2, bestStreak: 9, hints: 0, best: 30, success: 100,
    records: records(12), answers: [],
  }),
  'quiz result, answers': (c) => V.drawResultPage(c, {
    page: 2, rate: 30, ms: 60000, n: 30, wrong: 2, bestStreak: 9, hints: 0, best: 30, success: 94,
    records: records(3),
    answers: [
      { key: 'd12', label: 'Diminished 12th', asked: 12, right: 12, allAsked: 999, allRight: 998 },
      { key: 'harmonicMinor', label: 'Harmonic minor', asked: 10, right: 0, allAsked: 10, allRight: 0 },
      { key: 'first', label: 'Second bigger', asked: 1, right: 1, allAsked: 1, allRight: 1 },
      { key: 'C#', label: 'C#', asked: 99, right: 98, allAsked: 99, allRight: 50 },
    ],
  }),
  'progress list, decorated': (c) => V.drawList(c, 'PROGRESS 100%', [
    { label: 'Overall' }, { label: 'Reading track' },
    { label: 'Scarborough Fair L3 Both hands' }, { label: 'Name chords advanced' },
  ], 2, {
    footer: 'CLICK chart BACK list', centreFooter: true,
    decorate: (r) => ({ value: '100%', mark: r.label === 'Overall' ? null : 'done' }),
  }),
  'learning program list': (c) => V.drawList(c, 'LEARNING PROGRAM', [
    { label: 'Continue' }, { label: 'Skip next' }, { label: 'Reading' }, { label: 'Repetition' },
  ], 0, {
    footer: V.FOLDER_HINT, centreFooter: true,
    decorate: (r) => (r.label === 'Continue'
      ? { label: 'Next: Scarborough Fair L1 RH', value: 'S2', mark: 'next' }
      : r.label === 'Repetition' ? { value: '5 due' } : { value: '100% >', mark: 'half' }),
  }),
  'item progress': (c) => V.drawItemProgress(c, {
    title: 'Scarborough Fair L3 Both hands', history: attempts(24), percent: 100, best: 100,
    mark: 'half', index: 98, count: 99,
  }),
  'item progress, never played': (c) => V.drawItemProgress(c, {
    title: 'x', history: [], percent: 0, best: 0, mark: null, index: 0, count: 1,
  }),
  'overview': (c) => V.drawOverview(c, {
    title: 'Reading', percent: 100, done: 551, half: 551, count: 551,
    timeline: { points: [{ x: 0, y: 29 }, { x: 121, y: 0 }], total: 1102 }, index: 4, total: 99,
  }),
  'overview, nothing yet': (c) => V.drawOverview(c, {
    title: 'Overall', percent: 0, done: 0, half: 0, count: 551, timeline: { points: [], total: 0 },
    index: 0, total: 1,
  }),
  'info, long and scrolled': (c) => V.drawInfo(c, {
    title: 'Scarborough Fair L3 Both hands',
    lines: Array.from({ length: 30 }, (_, i) => ({ text: 'Line ' + i + ' of an Info page here', head: i % 7 === 0 })),
    scroll: 12, footer: 'JOG scroll BACK close',
  }),
  'info, short': (c) => V.drawInfo(c, {
    title: 'Continue', lines: [{ text: 'Opens the next step.', head: false }], scroll: 0, footer: 'BACK close',
  }),
  'ready, stage 2': (c) => V.drawReadyView(c, {
    chart, run: createRun(chart), songBeats: 0, pxPerBeat: 48, outLabel: 'trk+USB 16',
    footer: hintFor('ready', { stages: true, stage: 2 }).at(-1),
  }),
  /* The options sheet at its longest: a stage row, every option it can have. */
  'sheet, a stage': (c) => V.drawList(c, '3 SHAPES AND TIME', Object.values(LABELS).map((label) => ({ label })), 3, {
    footer: hintFor('sheet')[0], centreFooter: true,
  }),
  'sheet, Continue': (c) => V.drawList(c, 'CONTINUE', sheetFor({ continueRow: true }, { continueSkippable: () => true }), 0, {
    footer: hintFor('sheet')[1], centreFooter: true,
  }),
  'top list, Continue naming a long step': (c) => V.drawList(c, 'EXERCISE', [
    { label: 'Continue' }, { label: 'Path' }, { label: 'Practice' }, { label: 'Quiz' },
  ], 0, {
    footer: hintFor('menu', { top: true })[0], centreFooter: true,
    decorate: (r) => (r.label === 'Continue'
      ? { label: 'Continue', value: 'Scarborough Fair L3 Both hands', short: '4.5' } : { value: '100% >', mark: 'half' }),
  }),
  'top list, a review due': (c) => V.drawList(c, 'EXERCISE', [{ label: 'Continue' }], 0, {
    footer: hintFor('menu', { top: true, shift: true })[0], centreFooter: true,
    decorate: () => ({ label: 'Review', value: 'Name chords advanced', short: '' }),
  }),
  'card, welcome': (c) => card(c, welcomePages()[0], 0, 3, hintFor('card', { pages: 3 })[0]),
  'card, keys': (c) => card(c, welcomePages()[1], 1, 3, hintFor('card', { pages: 3 })[0]),
  'card, new to piano': (c) => card(c, welcomePages()[2], 2, 3, hintFor('card', { choice: true })[0]),
  'card, the longest tip': (c) => card(c, tipCard(PLACEMENT), 0, 1, hintFor('card', { pages: 1 })[0]),
  'result, worst case': (c) => V.drawRoundResult(c, {
    rate: 144, ms: 480000, n: 30, wrong: 12, bestStreak: 100, hints: 2,
    best: 144, isBest: false, records: records(12),
  }),
  'result, personal best': (c) => V.drawRoundResult(c, {
    rate: 8, ms: 150000, n: 20, wrong: 0, bestStreak: 20, hints: 0,
    best: 8, isBest: true, records: records(1),
  }),
  'result, no history yet': (c) => V.drawRoundResult(c, {
    rate: 31, ms: 43900, n: 20, wrong: 3, bestStreak: 9, hints: 0,
    best: 0, isBest: true, records: [],
  }),
  'progress': (c) => V.drawProgress(c, {
    drill: 'guess:chords:types', records: records(40), drillIndex: 6, drillCount: 12,
  }),
  'progress, one drill': (c) => V.drawProgress(c, {
    drill: 'hear:notes:half', records: records(1), drillIndex: 0, drillCount: 1,
  }),
  'progress, nothing yet': (c) => V.drawProgress(c, {
    drill: null, records: [], drillIndex: 0, drillCount: 0,
  }),
  'pick, hint available': (c) => V.drawPick(c, {
    title: 'NAME CHORD', score: '19/20', index: 2, options: ['Cmaj7', 'Cm7', 'C7'],
    hint: 'which pad is lit?', footer: 'JOG pick  REC help',
  }),
  'pick, an option struck out': (c) => V.drawPick(c, {
    title: 'NAME NOTE', score: '19/20', index: 0, options: ['F#4', 'G4', 'E4'],
    eliminated: [2], footer: 'JOG pick  CLICK ok',
  }),
  'pick, a long list scrolled to the middle': (c) => V.drawPick(c, {
    title: 'HEAR INT UP', score: '19/20', index: 6,
    options: ['Minor 2nd', 'Major 2nd', 'Minor 3rd', 'Major 3rd', 'Perfect 4th', 'Tritone',
      'Perfect 5th', 'Minor 6th', 'Major 6th', 'Minor 7th', 'Half-dim 7th', 'Octave'],
    short: ['m2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8'],
    hint: 'which interval?', footer: 'PAD answer  REC help',
  }),
  'pick, a map with no short names given': (c) => V.drawPick(c, {
    title: 'HEAR DEGREES', score: '19/20', index: 6,
    options: ['Perfect 5th', 'Minor 6th', 'Major 6th', 'Minor 7th', 'Half-dim 7th', 'Octave', 'Tonic'],
    hint: 'which degree?', footer: 'PAD or JOG  CLICK ok',
  }),
  'pick, four answers with colours': (c) => V.drawPick(c, {
    title: 'HEAR TRIADS', score: '19/20', index: 3, eliminated: [1],
    options: ['Major', 'Minor', 'Diminished', 'Augmented triad, inverted'],
    colours: ['blue', 'orange', 'cyan', 'pink'],
    hint: 'which triad?', footer: 'PAD answer  REC help',
  }),
  'guess': (c) => V.drawGuessView(c, {
    prompt: [60, 64, 67], fifths: 0, title: 'CHORD', score: '19/20',
    footer: 'hint 2/2   streak 100',
  }),
  /* The widest name lane the advanced set can produce: a five-note chord with
   * a long suffix, in a flat key where every note carries an accidental.
   * Measured across all 2568 quality x root x key combinations. */
  'guess, widest advanced chord': (c) => V.drawGuessView(c, {
    prompt: [61, 66, 68, 71, 75], fifths: -5, title: 'CHORD', score: '19/20',
    label: 'Db9sus4', footer: 'hint 2/2   streak 100',
  }),
  'guess, a chord with no name': (c) => V.drawGuessView(c, {
    prompt: [60, 62, 64], fifths: 0, title: 'CHORD', score: '1/20',
    footer: 'streak 0   REC help',
  }),
  'guess, hidden with a hint': (c) => V.drawGuessView(c, {
    prompt: [60, 64, 67], fifths: 0, hidden: true, hint: 1, label: 'Cmaj7',
    title: 'HEAR', score: '19/20', footer: 'streak 100   REC help',
  }),
  'exercise list': (c) => V.drawList(c, 'EXERCISE', [
    { label: 'Guess: chords all types', value: 'q' },
    { label: 'Hear: chords all types', value: 'q' },
    { label: 'Name: chords all types', value: 'q' },
    { label: 'C major scale, two octaves', value: 'f' },
  ], 0, { footer: hintFor('menu', { top: true })[0], centreFooter: true }),
  /* "Key = C# mixolydian" is the widest row this module can actually produce,
   * at 114px; the second fixture is past anything real, to prove the label is
   * fitted against the value rather than against a fixed budget. */
  'settings list': (c) => V.drawList(c, 'SETTINGS', [
    { label: 'Scale', value: 'Maj Pentatonic' },
    { label: 'Chords', value: 'advanced' },
    { label: 'MIDI out', value: 'trk+USB' },
  ], 0, { footer: 'CLICK edit SHIFT back' }),
  'settings list, editing': (c) => V.drawList(c, 'SETTINGS', [
    { label: 'Scale', value: 'Maj Pentatonic' },
  ], 0, { footer: 'turn change  CLICK ok', editing: true }),
  'settings list, an implausibly long value': (c) => V.drawList(c, 'SETTINGS', [
    { label: 'Read ahead', value: '48 pixels per beat' },
  ], 0, { footer: 'turn change  CLICK ok', editing: true }),
  'ready': (c) => V.drawReadyView(c, {
    chart, run: createRun(chart), songBeats: 0, pxPerBeat: 48, outLabel: 'trk+USB 16',
  }),
  /* Scrubbed away from the start: the box is gone and the reading view is bare. */
  'ready, scrubbed': (c) => V.drawReadyView(c, {
    chart, run: createRun(chart), songBeats: 6, pxPerBeat: 48, outLabel: 'trk+USB 16',
  }),
  'reading': (c) => V.drawReadingView(c, {
    chart, run: createRun(chart), songBeats: 2.5, pxPerBeat: 24,
  }),
  'reading, paused': (c) => V.drawReadingView(c, {
    chart, run: createRun(chart), songBeats: 2.5, pxPerBeat: 24, paused: true,
  }),
  'reading, paused, with its hint': (c) => V.drawReadingView(c, {
    chart, run: createRun(chart), songBeats: 2.5, pxPerBeat: 24, paused: true,
    footer: hintFor('running', { paused: true })[0],
  }),
  'reading, count-in, with its hint': (c) => V.drawReadingView(c, {
    chart, run: createRun(chart), songBeats: -3, pxPerBeat: 24, footer: hintFor('running', {})[0],
  }),
  'reading, stuck on a chord': (c) => {
    const run = createRun(chart, { bpm: 80, graceBeats: 1 });
    expireMissed(run, 3, true);
    return V.drawReadingView(c, { chart, run, songBeats: 0, pxPerBeat: 24, blocked: true });
  },
};

for (const [name, draw] of Object.entries(SCREENS)) {
  test(`nothing overlaps on: ${name}`, () => {
    const c = probe();
    draw(c);
    const bad = collisions(c);
    assert.deepEqual(bad, [], `${name}\n  ` + bad.join('\n  '));
  });
}

/* ---- The specific faults, so a regression names itself ------------------- */

test('the name-lane rule is drawn only by the views that have a name lane', () => {
  const laned = ['reading', 'guess', 'ready'];
  for (const [name, draw] of Object.entries(SCREENS)) {
    const c = probe();
    draw(c);
    const has = c.transcript().rules.indexOf(L.NAME_RULE_Y) >= 0;
    const wants = laned.some((k) => name.startsWith(k));
    assert.equal(has, wants, `${name}: lane rule ${has ? 'drawn' : 'missing'}`);
  }
});

test('the ready view puts one label in the header, not two', () => {
  const c = probe();
  SCREENS.ready(c);
  const header = c.transcript().texts.filter((t) => t.y < L.HEADER_H);
  /* Left title and one right label. Two right-aligned labels is the bug: the
   * MIDI-out text used to be printed over the top of bar.beat. */
  assert.equal(header.length, 2);
  assert.equal(header.filter((t) => t.x + t.w > L.SCREEN_W - 4).length, 1);
});

test('every footer this module can show fits across the screen', () => {
  const c = createScreen();
  const footers = [
    'JOG 99/99  BACK list', 'JOG drill 12/12', '24 plays', '99 rounds', 'BACK list', 'JOG next  BACK list',
  ];
  /* Every part of every hint, in every state the table distinguishes. */
  const states = [{}, { top: true }, { scrolls: true }, { pages: 3 }, { pages: 1 }, { choice: true },
    { stages: true, stage: 1 }, { stages: true, stage: 2 }, { listening: true }, { paused: true },
    { paused: true, listening: true }, { quiz: true, twoNext: true }, { ear: true, hintsLeft: true },
    { ear: true }, { pick: true, hintsLeft: true }, { pick: true }, { hintsLeft: true, streak: 999 },
    { streak: 999 }, { editing: true }, { action: true }];
  for (const screen of ['menu', 'ready', 'running', 'settings', 'guess', 'summary', 'progress',
    'progress-detail', 'info', 'sheet', 'card']) {
    for (const st of states) footers.push(...hintFor(screen, st), ...hintFor(screen, { ...st, shift: true }));
  }
  for (const f of footers) {
    assert.ok(c.textWidth(f) <= L.TEXT_MAX_PX, `${JSON.stringify(f)} is ${c.textWidth(f)}px`);
  }
});

/* A page of text — help, the welcome, a tip — wraps to the width beside its
 * scrollbar, measured in the panel's font; a page longer than five lines
 * scrolls. */
test('every line of every card fits beside the scrollbar', () => {
  const c = createScreen();
  for (const page of welcomePages().concat(TIP_KEYS.concat([PLACEMENT]).map(tipCard).filter(Boolean))) {
    for (const line of V.cardLines(c, page)) {
      assert.ok(c.textWidth(line) <= L.INFO_TEXT_PX, `${page.title}: "${line}" is ${c.textWidth(line)}px`);
    }
    for (const choice of page.choices || []) assert.ok(c.textWidth(choice) <= L.INFO_TEXT_PX, choice);
  }
});

/* Every option of the sheet fits its row whole, even beside a scrollbar:
 * a cut "I know all this: ski" is how this test came to be. */
test('every option of the sheet fits its row', () => {
  const c = createScreen();
  for (const label of Object.values(LABELS)) {
    assert.ok(c.textWidth(label) <= L.INFO_TEXT_PX, `"${label}" is ${c.textWidth(label)}px`);
    const probeList = probe();
    V.drawList(probeList, 'X', [{ label }], 1, {});
    assert.ok(probeList.transcript().texts.some((t) => t.s === label), `"${label}" is cut on the list`);
  }
});

test('Continue names its step, or its unit\'s number when the name does not fit', () => {
  const draw = (value, short) => {
    const c = probe();
    V.drawList(c, 'PIANO', [{ label: 'Continue' }], 0, { decorate: () => ({ label: 'Continue', value, short }) });
    return c.transcript().texts.map((t) => t.s);
  };
  assert.ok(draw('Ode to Joy', '1.8').includes('Ode to Joy'), 'whole when it fits');
  const long = draw('Notes by alphabet', '1.1');
  assert.ok(long.includes('1.1') && !long.some((t) => /Notes/.test(t)), 'never cut: ' + long);
  const c = createScreen();
  assert.equal(V.fitWords(c, 'Scarborough Fair L3 Both hands', 110), 'Scarborough L3', 'a title by whole words');
});
