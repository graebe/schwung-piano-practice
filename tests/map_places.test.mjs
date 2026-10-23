// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildProgram, phaseSteps, unitSteps, continueStep } from '../src/program.mjs';
import { parseManifest, parseExercise } from '../src/exercise_io.mjs';
import { emptyProgress, recordAttempt, skipItem, setProgramStart } from '../src/progress.mjs';
import { stagePlaces, unitPlaces, startPlace, dueIdsOf, shownUnits } from '../src/map_places.mjs';

const T0 = Date.UTC(2026, 9, 1, 12);
const play = (p, id, stage, score, at = T0) => recordAttempt(p, id, { stage, score, at });
const finish = (p, id, at = T0) => { play(p, id, 1, 1, at); play(p, id, 2, 1, at); };

function bundledSongs() {
  const dir = new URL('../src/exercises/', import.meta.url);
  return parseManifest(readFileSync(new URL('index.json', dir), 'utf8')).map((row) => ({
    chart: parseExercise(readFileSync(new URL(row.file, dir), 'utf8'), row.id).chart,
    category: row.category,
  }));
}

const phases = buildProgram({ songs: bundledSongs() });
const states = (r) => r.places.map((p) => p.state);

test('a fresh learner: stage 1 is current, the rest ahead, nothing filled', () => {
  const { places, targets } = stagePlaces(emptyProgress(), phases);
  assert.equal(places.length, phases.length);
  assert.deepEqual(states({ places }), ['current', 'ahead', 'ahead', 'ahead', 'ahead']);
  assert.ok(places.every((p) => p.kind === 'island' && p.percent === 0 && p.due === 0));
  assert.equal(places[0].label, `1 ${phases[0].name}`);
  assert.equal(targets[1].phase, phases[1]);
  assert.equal(startPlace(places), 0);
});

test('a finished stage is done and the next one is current', () => {
  const p = emptyProgress();
  for (const s of phaseSteps(phases[0])) finish(p, s.id);
  const { places } = stagePlaces(p, phases);
  assert.equal(places[0].state, 'done');
  assert.equal(places[0].percent, 100);
  assert.equal(places[1].state, 'current');
  assert.equal(startPlace(places), 1);
});

test('a passed checkpoint marks its stage done without every unit', () => {
  const p = emptyProgress();
  for (const id of phases[0].check) finish(p, id);
  const { places } = stagePlaces(p, phases);
  assert.equal(places[0].state, 'done');
  assert.ok(places[0].percent < 100, 'only the check was played');
  const island = unitPlaces(p, phases, phases[0]);
  const fort = island.places[island.places.length - 1];
  assert.equal(fort.kind, 'fort');
  assert.equal(fort.state, 'done');
  assert.equal(fort.percent, 100);
  assert.equal(island.targets[island.targets.length - 1].check, phases[0]);
});

test('stages before "Start the path here" are skipped, the start is current', () => {
  const p = emptyProgress();
  setProgramStart(p, 2);
  const { places } = stagePlaces(p, phases);
  assert.deepEqual(states({ places }), ['skipped', 'skipped', 'current', 'ahead', 'ahead']);
  const island = unitPlaces(p, phases, phases[0]);
  assert.ok(island.places.filter((x) => x.kind === 'place').every((x) => x.state === 'skipped'));
});

test('a stage played but not current is started', () => {
  const p = emptyProgress();
  play(p, phaseSteps(phases[3])[0].id, 1, 0.5);
  assert.equal(stagePlaces(p, phases).places[3].state, 'started');
});

test('an island: a place per unit in order, Continue\'s unit current, unmet afters ahead', () => {
  const p = emptyProgress();
  const ph = phases[0];
  const { places, targets } = unitPlaces(p, phases, ph);
  const units = shownUnits(ph);
  assert.equal(places.length, units.length + (ph.check.length ? 1 : 0));
  units.forEach((u, i) => {
    assert.equal(places[i].label, `${u.num} ${u.name}`);
    assert.equal(targets[i].unit, u);
  });
  const next = continueStep(p, phases);
  assert.equal(places[units.indexOf(next.unit)].state, 'current');
  units.forEach((u, i) => {
    if (u.after.length && u !== next.unit) assert.equal(places[i].state, 'ahead', u.key);
  });
  assert.equal(startPlace(places), units.indexOf(next.unit));
});

test('units: done, started, and all-skipped', () => {
  const p = emptyProgress();
  const [a, b, c] = shownUnits(phases[0]);
  for (const s of unitSteps(a)) finish(p, s.id);
  play(p, unitSteps(b)[0].id, 1, 0.4);
  for (const s of unitSteps(c)) skipItem(p, s.id, T0);
  const { places } = unitPlaces(p, phases, phases[0]);
  assert.equal(places[0].state, 'done');
  assert.equal(places[0].percent, 100);
  assert.ok(['started', 'current'].includes(places[1].state));
  assert.ok(places[1].percent > 0);
  assert.equal(places[2].state, 'skipped');
});

test('due reviews are counted on their stage and unit', () => {
  const p = emptyProgress();
  const unit = shownUnits(phases[0])[0];
  const id = unitSteps(unit)[0].id;
  const due = new Set([id]);
  assert.equal(stagePlaces(p, phases, due).places[0].due, 1);
  assert.equal(unitPlaces(p, phases, phases[0], due).places[0].due, 1);
  assert.equal(stagePlaces(p, phases, due).places[1].due, 0);
});

test('dueIdsOf reads today\'s repetition session, leaving out what was repeated today', () => {
  const p = emptyProgress();
  assert.equal(dueIdsOf(p, T0).size, 0);
  const id = unitSteps(shownUnits(phases[0])[0])[0].id;
  finish(p, id, T0);
  const later = T0 + 400 * 86400 * 1000;
  assert.ok(dueIdsOf(p, later).has(id), 'a finished item comes due');
});

test('a stage with nothing installed in a unit leaves that unit off its island', () => {
  const ph = { ...phases[0], units: [...phases[0].units, { ...phases[0].units[0], key: 'empty', exercises: [] }] };
  assert.equal(shownUnits(ph).length, shownUnits(phases[0]).length);
});

test('startPlace: past every place it falls back to the first open one, else 0', () => {
  const mk = (state) => ({ state });
  assert.equal(startPlace([mk('done'), mk('fresh')]), 1);
  assert.equal(startPlace([mk('done'), mk('skipped')]), 0);
});
