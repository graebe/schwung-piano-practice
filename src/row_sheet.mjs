// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * row_sheet.mjs — the options for a row of the list (Shift + jog-click). Pure.
 *
 * Skipping, starting the path somewhere and testing out of a stage used to be
 * rows of their own, between the lessons. They are actions on a row now, and
 * this says which apply to which row, in a fixed order and in the student's
 * words. Only what applies is offered; Settings... always closes the list.
 *
 *   sheetFor(row, look) -> [{ label, act }]
 *
 * `look` answers what a row cannot know about itself, from the progress:
 *   look.settled(id)          finished or skipped
 *   look.skipped(id)          skipped, or moved on from after S1
 *   look.continueSkippable()  Continue's next step is a new step to skip
 *   look.view()               'map' when the open folder is shown as its map,
 *                             'list' when a map folder is shown as a list
 *
 * The session carries out the `act`.
 */

import { stepsUnder } from './program.mjs';

export const SKIP = 'skip';
export const SKIP_ALL = 'skip-all';
export const UNDO = 'undo';
export const START = 'start';
export const TEST_OUT = 'test-out';
export const SETTINGS = 'settings';
export const LIST = 'list';
export const MAP = 'map';

export const LABELS = {
  [SKIP]: 'I know this: skip',
  [SKIP_ALL]: 'I know it all: skip',
  [UNDO]: 'Undo skip',
  [START]: 'Start the path here',
  [TEST_OUT]: 'Test out: checkpoint',
  [LIST]: 'Show as list',
  [MAP]: 'Show as map',
  [SETTINGS]: 'Settings...',
};

/* A folder on the path that skipping all of makes sense for: a stage, a unit,
 * an exercise of several steps. Not the checkpoint: its steps are the units'
 * own, and an exam is passed, not skipped. */
const pathFolder = (row) => Boolean(row.phase || row.unit || row.pathFolder);

export function sheetFor(row, look) {
  const acts = [];
  if (row && row.continueRow) {
    if (look.continueSkippable()) acts.push(SKIP);
  } else if (row && row.step && row.path) {
    if (!look.settled(row.step.id)) acts.push(SKIP);
    if (look.skipped(row.step.id)) acts.push(UNDO);
  } else if (row && pathFolder(row)) {
    const steps = stepsUnder(row);
    if (steps.some((s) => !look.settled(s.id))) acts.push(SKIP_ALL);
    if (steps.some((s) => look.skipped(s.id))) acts.push(UNDO);
    if (row.phase) {
      acts.push(START);
      if (row.phase.check.length) acts.push(TEST_OUT);
    }
  }
  /* A map hides what is no place — the Path's Review — so its list is one
   * option away, for the session, and the map one option back. */
  const view = look.view ? look.view() : null;
  if (view === 'map') acts.push(LIST);
  if (view === 'list') acts.push(MAP);
  acts.push(SETTINGS);
  return acts.map((act) => ({ label: LABELS[act], act }));
}
