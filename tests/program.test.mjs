// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

import {
  buildProgram, programFolder, allSteps, phaseSteps, unitSteps, stepTitle, unitOf, findStep, exerciseOf,
  continueStep, currentPhase, checkPassed, unitReady, isAssumed, nextInUnit, nextCheckStep, startIndex,
  quizFromId, PROGRAM_GEN,
} from '../src/program.mjs';
import { OFF_PATH, STRANDS, courseSteps } from '../src/curriculum.mjs';
import { buildCatalog, leafIndex, findById, isFolder, basics, stampChildren } from '../src/catalog.mjs';
import { parseManifest, parseCategories, parseExercise, validateExercise } from '../src/exercise_io.mjs';
import { emptyProgress, recordAttempt, skipItem, setProgramStart, parseProgress, serialiseProgress } from '../src/progress.mjs';
import { drillId } from '../src/stats.mjs';

const T0 = Date.UTC(2026, 9, 1, 12);
const play = (p, id, stage, score, at = T0) => recordAttempt(p, id, { stage, score, at });
const finish = (p, id, at = T0) => { play(p, id, 1, 1, at); play(p, id, 2, 1, at); };

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
const phases = buildProgram({ songs });
const root = buildCatalog({ songs, categories, lead: [programFolder(phases)] });
const index = leafIndex(root);
const unit = (key) => phases.flatMap((p) => p.units).find((u) => u.key === key);

/* ---- The shape of the path ------------------------------------------------- */

test('five phases of numbered units, each unit of one strand', () => {
  assert.deepEqual(phases.map((p) => p.n), [1, 2, 3, 4, 5]);
  for (const p of phases) {
    assert.ok(p.title && p.promise && p.idea, p.key);
    p.units.forEach((u, i) => {
      assert.equal(u.num, p.n + '.' + (i + 1));
      assert.ok(STRANDS[u.strand], u.key + ' has a strand');
      assert.ok(u.purpose, u.key + ' says what it is for');
      assert.ok(u.exercises.length > 0, u.key);
    });
  }
});

/*
 * The program is pointers into the tree. A step that points at nothing would
 * be a Continue that does nothing, so every one is resolved against the tree
 * exactly as the Move builds it.
 */
test('every step of the path opens a real exercise', () => {
  for (const step of allSteps(phases)) {
    if (step.quiz) {
      assert.equal(step.id, 'quiz:' + drillId(step.quiz));
      assert.equal(drillId(quizFromId(step.id)), drillId(step.quiz), step.id);
      continue;
    }
    const hit = index.get(step.id);
    assert.ok(hit && hit.node.build, `${step.id} resolves to nothing`);
  }
});

test('no step sits in two units, and every unit comes after earlier ones only', () => {
  const seen = new Map();
  const before = new Set();
  for (const p of phases) {
    for (const u of p.units) {
      for (const a of u.after) assert.ok(before.has(a), `${u.key} comes after ${a}, which is not earlier`);
      before.add(u.key);
      for (const s of unitSteps(u)) {
        assert.ok(!seen.has(s.id), `${s.id} is in ${u.key} and ${seen.get(s.id)}`);
        seen.set(s.id, u.key);
      }
    }
  }
});

test('every check step is a step of its own phase, and the last phase has no check', () => {
  for (const p of phases.slice(0, 4)) {
    assert.ok(p.check.length >= 3 && p.check.length <= 5, p.key);
    const ids = new Set(phaseSteps(p).map((s) => s.id));
    for (const id of p.check) assert.ok(ids.has(id), `${p.key} checks ${id}, which it does not teach`);
  }
  assert.deepEqual(phases[4].check, []);
});

test('the nursery songs stay off the path', () => {
  const ids = allSteps(phases).map((s) => s.id);
  for (const song of OFF_PATH) assert.ok(!ids.some((id) => id.indexOf('song:' + song + '/') === 0), song);
});

test('every exercise says what you do and why, except the units that describe themselves', () => {
  for (const p of phases) {
    for (const u of p.units) {
      for (const e of u.exercises) {
        if (u.summary) continue;
        assert.ok(e.about && e.why, `${u.key}: ${e.label}`);
      }
    }
  }
});

