// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * preview.mjs — render the module's screens as ASCII art, with no Move attached.
 *
 * This is how the 1-bit staff geometry gets iterated: change layout.mjs or the
 * clef bitmap, run this, look at it. Rendering is a pure function of
 * (chart, run, songBeats), so any instant of any exercise can be dumped.
 *
 *   npm run preview                     a few frames of the C major scale
 *   npm run preview -- --beats 2.5      one frame at that point
 *   npm run preview -- --view clef      just the clef on the staff
  *   npm run preview -- --exercise triads --film 0,1,2,3
 *   npm run preview -- --view levels --song rising-sun          a song's ladder
 *   npm run preview -- --song rising-sun --level 3 --film 3,6   read it
 *   npm run preview -- --view menu --path 1,0                   a folder of the list (Path › 1)
 *   npm run preview -- --view menu --shift                      its footer while Shift is held
 *   npm run preview -- --view sheet --path 1,0                  the options of a row
 *   npm run preview -- --view welcome                           the welcome, every page
 *   npm run preview -- --view card --tip sheet                  a first-visit tip
 *   npm run preview -- --view help --path 1,0 --scroll 4        MENU's help on a row
 *   npm run preview -- --view path                              the Path's world map, as the
 *                                    session draws it; --stage 3: that stage's island
 *   npm run preview -- --path 0,1,4,0,3 --film 0,2              read the lesson there
 *   npm run preview -- --view map --places 5|7|8                the Path map: piano's
 *                                    world (5), drums' world (7), a piano island (8)
 *   npm run preview -- --view home --selected 2 --t 60          the home screen, mid-grow
 *   npm run preview -- --view map --map drums                   a drums island (7)
 *   npm run preview -- --view map --map done                    fill levels, avatar on a flag
 *   npm run preview -- --view map --places 7 --to 6 --film 0,90,400   walk there
 *
 * The list, the sheet and the cards come from a session, as on the Move, with
 * the hint line's first part as their footer.
 */
import { createScreen, toAscii } from './screen_buffer.mjs';
import * as R from '../src/staff_render.mjs';
import * as V from '../src/view.mjs';
import { scaleRun, triadDrill, intervalDrill, randomInKey } from '../src/generator.mjs';
import { createRun, judgeNoteOn, expireMissed } from '../src/scoring.mjs';
import { createQuiz, entryName, NOTES, CHORDS } from '../src/guess.mjs';
import { PX_PER_BEAT_DEFAULT } from '../src/layout.mjs';
import { parseExercise, parseManifest, parseCategories } from '../src/exercise_io.mjs';
import { availableLevels, projectLevel } from '../src/levels.mjs';
import { buildCatalog, navTop, nodeAt, isFolder } from '../src/catalog.mjs';
import { createSession } from '../src/session.mjs';
import { tipCard, TIP_KEYS, PLACEMENT } from '../src/tips.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { layoutPlaces } from '../src/pathmap/layout.mjs';
import { createWalk, walkTo, posAt } from '../src/pathmap/walk.mjs';
import { makePlace } from '../src/pathmap/model.mjs';
import { drawMap } from '../src/pathmap/render.mjs';
import { drawHome, createGrow, startGrow, GROW_MS } from '../src/home/render.mjs';
import { PRACTICE_PIANO, PRACTICE_DRUMS } from '../src/home/icons.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const EXERCISES = {
  scale: () => scaleRun({ rootPc: 0, direction: 'updown', bpm: 80 }),
  thirds: () => intervalDrill({ rootPc: 0, steps: 2, count: 8, seed: 3 }),
  triads: () => triadDrill({ rootPc: 0, degrees: [0, 3, 4, 0] }),
  reading: () => randomInKey({ rootPc: 0, bars: 4, seed: 11 }),
};

/* A bundled song, at one rung of its ladder — the only way to look at a real
 * two-handed chart without a Move. */
const songId = arg('song', null);
const song = songId
  ? parseExercise(readFileSync(new URL(`../src/exercises/${songId}.json`, import.meta.url), 'utf8'), songId).chart
  : null;

/* The list as the Move builds it, from the bundled files. --path is the
 * cursor at each depth: 0,1 is Basics › Chords. */
function bundledCatalog() {
  const dir = new URL('../src/exercises/', import.meta.url);
  const text = readFileSync(new URL('index.json', dir), 'utf8');
  const songs = parseManifest(text).map((row) => ({
    chart: parseExercise(readFileSync(new URL(row.file, dir), 'utf8'), row.id).chart,
    category: row.category,
  }));
  return buildCatalog({ songs, categories: parseCategories(text), tail: [{ label: 'Quiz', value: '>' }, { label: 'Progress', value: '~' }] });
}

