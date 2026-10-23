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
import { makePlace } from '../src/pathmap/model.mjs';
import { layoutPlaces } from '../src/pathmap/layout.mjs';
import { createWalk, walkTo } from '../src/pathmap/walk.mjs';
import { mapTitle } from '../src/map_places.mjs';
import { createGrow, startGrow } from '../src/home/render.mjs';
import { PRACTICE_PIANO } from '../src/home/icons.mjs';
import * as TRAIN from '../src/trainer.mjs';

/* A map at its worst: long names, three-digit percents, reviews due. */
/* A trainer's knob screen as the session hands it to the view. */
function knobScreen(c, subject, circle, stored, focus) {
  const setup = TRAIN.coerceSetup(subject, circle, stored);
  const blocked = TRAIN.startBlock(subject, circle, setup);
  return V.drawKnobSetup(c, {
    title: (TRAIN.subjectOf(subject).name + ' ' + TRAIN.CIRCLE_LABEL[circle]).toUpperCase(),
    knobs: TRAIN.knobsOf(subject, circle, setup), focus, blocked,
    footer: hintFor('trainer-setup', { blocked, custom: setup.level === 'custom' })[0],
  });
}

const CHORD_STAFF = [{ part: 0, notes: [{ pitch: 61, diatonic: 28, alter: 1 }, { pitch: 64, diatonic: 30, alter: 0 },
  { pitch: 68, diatonic: 32, alter: 1 }, { pitch: 71, diatonic: 34, alter: 0 }] }];

function mapScreen(c, n, kind, at, opts = {}) {
  const places = Array.from({ length: n }, (_, i) => makePlace({
    label: kind === 'island' ? `${i + 1} Shapes and time` : `${3}.${i + 1} Advanced pieces`, percent: 100,
    state: ['done', 'current', 'started', 'fresh', 'skipped', 'ahead'][i % 6], due: opts.due || 0,
    kind: i === n - 1 && kind !== 'island' ? 'fort' : kind,
  }));
  const layout = layoutPlaces(n);
  const walk = createWalk(layout, at);
  if (opts.to !== undefined) walkTo(walk, opts.to, 0);
  return V.drawMapScreen(c, { place: places[at], places, layout, walk, now: opts.now || 0,
    footer: hintFor('map')[0] });
}

/* A scene (pathmap/scenes.mjs) on a map at its worst, part way through. */
function sceneScreen(c, scene, n, now) {
  const places = Array.from({ length: n }, (_, i) => makePlace({
    label: `3.${i + 1} Advanced pieces`, percent: 100, state: 'done', due: 12, kind: i === n - 1 ? 'fort' : 'temple' }));
  const map = { places, layout: layoutPlaces(n, { kind: 'island' }) };
  const sc = { ...scene, map, island: map, t0: 0 };
  if (sc.kind === 'walk') sc.walk = walkTo(createWalk(map.layout, sc.from), sc.to, 0);
  return V.drawScene(c, { scene: sc, now, footer: hintFor('anim')[0] });
}

/* Home with this module's five circles, at rest or mid-grow. */
const HOME_ITEMS = [['program', 'Learning Path', 'path'], ['basics', 'Practice', PRACTICE_PIANO], ['songs', 'Songs', 'song'],
  ['progress', 'Progress', 'progress'], ['settings', 'Settings', 'settings']]
  .map(([key, label, icon]) => ({ key, label, icon }));
function homeScreen(c, selected, opts = {}) {
  const grow = createGrow(opts.from === undefined ? selected : opts.from);
  if (opts.from !== undefined) startGrow(grow, selected, 0);
  return V.drawHomeScreen(c, { title: opts.title || 'PIANO', items: opts.items || HOME_ITEMS, selected, grow,
    now: opts.now || 0, footer: hintFor('home')[opts.part || 0] });
}
/* The rings one level down, as the session builds them. */
const ring = (rows) => rows.map(([label, icon]) => ({ key: label, label, icon }));
const PRACTICE_RING = ring([['Notes', 'note'], ['Intervals', 'interval'], ['Scales', 'stairs'], ['Chords', 'chord'],
  ['Progressions', 'progression']]);