test('labels fit a row of the Move\'s list', () => {
  for (const p of phases) {
    assert.ok((p.n + ' ' + p.name).length <= 19, p.name);
    for (const u of p.units) {
      assert.ok((u.num + ' ' + u.name).length <= 19, u.name);
      for (const e of u.exercises) assert.ok(e.label.length <= 19, e.label);
    }
  }
});

test('the ear courses are trimmed to the levels that teach', () => {
  assert.deepEqual(courseSteps('id-2nds').map((s) => s.label), ['Hear up', 'Hear down', 'Hear tog', 'Read up']);
  assert.deepEqual(courseSteps('cmp-6ths').map((s) => s.id), ['quiz:ear:cmp-6ths:fix-up', 'quiz:ear:cmp-6ths:together']);
  assert.deepEqual(courseSteps('cmp-M2-m3').map((s) => s.id), ['quiz:ear:cmp-M2-m3:melodic']);
  assert.deepEqual(courseSteps('sc-maj-min').map((s) => s.id),
    ['quiz:ear:sc-maj-min:up', 'quiz:ear:sc-maj-min:down', 'quiz:ear:rd-sc-maj-min:up']);
  const total = allSteps(phases).length;
  const ear = phases.flatMap((p) => p.units).filter((u) => u.strand === 'ear').flatMap(unitSteps).length;
  assert.ok(ear / total < 0.5, `the ear is ${ear} of ${total} steps`);
});

/* ---- What the steps are built with ----------------------------------------- */

function pinnedTree() {
  const pinned = basics({ ...PROGRAM_GEN });
  stampChildren([pinned], '');
  return { children: [pinned] };
}

test('generated steps are built in C major, whatever the settings say', () => {
  const settingsBasics = basics({ rootPc: 6, mode: 'dorian' });
  stampChildren([settingsBasics], '');
  const id = 'basics/random/in-key';
  assert.equal(findById(pinnedTree(), id).node.build().keySig, 0);
  assert.notEqual(findById({ children: [settingsBasics] }, id).node.build().keySig, 0, 'the settings tree follows the settings');
});

test('Phase 1 reads in C: no black key before Black keys', () => {
  const tree = pinnedTree();
  const BLACK = new Set([1, 3, 6, 8, 10]);
  for (const u of phases[0].units) {
    if (u.key === 'black-keys') break;
    for (const s of unitSteps(u)) {
      if (s.quiz) continue;
      const hit = s.id.indexOf('basics/') === 0 ? findById(tree, s.id) : index.get(s.id);
      const chart = hit.node.build();
      const black = chart.events.flatMap((e) => e.pitches).filter((p) => BLACK.has(p % 12));
      assert.equal(black.length, 0, s.id);
      assert.equal(chart.keySig || 0, 0, s.id);
    }
  }
});

test('the first units build valid charts', () => {
  for (const p of phases) {
    for (const s of unitSteps(p.units[0])) {
      if (s.quiz) continue;
      const { ok, errors } = validateExercise(index.get(s.id).node.build());
      assert.ok(ok, s.id + ': ' + errors.join('; '));
    }
  }
});

/* ---- Following it ------------------------------------------------------------ */

test('a fresh start opens 1.1, and the first session walks the strands', () => {
  const p = emptyProgress();
  const first = continueStep(p, phases);
  assert.equal(first.unit.key, 'major-scale');
  assert.equal(first.step.id, 'basics/scales/major/up-down');
  /* Each finished step makes its strand the most recent, so the next
   * Continue turns to another: the three ready from the start first, then
   * every strand of the phase as its units open. */
  const strands = [];
  for (let i = 0; i < 24; i++) {
    const next = continueStep(p, phases);
    strands.push(next.unit.strand);
    finish(p, next.step.id, T0 + i * 1000);
  }
  assert.deepEqual(strands.slice(0, 3).sort(), ['ear', 'grid', 'scales']);
  assert.deepEqual([...new Set(strands)].sort(), ['chords', 'ear', 'grid', 'pieces', 'read', 'scales'], strands.join(' '));
});

