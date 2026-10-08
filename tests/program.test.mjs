import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildProgram, trackSteps, stepTitle, nextStep, trackActivity, continueStep, trackOf, findStep,
  quizFromId, programFolder, SONG_ORDER,
} from '../src/program.mjs';
import { buildCatalog, leafIndex, findById, isFolder } from '../src/catalog.mjs';
import { parseManifest, parseCategories, parseExercise, validateExercise } from '../src/exercise_io.mjs';
import { emptyProgress, recordAttempt, skipItem, moveOn } from '../src/progress.mjs';
import { drillId } from '../src/stats.mjs';

const T0 = Date.UTC(2026, 9, 1, 12);
const play = (p, id, stage, score, at = T0) => recordAttempt(p, id, { stage, score, at });

function bundled() {
  const dir = new URL('../src/exercises/', import.meta.url);
  const text = readFileSync(new URL('index.json', dir), 'utf8');
  const songs = parseManifest(text).map((row) => ({
    chart: parseExercise(readFileSync(new URL(row.file, dir), 'utf8'), row.id).chart,
    category: row.category,
  }));
  return { songs, categories: parseCategories(text) };
}

const { songs, categories } = bundled();
const tracks = buildProgram({ songs });
const root = buildCatalog({ songs, categories, lead: [programFolder(tracks)] });
const index = leafIndex(root);

test('four tracks, each with something in it', () => {
  assert.deepEqual(tracks.map((t) => t.key), ['reading', 'chords', 'songs', 'ear']);
  for (const t of tracks) assert.ok(trackSteps(t).length > 5, t.key);
});

/*
 * The program is pointers into the tree. A step that points at nothing would
 * be a Continue that does nothing, and the only way to find one is to resolve
 * them all — which this does against the tree exactly as the Move builds it.
 */
test('every step of the program opens a real exercise', () => {
  for (const t of tracks) {
    for (const step of trackSteps(t)) {
      if (step.quiz) continue;
      const hit = index.get(step.id);
      assert.ok(hit && hit.node.build, `${t.key}: ${step.id} resolves to nothing`);
    }
  }
});

test('every step is also found the cheap way, without opening every folder', () => {
  for (const t of tracks.slice(0, 2)) {
    for (const step of trackSteps(t)) {
      const hit = findById(root, step.id);
      assert.ok(hit && hit.node.build, step.id);
    }
  }
  assert.equal(findById(root, 'nothing/here'), null);
  assert.equal(findById(root, ''), null);
});

test('the steps of the first units build valid charts', () => {
  for (const t of tracks.slice(0, 3)) {
    for (const step of t.units[0].steps) {
      const { ok, errors } = validateExercise(index.get(step.id).node.build());
      assert.ok(ok, step.id + ': ' + errors.join('; '));
    }
  }
});

test('quiz steps carry their options, and the id says the same thing', () => {
  const ear = tracks[3];
  for (const step of trackSteps(ear)) {
    assert.ok(step.quiz, step.id);
    assert.equal(step.id, 'quiz:' + drillId(step.quiz));
    const back = quizFromId(step.id);
    assert.equal(drillId(back), drillId(step.quiz), step.id);
  }
  assert.equal(quizFromId('quiz:nonsense'), null);
  assert.equal(quizFromId('quiz:guess:planets:x'), null);
});

test('the songs track follows the manifest, easy categories first, every rung', () => {
  const units = tracks[2].units;
  assert.equal(units.length, songs.filter((s) => SONG_ORDER.includes(s.category)).length);
  assert.equal(units[0].name, songs[0].chart.name);
  assert.deepEqual(units[0].steps.map((s) => s.id.split('/')[1]), ['1r', '1l', '2r', '3']);
  assert.match(stepTitle(units[0].steps[0]), / L1 RH$/, 'a step names its song outside its folder');
  const firstStyles = units.findIndex((u) => songs.find((s) => s.chart.name === u.name).category === 'styles');
  const firstTechno = units.findIndex((u) => songs.find((s) => s.chart.name === u.name).category === 'techno');
  assert.ok(firstStyles < firstTechno);
});

test('a one-rung song is one step', () => {
  const t = buildProgram({
    songs: [{ category: 'classics', chart: { id: 'one', name: 'One', events: [{ beat: 0, durBeats: 1, hand: 'r', pitches: [60] }] } }],
  });
  assert.deepEqual(trackSteps(t[2]), [{ id: 'song:one', label: 'One' }]);
});

/* ---- Following it --------------------------------------------------------- */