const SONGS_RING = ring([['Classics', 'note'], ['Electronic', 'loop'], ['Techno', 'metronome'], ['Styles', 'chord']]);
const TRAINER_RING = ring([['Read', 'staff'], ['Hear', 'ear'], ['Play', 'keyletter'], ['Learn', 'book'], ['Stats', 'progress']]);

/*
 * A ctx that draws normally and keeps a transcript of what it was asked to.
 *
 * Erasure has to be modelled or the transcript lies: the ready view draws the
 * whole reading view and then blanks the bottom band before writing its own
 * hint there, so the progress counter underneath is intent that never reaches
 * the screen. A text fully covered by a LATER blanking rect is dropped, and
 * a rule cuts a text only where it still shows: a box drawn over the rule
 * (the ready screen's, across the name rule) erases it under the box.
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
    if (v && x <= 0 && w >= L.SCREEN_W && h === 1) rules.push({ y, seq });
    if (!v) erases.push({ x, y, w, h, seq });
    seq++;
    return fillRect(x, y, w, h, v);
  };
  c.transcript = () => ({
    texts: texts.filter((t) => !erases.some((e) => e.seq > t.seq
      && e.x <= t.x && e.x + e.w >= t.x + t.w
      && e.y <= t.y && e.y + e.h >= t.y + L.TEXT_H)),
    rules: rules.map((r) => r.y),
    /* Whether rule `r` still shows anywhere across x0..x1, or was blanked
     * there by something drawn after it. */
    ruleShows: (y, x0, x1) => rules.some((r) => r.y === y && !erases.some((e) => e.seq > r.seq
      && e.y <= y && e.y + e.h > y && e.x <= x0 && e.x + e.w >= x1)),
  });
  return c;
}