/* A session on the bundled files, in memory: what the Move's list shows.
 * `progress` is the stored file: by default a learner already welcomed. */
function bundledSession(progress = { tips: TIP_KEYS.concat([PLACEMENT]) }) {
  const src = new URL('../src/', import.meta.url).pathname;
  const files = new Map([['settings.json', JSON.stringify({ version: 8, autoInfo: false })]]);
  if (progress) files.set('progress.json', JSON.stringify(progress));
  const S = createSession({
    now: () => 0, wallNow: () => Date.UTC(2026, 9, 22), strike() {}, release() {}, silence() {},
    announce() {}, exit() {}, settingChanged() {}, reveal() {},
    readText: (name) => files.get(name) || (name.startsWith('exercises/') && existsSync(src + name)
      ? readFileSync(src + name, 'utf8') : null),
    writeText: (name, text) => { files.set(name, text); return true; },
  });
  S.init();
  return S;
}

/* Walk the session's list: the cursor at each depth, the last one the
 * highlight in the folder shown. */
function walk(S, at) {
  for (let i = 0; i < at.length; i++) {
    S.selectRow(at[i]);
    if (i < at.length - 1) S.activate(false);
  }
}

const footerOf = (S) => S.hint({ shift: process.argv.includes('--shift') })[0] || '';
const path = arg('path', null) ? arg('path', '').split(',').map(Number) : null;
const LISTS = ['menu', 'sheet', 'welcome', 'card', 'help', 'path'];
const leaf = path && !LISTS.includes(arg('view', 'reading')) ? nodeAt(bundledCatalog(), path) : null;
if (leaf && isFolder(leaf)) throw new Error('--path ends on a folder; add the row to open, or use --view menu');

const chart = leaf
  ? leaf.build()
  : song
    ? (projectLevel(song, arg('level', '3')) || song)
    : (EXERCISES[arg('exercise', 'scale')] || EXERCISES.scale)();
const px = Number(arg('px', PX_PER_BEAT_DEFAULT));
const view = arg('view', 'reading');

function show(title, ctx) {
  console.log('\n== ' + title + ' ' + '='.repeat(Math.max(0, 60 - title.length)));
  console.log(toAscii(ctx));
}

/* A run with some history, so hit and missed glyphs show up in the frames. */
function playedRun(upTo) {
  const run = createRun(chart);
  for (const e of chart.events) {
    if (e.beat >= upTo) break;
    /* Play every other event, miss the rest. */
    if (Math.round(e.beat) % 2 === 0) {
      for (const p of e.pitches) judgeNoteOn(run, p, e.beat);
    }
  }
  expireMissed(run, upTo);
  return run;
}

/*
 * Sample maps for --view map: every state and kind shows up somewhere, so one
 * look checks them all. [label, percent, state, due, kind]
 */
const SAMPLE_MAPS = {
  5: [
    ['Stage 1', 100, 'skipped', 0, 'island'], ['Stage 2', 100, 'done', 2, 'island'],
    ['Stage 3', 40, 'current', 0, 'island'], ['Stage 4', 0, 'fresh', 0, 'island'],
    ['Stage 5', 0, 'ahead', 0, 'island'],
  ],
  7: [
    ['Stage 1', 100, 'done', 0, 'island'], ['Stage 2', 100, 'done', 1, 'island'],
    ['Stage 3', 64, 'current', 0, 'island'], ['Stage 4', 20, 'started', 0, 'island'],
    ['Stage 5', 0, 'skipped', 0, 'island'], ['Stage 6', 0, 'ahead', 0, 'island'],
    ['Stage 7', 0, 'ahead', 0, 'island'],
  ],
  8: [
    ['2.1 Intervals I', 100, 'done', 1, 'place'], ['2.2 I-IV-V', 100, 'done', 0, 'place'],
    ['2.3 Left hand', 60, 'started', 0, 'place'], ['2.4 Four chords', 40, 'current', 0, 'place'],
    ['2.5 Minor', 0, 'skipped', 0, 'place'], ['2.6 Both hands', 0, 'ahead', 0, 'place'],
    ['2.7 First tracks', 0, 'ahead', 0, 'place'], ['Checkpoint', 0, 'fresh', 0, 'fort'],
  ],
  /* Fill levels 0..100 side by side, the avatar on a done place under its
   * flag: nothing it carries may hide how far a place has got. */
  done: [
    ['3.1 Intervals II', 100, 'done', 1, 'place'], ['3.2 Inversions', 0, 'fresh', 0, 'place'],
    ['3.3 Harmony by ear', 20, 'started', 0, 'place'], ['3.4 Sus and power', 40, 'started', 0, 'place'],
    ['3.5 Modes I', 60, 'current', 0, 'place'], ['3.6 Progressions', 100, 'done', 0, 'place'],
    ['3.7 Faster reading', 100, 'done', 0, 'cove'], ['Checkpoint', 20, 'started', 0, 'fort'],
  ],
  drums: [
    ['Lessons', 100, 'done', 0, 'hut'], ['Ear', 100, 'done', 2, 'place'],
    ['Time', 50, 'current', 0, 'place'], ['Hands', 20, 'started', 0, 'place'],
    ['Grooves', 0, 'fresh', 0, 'place'], ['Electives', 0, 'ahead', 0, 'cove'],
    ['Checkpoint', 0, 'fresh', 0, 'fort'],
  ],
};

