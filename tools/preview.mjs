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
 *   npm run preview -- --view menu --path 0,1                   a folder of the list
 *   npm run preview -- --path 0,1,4,0,3 --film 0,2              read the lesson there
 */
import { createScreen, toAscii } from './screen_buffer.mjs';
import * as R from '../src/staff_render.mjs';
import * as V from '../src/view.mjs';
import { scaleRun, triadDrill, intervalDrill, randomInKey } from '../src/generator.mjs';
import { createRun, judgeNoteOn, expireMissed } from '../src/scoring.mjs';
import { createQuiz, NOTES, CHORDS } from '../src/guess.mjs';
import { PX_PER_BEAT_DEFAULT } from '../src/layout.mjs';
import { parseExercise, parseManifest, parseCategories } from '../src/exercise_io.mjs';
import { availableLevels, projectLevel } from '../src/levels.mjs';
import { buildCatalog, navRestore, navTop, nodeAt, isFolder } from '../src/catalog.mjs';
import { readFileSync } from 'node:fs';

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
const path = arg('path', null) ? arg('path', '').split(',').map(Number) : null;
const leaf = path && arg('view', 'reading') !== 'menu' ? nodeAt(bundledCatalog(), path) : null;
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

if (view === 'clef') {
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
} else if (view === 'menu') {
  /* The cursor at each depth; the last one is the highlight in the folder shown. */
  const nav = navRestore(bundledCatalog(), path || [0]);
  const top = navTop(nav);
  const c = createScreen();
  V.drawList(c, top.node.label.toUpperCase(), top.node.children, top.cursor, {
    footer: nav.length > 1 ? V.FOLDER_HINT : V.SETTINGS_HINT,
    centreFooter: true,
  });
  show(top.node.label, c);
} else if (view === 'levels') {
  if (!song) throw new Error('--view levels needs --song <id>');
  const c = createScreen();
  V.drawList(c, song.name.toUpperCase(),
    availableLevels(song).map((lv) => ({ label: lv.label, value: lv.step })), 0, {
      footer: V.FOLDER_HINT,
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