/* Every way one draw can spoil another, as one list of complaints. */
function collisions(c) {
  const { texts, rules, ruleShows } = c.transcript();
  const bad = [];
  for (const t of texts) {
    if (t.x < 0 || t.x + t.w > L.SCREEN_W) {
      bad.push(`off screen: ${JSON.stringify(t.s)} spans x=${t.x}..${t.x + t.w}`);
    }
    if (t.y < 0 || t.y + L.TEXT_H > L.SCREEN_H) {
      bad.push(`off screen: ${JSON.stringify(t.s)} at y=${t.y}`);
    }
    for (const r of rules) {
      if (r > t.y && r < t.y + L.TEXT_H && ruleShows(r, t.x, t.x + t.w)) {
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

/* C# major up and back down, on the staff, sharps and all. */
const LINE = (() => {
  const up = [[61, 28, 1], [63, 29, 1], [65, 30, 1], [66, 31, 1], [68, 32, 1], [70, 33, 1], [72, 34, 1], [73, 35, 1]]
    .map(([pitch, diatonic, alter]) => ({ part: 0, notes: [{ pitch, diatonic, alter }] }));
  return up.concat(up.slice(0, -1).reverse());
})();

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
  /* The split box at its worst: the last level, Solo, learned (its mark), the
   * longest level name on the bottom line beside the longest hint part. */
  'ready, level box, the last level': (c) => V.drawReadyView(c, {
    chart, run: createRun(chart), songBeats: 0, pxPerBeat: 48, outLabel: 'trk+USB 16',
    level: { index: 3, stage: 2, ladder: true, levels: [{ step: 'L1' }, { step: 'L1' }, { step: 'L2' }, { step: 'L3', learned: true }] },
    footerLeft: 'L3 Both hands  Solo',
  }),
  'ready, level box, the middle': (c) => V.drawReadyView(c, {
    chart, run: createRun(chart), songBeats: 0, pxPerBeat: 48, outLabel: 'trk+USB 16',
    level: { index: 1, stage: 1, ladder: true, levels: [{ step: 'L1' }, { step: 'L1' }, { step: 'L2' }, { step: 'L3' }] },
    footerRight: 'JOG level  REC start',
  }),
  'ready, a drill: one level, its name beside the hint': (c) => V.drawReadyView(c, {
    chart, run: createRun(chart), songBeats: 0, pxPerBeat: 48, outLabel: 'trk+USB 16',
    level: { index: 0, stage: 1, ladder: false, levels: [{ step: 'L1' }] }, footerLeft: 'Solo', footerRight: 'JOG Guided',
  }),
  'ready, scrubbed, the bottom line stays': (c) => V.drawReadyView(c, {
    chart, run: createRun(chart), songBeats: 6, pxPerBeat: 48,
    level: { index: 2, stage: 1, ladder: true, levels: [{ step: 'L1' }, { step: 'L1' }, { step: 'L2' }, { step: 'L3' }] },
    footerLeft: 'L2 RH chords  Guided',
  }),
  'ready, three-digit tempo, levels, names on': (c) => V.drawReadyView(c, {
    chart, run: createRun(chart), songBeats: 0, pxPerBeat: 48, outLabel: 'trk+USB 16', names: true, bpm: 200,
    level: { index: 3, stage: 2, ladder: true, levels: [{ step: 'L1' }, { step: 'L1' }, { step: 'L2' }, { step: 'L3', learned: true }] },
    footerLeft: 'L3 Both hands', footerRight: 'Solo',
  }),
  'ready, three-digit tempo, no levels': (c) => V.drawReadyView(c, {
    chart, run: createRun(chart), songBeats: 0, pxPerBeat: 48, outLabel: 'trk+USB 16', names: true, bpm: 120,
    footer: hintFor('ready', { stages: true, stage: 1 })[0],
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
    { label: 'Continue' }, { label: 'Learning Path' }, { label: 'Practice' }, { label: 'Quiz' },
  ], 0, {
    footer: hintFor('menu', { top: true })[0], centreFooter: true,
    decorate: (r) => (r.label === 'Continue'
      ? { label: 'Continue', value: 'Scarborough Fair L3 Both hands', short: '4.5' } : { value: '100% >', mark: 'half' }),
  }),
  'top list, a review due': (c) => V.drawList(c, 'EXERCISE', [{ label: 'Continue' }], 0, {
    footer: hintFor('menu', { top: true, shift: true })[0], centreFooter: true,
    decorate: () => ({ label: 'Review', value: 'Name chords advanced', short: '' }),
  }),
  'home, Path selected': (c) => homeScreen(c, 0),
  'ring, Practice on its longest name': (c) => homeScreen(c, 4, { title: 'PRACTICE', items: PRACTICE_RING, part: 1 }),
  'ring, Songs of four, mid-grow': (c) => homeScreen(c, 2, { title: 'SONGS', items: SONGS_RING, from: 1, now: 80 }),
  'ring, a trainer\'s five circles': (c) => homeScreen(c, 3, { title: 'PROGRESSIONS', items: TRAINER_RING }),
  'home, Settings selected, its longest hint part': (c) => homeScreen(c, 4, { part: 1 }),
  'home, mid-grow from Practice to Progress': (c) => homeScreen(c, 3, { from: 1, now: 80 }),
  'map, the world': (c) => mapScreen(c, 5, 'island', 1),
  'map, the world with reviews due': (c) => mapScreen(c, 5, 'island', 2, { due: 12 }),
  'map, an island of nine, walking': (c) => mapScreen(c, 9, 'place', 0, { to: 8, now: 300 }),
  'scene, a walk on an island of nine': (c) => sceneScreen(c, { kind: 'walk', from: 0, to: 8 }, 9, 300),
  'scene, a zoom into an island': (c) => sceneScreen(c, { kind: 'zoom', dir: 'in', at: 2, landAt: 0 }, 9, 100),
  'scene, the longest banner': (c) => sceneScreen(c, { kind: 'banner', at: 0, text: 'LEARNING PATH COMPLETE' }, 5, 600),
  'scene, fireworks over a stage': (c) => sceneScreen(c, { kind: 'celebrate', at: 8, big: true }, 9, 700),
  'card, welcome': (c) => card(c, welcomePages()[0], 0, 3, hintFor('card', { pages: 3 })[0]),
  'card, keys': (c) => card(c, welcomePages()[1], 1, 3, hintFor('card', { pages: 3 })[0]),
  'card, new to piano': (c) => card(c, welcomePages()[2], 2, 3, hintFor('card', { choice: true })[0]),
  'card, the longest tip': (c) => card(c, tipCard(PLACEMENT), 0, 1, hintFor('card', { pages: 1 })[0]),
  'star, a level learned at 100%': (c) => V.drawStarBand(V.drawExerciseResult(c, {
    name: 'Scarborough Fair L3 Both hands', percent: 100, hits: 120, total: 120, wrong: 0, stage: 2, passed: 2,
    isBest: false, history: [], timing: null, footer: hintFor('anim')[0],
  }), { kind: 'exercise', percent: 100 }, 300),
  'star, a round learned': (c) => V.drawStarBand(V.drawRoundResult(c, {
    rate: 144, ms: 480000, n: 30, wrong: 0, bestStreak: 30, hints: 0, best: 144, isBest: true, records: [],
    success: 100, passed: 2, footer: hintFor('anim')[0],
  }), { kind: 'quiz', success: 100 }, 300),
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
  /* A trainer's setup at its widest: every row the chord trainer can show,
   * with the longest value each can take, and the row being edited. */
  'trainer setup, the widest values, editing': (c) => V.drawList(c, 'CHORDS HEAR', [
    { label: 'Level', value: '6 + m7b5 6ths' },
    { label: 'Scale', value: 'Maj Pentatonic' },
    { label: 'Inversions', value: 'off' },
    { label: 'Roots', value: 'chromatic' },
  ], 0, { footer: hintFor('settings', { editing: true })[0], centreFooter: true, editing: true }),
  'trainer setup, on Start': (c) => V.drawList(c, 'CHORDS READ', [
    { label: 'Inversions', value: 'off' }, { label: 'Round', value: 'endless' },
    { label: 'Chords', value: '27 >' }, { label: 'Start', value: '>' },
  ], 3, { footer: hintFor('settings', { start: true })[0], centreFooter: true }),
  'trainer custom list': (c) => V.drawList(c, 'CHORDS CUSTOM', [
    { label: 'Minor-maj 7th', value: 'on' }, { label: 'Aug major 7th', value: 'off' },
    { label: 'Half-dim 7th', value: 'on' }, { label: 'Power chord', value: 'off' },
  ], 1, { footer: hintFor('settings', { tick: true })[0], centreFooter: true }),
  'trainer stats, three-digit cells and long names': (c) => V.drawTrainerStats(c, {
    title: 'PROGRESSIONS',
    rows: [
      { label: 'Minor-maj 7th', cells: [100, 100, 100] },
      { label: 'Aug major 7th', cells: [null, 7, 100] },
      { label: 'Half-dim 7th', cells: [0, null, null] },
      { label: 'Secondary dom', cells: [55, 100, 9] },
    ],
    cursor: 1, footer: hintFor('trainer-stats')[0],
  }),
  'trainer stats, nothing yet': (c) => V.drawTrainerStats(c, {
    title: 'CHORDS', rows: [], cursor: 0, footer: hintFor('trainer-stats', { empty: true })[0],
  }),
  /* The knob screen: three, five and eight knobs in use, the focus at
   * either end, the longest level, and a Custom pick too small to start. */
  'knobs, Notes Play: three': (c) => knobScreen(c, 'note', 'play', {}, 2),
  'knobs, Scales Read: five, focus last': (c) => knobScreen(c, 'scale', 'read', { answer: 'name' }, 5),
  'knobs, Chords Hear: eight, focus first': (c) => knobScreen(c, 'chord', 'hear', { answer: 'name' }, 1),
  'knobs, Chords Hear: eight, focus last': (c) => knobScreen(c, 'chord', 'hear', { round: 0 }, 8),
  'knobs, Chords Read: the top level': (c) => knobScreen(c, 'chord', 'read', { level: 10 }, 2),
  'knobs, Progressions Read: blocked': (c) =>
    knobScreen(c, 'prog', 'read', { answer: 'name', level: 'custom', custom: [] }, 2),
  'pick, eight chord answers on the map': (c) => V.drawPick(c, {
    title: 'CHORDS HEAR', score: '19/20', index: 7,
    options: ['Major', 'Minor', 'Diminished', 'Augmented', 'Dominant 7th', 'Major 7th', 'Minor 7th', 'Minor-maj 7th'],
    short: ['M', 'm', '°', '+', '7', 'M7', 'm7', 'mM'],
    colours: ['blue', 'orange', 'cyan', 'pink', 'green', 'yellow', 'purple', 'red'],
    hint: 'which chord?', footer: hintFor('guess', { ear: true, hintsLeft: true })[0],
  }),
  /* The read strip: eight answers, two far apart, a struck one, and right
   * with the longest label in the title. */
  'read pick, a chord on the staff, eight answers': (c) => V.drawReadPick(c, {
    title: 'CHORDS READ', score: '19/20', staff: CHORD_STAFF, index: 7,
    options: ['Major', 'Minor', 'Diminished', 'Augmented', 'Dominant 7th', 'Major 7th', 'Minor 7th', 'Minor-maj 7th'],
    short: ['M', 'm', '°', '+', '7', 'M7', 'm7', 'mM'], eliminated: [2],
    footer: hintFor('guess', { ear: true, hintsLeft: true })[0],
  }),
  'read pick, two answers': (c) => V.drawReadPick(c, {
    title: 'INTERVALS READ', score: '0/10', staff: CHORD_STAFF, index: 1,
    options: ['First bigger', 'Second bigger'], short: ['1', '2'],
    footer: hintFor('guess', { ear: true, hintsLeft: true })[0],
  }),
  'read pick, right, a long label': (c) => V.drawReadPick(c, {
    title: 'PROGS READ', score: '100/100', staff: CHORD_STAFF, index: 3, solved: true,
    label: 'iii-vi-ii-V-I in F# minor', options: ['I-V-vi-IV', 'ii-V-I', 'vi-IV-I-V', 'iii-vi-ii-V-I'],
    short: ['Ax', 'ii', 'vi', 'iii'], footer: hintFor('guess', {})[0],
  }),
  /* A scale both ways, fifteen notes, the longest name a scale has. */
  'line, half played': (c) => V.drawLineView(c, {
    title: 'SCALES PLAY', score: '19/20', staff: LINE, shown: 7, label: 'C# Lydian augmented',
    footer: hintFor('guess', { hintsLeft: true, streak: 999 })[0],
  }),
  'line, solved': (c) => V.drawLineView(c, {
    title: 'SCALES HEAR', score: '20/20', staff: LINE, shown: LINE.length, label: 'C# Lydian augmented',
    solved: true, footer: hintFor('guess', { streak: 999 })[0],
  }),
  'line, heard, nothing yet': (c) => V.drawLineView(c, {
    title: 'SCALES HEAR', score: '0/20', staff: LINE, shown: 0, label: '?', footer: hintFor('guess', {})[0],
  }),
  /* The longest row of numerals the ladder has, half played. */
  'chord row, the twelve-bar blues': (c) => V.drawChordRow(c, {
    title: 'PROGS PLAY', score: '19/20', done: 5,
    tokens: ['i7', 'i7', 'i7', 'i7', 'iv7', 'iv7', 'i7', 'i7', 'VI7', 'V7', 'i7', 'V7'],
    keyText: 'in F# minor', footer: hintFor('guess', { hintsLeft: true, streak: 999 })[0],
  }),
  'chord row, jazz, solved': (c) => V.drawChordRow(c, {
    title: 'PROGS HEAR', score: '20/20', solved: true,
    tokens: ['iii7', 'vi7', 'ii7', 'V7', 'Imaj7'], label: 'iii-vi-ii-V-I in F# minor',
    footer: hintFor('guess', {})[0],
  }),
  'chord row, heard': (c) => V.drawChordRow(c, {
    title: 'PROGS HEAR', score: '0/20', tokens: ['?', '?', '?', '?'], keyText: '?',
    footer: hintFor('guess', {})[0],
  }),
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

test('a Stats row keeps its whole label: thirteen characters beside the meters', () => {
  const c = createScreen();
  const { lefts, labelEnd } = V.statsColumns();
  assert.ok(c.textWidth('Minor-maj 7th') <= labelEnd - 2, `label room ${labelEnd - 2}px`);
  /* Each meter sits under its letter, the last a pixel from the edge. */
  assert.equal(lefts[2] + 5, L.SCREEN_W - 2);
  for (let i = 1; i < lefts.length; i++) assert.ok(lefts[i] - lefts[i - 1] >= 5 + 4);
});

test('the name-lane rule is drawn only by the views that have a name lane', () => {
  const laned = ['reading', 'guess', 'ready', 'line', 'chord row'];
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
    { streak: 999 }, { editing: true }, { action: true }, { start: true }, { tick: true }, { empty: true }, { blocked: true },
    { open: true }];
  for (const screen of ['menu', 'ready', 'running', 'settings', 'guess', 'summary', 'progress',
    'progress-detail', 'info', 'sheet', 'card', 'map', 'home', 'anim', 'trainer-stats']) {
    for (const st of states) footers.push(...hintFor(screen, st), ...hintFor(screen, { ...st, shift: true }));
  }
  /* The knob screen, ready, on Custom, and with each trainer's reason not
   * to start. */
  const knobStates = [{}, { custom: true }];
  for (const s of Object.keys(TRAIN.SUBJECTS)) {
    const noun = TRAIN.subjectOf(s).noun;
    knobStates.push({ blocked: 'tick 1 ' + noun[0], custom: true }, { blocked: 'tick 2 ' + noun[1], custom: true });
  }
  for (const st of knobStates) {
    footers.push(...hintFor('trainer-setup', st), ...hintFor('trainer-setup', { ...st, shift: true }));
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

test('the map\'s title keeps its percent, and its reviews only when they fit', () => {
  const c = createScreen();
  const w = (s) => c.textWidth(s);
  const place = makePlace({ label: '3.3 Harmony by ear', percent: 100, due: 3, kind: 'place' });
  const t = mapTitle(place, L.SCREEN_W - 2, w);
  assert.match(t.title, / 100%$/);
  assert.equal(t.right, '', 'no room for 3 due beside it');
  assert.deepEqual(mapTitle(makePlace({ label: '1 Colour', percent: 5, due: 2, kind: 'island' }), L.SCREEN_W - 2, w),
    { title: '1 Colour 5%', right: '2 due' });
  assert.ok(w(mapTitle(makePlace({ label: '5.8 Advanced pieces and more', percent: 100 }), L.SCREEN_W - 2, w).title) <= L.SCREEN_W - 2);
  assert.deepEqual(mapTitle(null, 100, w), { title: '', right: '' });
});

test('a level learned: the score centred in the band, LEVEL LEARNED under it, the star\'s room above it', () => {
  const c = createScreen();
  for (const result of [{ kind: 'exercise', percent: 100 }, { kind: 'exercise', percent: 92 }, { kind: 'quiz', success: 95 }]) {
    const s = V.starLayout(result, (x) => c.textWidth(x));
    assert.equal(s.caption, 'LEVEL LEARNED');
    assert.ok(Math.abs(s.x + s.w / 2 - L.SCREEN_W / 2) <= 1, 'centred across');
    assert.ok(Math.abs((s.y - s.top) - (s.bottom - (s.y + s.h - 1))) <= 1, 'centred in its room');
    assert.ok(s.top >= 10 && s.captionY + L.TEXT_H - 1 <= 53, 'inside the band');
    assert.ok(s.y + s.h < s.captionY && s.bottom < s.captionY, 'the caption under the score and the star');
  }
  assert.equal(V.starLayout({ kind: 'exercise', percent: 100 }, (x) => x.length * 12).caption, 'LEARNED', 'too wide: the short word');
});

test('the star stays in its room: clear of the digits and the caption, inside the band', async () => {
  const { isOn } = await import('../tools/screen_buffer.mjs');
  for (const result of [{ kind: 'exercise', percent: 100 }, { kind: 'exercise', percent: 90 }, { kind: 'quiz', success: 95 }]) {
    const still = createScreen();
    still.clear();
    V.drawStarBand(still, result, 0);              /* no rays yet: the score and the caption */
    const s = V.starLayout(result, (x) => still.textWidth(x));
    let rays = 0;
    for (let t = 0; t <= 600; t += 20) {
      const c = createScreen();
      c.clear();
      V.drawStarBand(c, result, t);
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 128; x++) {
          if (!isOn(c, x, y) || isOn(still, x, y)) continue;
          rays++;
          const where = `${result.kind} ${s.text} at t ${t}: (${x}, ${y})`;
          assert.ok(y >= s.top && y <= s.bottom, 'inside its room: ' + where);
          assert.ok(!(x >= s.x - 1 && x <= s.x + s.w && y >= s.y - 1 && y <= s.y + s.h), 'clear of the digits: ' + where);
        }
      }
    }
    assert.ok(rays > 0, 'a star is drawn');
  }
});

/* Every circle of every trainer: the knob screen's values sit under their
 * knobs, inside the screen, and its two detail lines fit, whichever knob is in
 * focus and whatever its value. */
test('the knob screen fits for every knob of every circle at every value', () => {
  for (const subject of Object.keys(TRAIN.SUBJECTS)) {
    for (const circle of TRAIN.CIRCLES) {
      const setup = TRAIN.coerceSetup(subject, circle, { answer: 'name' });
      const knobs = TRAIN.knobsOf(subject, circle, setup);
      for (const k of knobs.filter((x) => x.field)) {
        for (const v of TRAIN.knobValues(subject, circle, setup, k.field)) {
          const c = probe();
          const s = TRAIN.coerceSetup(subject, circle, { ...setup, [k.field]: v.value });
          V.drawKnobSetup(c, {
            title: subject.toUpperCase(), knobs: TRAIN.knobsOf(subject, circle, s), focus: k.n,
            blocked: TRAIN.startBlock(subject, circle, s), footer: 'KNOB set  PLAY start',
          });
          const bad = collisions(c);
          assert.deepEqual(bad, [], `${subject} ${circle} knob ${k.n} = ${v.short}\n  ` + bad.join('\n  '));
          const { texts } = c.transcript();
          /* A value is narrower than the 16 px between two knobs. */
          for (const tx of texts.filter((x) => x.y === V.KNOB_VALUE_Y)) {
            assert.ok(tx.w <= 14, `${subject} ${circle}: value ${tx.s} is ${tx.w}px, wider than its knob`);
          }
        }
      }
    }
  }
});