/* The map in the module's chrome: the place under the avatar on top, the
 * hint underneath. */
function drawMapScreen(c, places, layout, walk, now) {
  c.clear();
  const pos = posAt(walk, now);
  const p = places[pos.at];
  const due = places.reduce((n, q) => n + q.due, 0);
  R.drawChrome(c, { left: `${p.label}  ${p.percent}%`, right: due ? `${due} due` : '' });
  drawMap(c, { places, layout, walk, now });
  V.drawFooterHint(c, 'PAD go  CLICK enter');
}

/*
 * The home screen. --selected N is the circle chosen; --t ms is the moment of
 * a grow that started when the jog came from the circle before it (from the
 * one after, for the first). --film t,t,... films that grow. --practice drums
 * shows Drums Practice's practice icon.
 */
const HOME_ITEMS = [
  { key: 'path', label: 'Path', icon: 'path' },
  { key: 'practice', label: 'Practice', icon: arg('practice', 'piano') === 'drums' ? PRACTICE_DRUMS : PRACTICE_PIANO },
  { key: 'quiz', label: 'Quiz', icon: 'quiz' },
  { key: 'progress', label: 'Progress', icon: 'progress' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];

if (view === 'home') {
  const sel = Number(arg('selected', 0));
  const t = arg('t', null);
  const film = arg('film', null);
  const times = film ? film.split(',').map(Number) : t === null ? [null] : [Number(t)];
  for (const now of times) {
    const grow = createGrow(sel);
    if (now !== null) {
      grow.to = sel === 0 ? 1 : sel - 1;
      startGrow(grow, sel, 0);
    }
    const c = createScreen();
    c.clear();
    R.drawChrome(c, { left: 'PIANO' });
    drawHome(c, { items: HOME_ITEMS, selected: sel, grow, now: now ?? GROW_MS });
    V.drawFooterHint(c, 'JOG choose CLICK open');
    show(`home, ${HOME_ITEMS[sel].label}${now === null ? '' : ` growing @ ${now}ms`} (${c.calls} draw calls)`, c);
  }
} else if (view === 'map') {
  const which = arg('map', arg('places', '5'));
  const rows = SAMPLE_MAPS[which];
  if (!rows) throw new Error('--view map takes --places 5|7|8 or --map drums|done');
  const places = rows.map(([label, percent, state, due, kind]) => makePlace({ label, percent, state, due, kind }));
  const layout = layoutPlaces(places.length);
  /* The avatar starts where Continue would go; on 'done', on the first flag. */
  const from = which === 'done' ? 0 : places.findIndex((p) => p.state === 'current');
  const walk = createWalk(layout, Number(arg('at', from)));
  const to = arg('to', null);
  const film = to === null ? [0] : arg('film', '0,90,180,270,2000').split(',').map(Number);
  if (to !== null) walkTo(walk, Number(to), 0);
  for (const t of film) {
    const c = createScreen();
    drawMapScreen(c, places, layout, walk, t);
    show(`map ${which}${to === null ? '' : ` walking to ${to} @ ${t}ms`} (${c.calls} draw calls)`, c);
  }
} else if (view === 'clef') {
  const c = createScreen();
  c.clear();
  R.drawStaff(c);
  R.drawClef(c);
  R.drawHitLine(c, true);
  show('clef on the staff', c);
} else if (view === 'guess' || view === 'guess-chords') {
  const kind = view === 'guess-chords' ? CHORDS : NOTES;
  const quiz = createQuiz({ kind, seed: Number(arg('seed', 4)) });
  const c = createScreen();
  V.drawGuessView(c, {
    prompt: quiz.prompt, fifths: 0, score: '7/9',
    title: kind === CHORDS ? 'CHORD' : 'NOTE',
    footer: 'streak 5   PLAY hear',
  });
  show(`guess ${kind}: ${quiz.prompt.join(' ')}`, c);
} else if (view.startsWith('row-')) {
  /* row-notes-name, row-chords-staff, ... with --glide 0..1 and --solved */
  const [, what, read] = view.split('-');
  const kind = what === 'chords' ? CHORDS : NOTES;
  const quiz = createQuiz({ kind, read, halfTones: true, chordSet: arg('set', 'triads'),
    seed: Number(arg('seed', 4)) });
  const c = createScreen();
  V.drawQuizRow(c, {
    queue: quiz.queue.map((e) => ({ pitches: e.pitches, name: entryName(quiz, e) })),
    read, glide: Number(arg('glide', 0)), solved: process.argv.includes('--solved'), hint: Number(arg('hint', 0)),
    fifths: 0, score: '7/20',
    title: (kind === CHORDS ? 'CHORD' : 'NOTE') + (read === 'staff' ? ' STAFF' : ''),
    footer: 'streak 5   REC help',
  });
  show(`row ${kind} by ${read}: ${quiz.queue.map((e) => entryName(quiz, e)).join(' ')}`, c);
} else if (view === 'menu') {
  const S = bundledSession();
  walk(S, path || [0]);
  const top = navTop(S.nav);
  const c = createScreen();
  V.drawList(c, S.listTitle().toUpperCase(), top.node.children, top.cursor, {
    footer: footerOf(S), centreFooter: true, decorate: S.decorateRow,
  });
  show(top.node.label, c);
} else if (view === 'sheet') {
  const S = bundledSession();
  walk(S, path || [1, 0]);
  S.openSheet();
  const c = createScreen();
  V.drawList(c, S.sheet.title.toUpperCase(), S.sheet.items, S.sheet.cursor, { footer: footerOf(S), centreFooter: true });
  show('options: ' + S.sheet.title, c);
} else if (view === 'path') {
  const S = bundledSession();
  walk(S, [1]);
  S.activate(false);
  const stage = Number(arg('stage', 0));
  if (stage) {
    /* Walk there unless the avatar stands there already, then go in. */
    if (S.mapModel().at !== stage - 1) S.mapPick(stage - 1);
    S.mapPick(stage - 1);
  }
  const m = S.mapModel();
  const c = createScreen();
  V.drawMapScreen(c, { place: m.place, places: m.places, layout: m.layout, walk: m.walk, now: 10000,
    footer: S.hint()[0] || '' });
  show(stage ? 'island ' + stage : 'the world', c);
} else if (view === 'help') {
  const S = bundledSession();
  walk(S, path || [0]);
  S.menuButton();
  const c = createScreen();
  const lines = V.infoLines(c, S.info.paragraphs);
  V.drawInfo(c, {
    title: S.info.title, lines, scroll: Number(arg('scroll', 0)),
    footer: S.hint({ scrolls: lines.length > 5 })[0] || '',
  });
  show('help: ' + S.info.title, c);
} else if (view === 'welcome' || view === 'card') {
  const S = bundledSession(view === 'welcome' ? null : undefined);
  const pages = view === 'welcome' ? S.card.pages : [tipCard(arg('tip', 'sheet'))];
  pages.forEach((page, i) => {
    const c = createScreen();
    V.drawCard(c, {
      title: page.title, lines: V.cardLines(c, page), choices: page.choices || null, choice: 0,
      scroll: Number(arg('scroll', 0)),
      page: i, pages: pages.length,
      footer: view === 'welcome' ? (S.hint({ shift: process.argv.includes('--shift') })[0] || '') : 'CLICK go on',
    });
    if (view === 'welcome') S.moveSelection(1);
    show(page.title, c);
  });
} else if (view === 'levels') {
  if (!song) throw new Error('--view levels needs --song <id>');
  const c = createScreen();
  V.drawList(c, song.name.toUpperCase(),
    availableLevels(song).map((lv) => ({ label: lv.label, value: lv.step })), 0, {
      footer: 'CLICK open  BACK up',
      centreFooter: true,
    });
  show(`${song.name} ladder`, c);
} else if (view === 'ready') {
  const c = createScreen();
  V.drawReadyView(c, {
    chart, run: createRun(chart), songBeats: 0, pxPerBeat: px,
    message: 'PLAY button', subMessage: 'to start',
  });
  show('ready', c);
} else {
  const film = arg('film', null);
  const beats = film ? film.split(',').map(Number) : [Number(arg('beats', 2.5))];
  for (const b of beats) {
    const c = createScreen();
    V.drawReadingView(c, { chart, run: playedRun(b), songBeats: b, pxPerBeat: px, beatFlash: b % 1 < 0.2 });
    show(`${chart.name} @ beat ${b}`, c);
  }
}
