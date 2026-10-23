// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
import test from 'node:test';
import assert from 'node:assert/strict';

import { sheetFor, LABELS, SKIP, SKIP_ALL, UNDO, START, TEST_OUT, SETTINGS, LIST, MAP } from '../src/row_sheet.mjs';
import { buildProgram, programFolder, stepsUnder } from '../src/program.mjs';

const phases = buildProgram();
const path = programFolder(phases);
const stage1 = path.children[1];
const stage5 = path.children[5];
const unit = stage1.children[0];
const step = unit.children[0];

function look({ settled = [], skipped = [], next = true } = {}) {
  return {
    settled: (id) => settled.includes(id) || skipped.includes(id),
    skipped: (id) => skipped.includes(id),
    continueSkippable: () => next,
  };
}
const acts = (row, l) => sheetFor(row, l).map((it) => it.act);

test('the labels are the shared ones, and Settings... always comes last', () => {
  assert.deepEqual(LABELS, {
    [SKIP]: 'I know this: skip', [SKIP_ALL]: 'I know it all: skip', [UNDO]: 'Undo skip',
    [START]: 'Start the path here', [TEST_OUT]: 'Test out: checkpoint', [LIST]: 'Show as list',
    [MAP]: 'Show as map', [SETTINGS]: 'Settings...',
  });
  for (const row of [null, { label: 'Practice', children: [] }, step, unit, stage1, { continueRow: true }]) {
    assert.equal(acts(row, look()).at(-1), SETTINGS);
  }
  assert.deepEqual(sheetFor({ label: 'Practice', children: [] }, look()), [{ label: 'Settings...', act: SETTINGS }]);
});

test('Continue: skip the step it would open, if it is a new step', () => {
  assert.deepEqual(acts({ continueRow: true }, look()), [SKIP, SETTINGS]);
  assert.deepEqual(acts({ continueRow: true }, look({ next: false })), [SETTINGS], 'a review is not skipped');
});

test('a step: skip it, or undo its skip', () => {
  assert.deepEqual(acts(step, look()), [SKIP, SETTINGS]);
  assert.deepEqual(acts(step, look({ skipped: [step.step.id] })), [UNDO, SETTINGS]);
  assert.deepEqual(acts(step, look({ settled: [step.step.id] })), [SETTINGS], 'finished: nothing to skip');
  assert.deepEqual(acts({ ...step, path: false }, look()), [SETTINGS], 'only steps on the path');
});

test('a stage: skip all, start here, test out; the last stage has no checkpoint', () => {
  assert.deepEqual(acts(stage1, look()), [SKIP_ALL, START, TEST_OUT, SETTINGS]);
  assert.deepEqual(acts(stage5, look()), [SKIP_ALL, START, SETTINGS]);
  const all = stepsUnder(stage1).map((s) => s.id);
  assert.deepEqual(acts(stage1, look({ skipped: all })), [UNDO, START, TEST_OUT, SETTINGS], 'all skipped');
  assert.deepEqual(acts(stage1, look({ skipped: all.slice(0, 1) })), [SKIP_ALL, UNDO, START, TEST_OUT, SETTINGS]);
});

test('a unit and an exercise of several steps skip everything inside; the checkpoint does not', () => {
  assert.deepEqual(acts(unit, look()), [SKIP_ALL, SETTINGS]);
  const multi = path.children[2].children.find((u) => u.unit.key === 'first-tracks').children[0];
  assert.ok(multi.pathFolder);
  assert.deepEqual(acts(multi, look()), [SKIP_ALL, SETTINGS]);
  assert.deepEqual(acts(stage1.children.at(-1), look()), [SETTINGS], 'the Checkpoint folder');
  assert.deepEqual(acts(stage1.children.at(-1).children[0], look()), [SKIP, SETTINGS], 'its steps are steps');
});

test('on a map the list is one option away, and in the list the map', () => {
  const on = (view) => ({ ...look(), view: () => view });
  assert.deepEqual(acts(stage1, on('map')).slice(-2), [LIST, SETTINGS]);
  assert.deepEqual(acts(stage1, on('list')).slice(-2), [MAP, SETTINGS]);
  assert.deepEqual(acts(stage1, on(null)).slice(-2), [TEST_OUT, SETTINGS], 'a plain list: neither');
});