test('a beginner stays in Phase 1 until its check steps are passed', () => {
  const p = emptyProgress();
  let i = 0;
  while (!checkPassed(p, phases[0])) {
    const next = continueStep(p, phases);
    assert.equal(next.phase.n, 1, `step ${i}: ${next.step.id}`);
    finish(p, next.step.id, T0 + i * 1000);
    i++;
  }
  assert.ok(i >= 12, 'the check steps sit across the phase, not at its start: ' + i);
  assert.equal(currentPhase(p, phases).n, 2);
});

test('a unit is ready once what it comes after is finished, or assumed', () => {
  const p = emptyProgress();
  const chords = unit('first-chords');
  assert.equal(unitReady(p, phases, chords), false);
  for (const s of unitSteps(unit('black-keys'))) finish(p, s.id);
  assert.equal(unitReady(p, phases, chords), true);
  const fresh = emptyProgress();
  setProgramStart(fresh, 1);
  assert.equal(unitReady(fresh, phases, unit('i-iv-v')), true, 'First chords sits in an assumed phase');
});

test('a skipped step settles the unit as well as a finished one', () => {
  const p = emptyProgress();
  const u = unit('major-scale');
  skipItem(p, unitSteps(u)[0].id, T0);
  assert.equal(nextInUnit(p, u).id, unitSteps(u)[1].id);
});

test('a check counts only at stage 2', () => {
  const p = emptyProgress();
  for (const id of phases[0].check) play(p, id, 1, 1);
  assert.equal(checkPassed(p, phases[0]), false);
  for (const id of phases[0].check) play(p, id, 2, 1);
  assert.equal(checkPassed(p, phases[0]), true);
});

test('the next check step is the first not passed at stage 2', () => {
  const p = emptyProgress();
  play(p, phases[1].check[0], 2, 1);
  assert.equal(nextCheckStep(p, phases, phases[1]).id, phases[1].check[1]);
  for (const id of phases[1].check) play(p, id, 2, 1);
  assert.equal(nextCheckStep(p, phases, phases[1]), null);
});

test('passing a check in practice moves the phase on, and keeps its leftovers in the mix', () => {
  const p = emptyProgress();
  for (const id of phases[0].check) finish(p, id);
  assert.equal(currentPhase(p, phases).n, 2);
  assert.equal(isAssumed(p, phases, phases[0]), false, 'practice does not skip the rest');
  /* Phase 1 still has units left; they stay among Continue's choices. */
  const picks = new Set();
  for (let i = 0; i < 30; i++) {
    const next = continueStep(p, phases);
    picks.add(next.phase.n);
    finish(p, next.step.id, T0 + (i + 1) * 1000);
  }
  assert.ok(picks.has(1) && picks.has(2), [...picks].join(','));
});

test('Start here skips earlier phases: they count as assumed', () => {
  const p = emptyProgress();
  setProgramStart(p, 2);
  assert.equal(startIndex(p, phases), 2);
  assert.ok(isAssumed(p, phases, phases[0]) && isAssumed(p, phases, phases[1]));
  assert.equal(currentPhase(p, phases).n, 3);
  assert.equal(continueStep(p, phases).phase.n, 3);
  setProgramStart(p, 99);
  assert.equal(startIndex(p, phases), 4, 'clamped to the last phase');
});

test('Continue is null only when every phase is through', () => {
  const p = emptyProgress();
  for (const s of allSteps(phases)) finish(p, s.id);
  assert.equal(continueStep(p, phases), null);
  assert.equal(currentPhase(p, phases), null);
});

test('existing progress counts: a step finished before the path existed is finished on it', () => {
  const p = emptyProgress();
  finish(p, 'song:ode-to-joy/1r');
  assert.equal(nextInUnit(p, unit('first-melodies')).id, 'song:when-the-saints/1r');
});