test('the next step is the first neither finished nor skipped', () => {
  const p = emptyProgress();
  const reading = tracks[0];
  const steps = trackSteps(reading);
  assert.equal(nextStep(p, reading), steps[0]);
  play(p, steps[0].id, 1, 0.95);
  assert.equal(nextStep(p, reading), steps[0], 'stage 1 alone is not finished — stage 2 is next');
  moveOn(p, steps[0].id, T0);
  assert.equal(nextStep(p, reading), steps[1], 'unless you chose to move on');
  skipItem(p, steps[1].id, T0);
  assert.equal(nextStep(p, reading), steps[2]);
  play(p, steps[3].id, 2, 1);
  play(p, steps[2].id, 2, 1);
  assert.equal(nextStep(p, reading), steps[4], 'a step done out of order is done');
});

test('a finished track has no next step', () => {
  const p = emptyProgress();
  const ear = tracks[3];
  for (const step of trackSteps(ear)) play(p, step.id, 2, 1);
  assert.equal(nextStep(p, ear), null);
});

test('Continue starts with Reading, then rotates to the track left longest', () => {
  const p = emptyProgress();
  assert.equal(continueStep(p, tracks).track.key, 'reading');
  play(p, trackSteps(tracks[0])[0].id, 1, 0.5, T0);
  assert.equal(continueStep(p, tracks).track.key, 'chords', 'untouched tracks come first');
  play(p, trackSteps(tracks[1])[0].id, 1, 0.5, T0 + 1000);
  /* Its left hand: the right hand is in Reading too, and playing it there
   * would count as practising Reading — which is the point of sharing ids. */
  play(p, trackSteps(tracks[2])[1].id, 1, 0.5, T0 + 2000);
  play(p, trackSteps(tracks[3])[0].id, 1, 0.5, T0 + 3000);
  assert.equal(continueStep(p, tracks).track.key, 'reading', 'the one played longest ago');
  assert.equal(trackActivity(p, tracks[3]), Math.round((T0 + 3000) / 1000));
});

test('Continue skips a finished track, and is null when everything is done', () => {
  const p = emptyProgress();
  for (const step of trackSteps(tracks[0])) play(p, step.id, 2, 1, T0 - 1000);
  assert.notEqual(continueStep(p, tracks).track.key, 'reading');
  const all = emptyProgress();
  for (const t of tracks) for (const step of trackSteps(t)) play(all, step.id, 2, 1);
  assert.equal(continueStep(all, tracks), null);
});

test('a step is found, and its track, by id', () => {
  const tune = 'song:ode-to-joy/1r';
  assert.equal(trackOf(tracks, tune).key, 'reading', 'the first track it is in');
  assert.equal(findStep(tracks, tune).label, 'Ode to Joy melody');
  assert.equal(trackOf(tracks, 'nope'), null);
  assert.equal(findStep(tracks, 'nope'), null);
});

/* ---- As rows ---------------------------------------------------------------- */

test('the program folder: Continue, Skip, the tracks, then Repetition', () => {
  let asked = 0;
  const node = programFolder(tracks, () => { asked++; return [{ label: 'r', repId: 'x' }]; });
  assert.deepEqual(node.children.map((c) => c.label),
    ['Continue', 'Skip next', 'Reading', 'Chords', 'Songs', 'Ear', 'Repetition']);
  assert.equal(asked, 0, 'repetition is worked out only when looked at');
  const rep = node.children[6];
  assert.ok(isFolder(rep) && rep.untracked);
  assert.equal(rep.children[0].repId, 'x');
  assert.equal(asked, 1);
});

test('steps in the tree carry the id of the row they point at', () => {
  const program = root.children[0];
  assert.equal(program.id, 'program');
  const firstStep = program.children[2].children[0].children[0];
  assert.equal(firstStep.id, trackSteps(tracks[0])[0].id);
  assert.ok(firstStep.step);
});

test('ids are unique across the whole tree', () => {
  const seen = new Map();
  const walk = (node) => {
    for (const child of node.children) {
      if (child.untracked) continue;
      if (isFolder(child)) { walk(child); continue; }
      if (!child.id || child.step) continue;
      assert.ok(!seen.has(child.id), `${child.id} is used twice`);
      seen.set(child.id, true);
    }
  };
  walk(root);
  assert.ok(seen.size > 500);
});

test('ids do not move when the key changes', () => {
  const inC = buildCatalog({ songs, categories, gen: { rootPc: 0 } });
  const inFs = buildCatalog({ songs, categories, gen: { rootPc: 6, mode: 'dorian' } });
  assert.deepEqual([...leafIndex(inC).keys()], [...leafIndex(inFs).keys()]);
});