test('the start round-trips through the file, and old files load at phase 1', () => {
  const p = emptyProgress();
  setProgramStart(p, 3);
  assert.equal(startIndex(parseProgress(serialiseProgress(p)), phases), 3);
  assert.equal(startIndex(parseProgress(JSON.stringify({ version: 1, items: {} })), phases), 0);
  assert.equal(startIndex(parseProgress(JSON.stringify({ program: { start: -4 } })), phases), 0);
});

test('a step is found by id, with its unit and its exercise', () => {
  assert.equal(unitOf(phases, 'song:greensleeves/3').key, 'three-six');
  assert.equal(findStep(phases, 'song:greensleeves/3').label, 'L3 Both hands');
  assert.equal(exerciseOf(phases, 'song:greensleeves/3').label, 'Greensleeves');
  assert.equal(stepTitle(findStep(phases, 'song:greensleeves/3')), 'Greensleeves L3');
  assert.equal(unitOf(phases, 'song:twinkle/1r'), null);
});

/* ---- As rows ---------------------------------------------------------------- */

test('the program folder: Continue, Skip, five phases, then Repetition', () => {
  let asked = 0;
  const node = programFolder(phases, () => { asked++; return [{ label: 'x', repId: 'x' }]; });
  assert.deepEqual(node.children.map((r) => r.label), ['Continue', 'Skip next', '1 Grid and staff', '2 Four chords',
    '3 Shapes and time', '4 Sevenths', '5 Colour', 'Repetition']);
  const p1 = node.children[2];
  assert.deepEqual(p1.children.slice(0, 3).map((r) => r.label), ['Check: skip phase', 'Start here', '1.1 Major scale']);
  assert.ok(p1.children[0].checkRow && p1.children[1].startRow);
  assert.equal(node.children[6].children[0].label, 'Start here', 'the last phase has no check');
  assert.equal(asked, 0, 'repetition is worked out only when looked at');
  assert.equal(node.children.at(-1).children[0].repId, 'x');
});

test('steps in the tree carry the id of the row they point at', () => {
  const program = root.children[0];
  assert.equal(program.id, 'program');
  const firstStep = program.children[2].children[2].children[0];
  assert.equal(firstStep.id, 'basics/scales/major/up-down');
  assert.ok(firstStep.step);
  /* An exercise of several steps is a folder of them. */
  const tracks = program.children[3].children.find((r) => r.unit && r.unit.key === 'first-tracks');
  assert.ok(isFolder(tracks.children[0]));
  assert.deepEqual(tracks.children[0].children.map((r) => r.label), ['L2 RH chords', 'L3 Both hands']);
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

/*
 * Progress is filed under these ids on every learner's device. A rename that
 * drops one orphans everything filed under it, so the list is kept as a
 * fixture: an id may be added, but one that disappears fails here until it is
 * given an alias or removed on purpose (UPDATE_IDS=1).
 */
test('every id a learner may have progress under still exists', () => {
  const file = new URL('./fixtures/leaf_ids.json', import.meta.url);
  const now = [...index.keys()].sort();
  if (process.env.UPDATE_IDS) writeFileSync(file, JSON.stringify(now, null, 1) + '\n');
  const known = JSON.parse(readFileSync(file, 'utf8'));
  const have = new Set(now);
  assert.deepEqual(known.filter((id) => !have.has(id)), []);
});

test('quiz ids open as the drill they name', () => {
  for (const id of ['quiz:staff:notes:half', 'quiz:staff:chords:advanced']) {
    const back = quizFromId(id);
    assert.equal(back.read, 'staff', id);
    assert.equal('quiz:' + drillId(back), id);
  }
  assert.equal(quizFromId('quiz:guess:notes:key').read, null, 'the name drill, as before');
  assert.equal(quizFromId('quiz:nonsense'), null);
  assert.equal(quizFromId('quiz:guess:planets:x'), null);
  assert.equal(quizFromId('quiz:ear:planets:up'), null);
  assert.equal(quizFromId('quiz:ear:thirds:sideways'), null);
  assert.equal(quizFromId('quiz:ear:playback-notes:key'), null, 'play-back is a hear drill, not an ear id');
});
