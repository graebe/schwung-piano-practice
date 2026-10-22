// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * map_places.mjs — the Path as places on the map: one island per stage on the
 * world map, one place per unit (and a fort for the checkpoint) on a stage's
 * island. Pure: it reads the program and the progress record, and hands the
 * pathmap engine its places plus, for each, what entering it opens.
 *
 * States, from the learner's side (there are no locks: every place opens):
 *   done      finished, or a stage whose checkpoint was passed
 *   skipped   a stage before "Start the path here", or a unit all skipped
 *   current   where Continue is taking you
 *   started   something in it played, not finished
 *   ahead     not yet: a later stage, or a unit whose `after` units are open
 *   fresh     nothing played, but nothing before it is missing either
 */
import * as PLAN from './program.mjs';
import * as PROG from './progress.mjs';
import { makePlace } from './pathmap/model.mjs';

/* The ids of today's repetition session still to do, as a Set. */
export function dueIdsOf(progress, atMs) {
  const out = new Set();
  const session = PROG.repetitionSession(progress, atMs);
  for (let i = 0; i < session.length; i++) if (!session[i].done) out.add(session[i].id);
  return out;
}

function countIn(ids, set) {
  let n = 0;
  for (let i = 0; i < ids.length; i++) if (set.has(ids[i])) n++;
  return n;
}

const idsOf = (steps) => steps.map((s) => s.id);

function anyPlayed(progress, ids) {
  for (let i = 0; i < ids.length; i++) {
    const it = progress.items[ids[i]];
    if (it && (it.t || it.skip)) return true;
  }
  return false;
}

/* Units with nothing installed have no place on the map, as in the list. */
export function shownUnits(phase) {
  return phase.units.filter((u) => PLAN.unitSteps(u).length > 0);
}

/*
 * The world map: a place per stage. `targets[i]` is { phase } for the island.
 */
export function stagePlaces(progress, phases, dueIds = new Set()) {
  const cur = PLAN.currentPhase(progress, phases);
  const places = [];
  const targets = [];
  for (let p = 0; p < phases.length; p++) {
    const ph = phases[p];
    const ids = idsOf(PLAN.phaseSteps(ph));
    const sum = PROG.summariseIds(progress, ids);
    let state;
    if (PLAN.phaseDone(progress, ph) || PLAN.checkPassed(progress, ph)) state = 'done';
    else if (PLAN.isAssumed(progress, phases, ph)) state = 'skipped';
    else if (cur && ph === cur) state = 'current';
    else if (anyPlayed(progress, ids)) state = 'started';
    else if (cur && ph.index > cur.index) state = 'ahead';
    else state = 'fresh';
    places.push(makePlace({
      id: ph.key, label: `${ph.n} ${ph.name}`, percent: sum.percent, state,
      due: countIn(ids, dueIds), kind: 'island',
    }));
    targets.push({ phase: ph });
  }
  return { places, targets };
}

/*
 * A stage's island: a place per unit, in the curriculum's order, then the
 * checkpoint fort when the stage has one. `targets[i]` is { unit } or
 * { check: phase }.
 */
export function unitPlaces(progress, phases, phase, dueIds = new Set()) {
  const next = PLAN.continueStep(progress, phases);
  const assumed = PLAN.isAssumed(progress, phases, phase);
  const places = [];
  const targets = [];
  const units = shownUnits(phase);
  for (let u = 0; u < units.length; u++) {
    const unit = units[u];
    const ids = idsOf(PLAN.unitSteps(unit));
    const sum = PROG.summariseIds(progress, ids);
    const allSkipped = ids.every((id) => {
      const it = progress.items[id];
      return Boolean(it && it.skip);
    });
    let state;
    if (allSkipped) state = 'skipped';
    else if (PLAN.unitFinished(progress, unit)) state = 'done';
    else if (assumed) state = 'skipped';
    else if (next && next.unit === unit) state = 'current';
    else if (anyPlayed(progress, ids)) state = 'started';
    else if (!PLAN.unitReady(progress, phases, unit)) state = 'ahead';
    else state = 'fresh';
    places.push(makePlace({
      id: unit.key, label: `${unit.num} ${unit.name}`, percent: sum.percent, state,
      due: countIn(ids, dueIds), kind: 'place',
    }));
    targets.push({ unit });
  }
  if (phase.check.length) {
    const sum = PROG.summariseIds(progress, phase.check);
    const passed = PLAN.checkPassed(progress, phase);
    places.push(makePlace({
      id: `${phase.key}:check`, label: 'Checkpoint', percent: passed ? 100 : sum.percent,
      state: passed ? 'done' : anyPlayed(progress, phase.check) ? 'started' : 'fresh', kind: 'fort',
    }));
    targets.push({ check: phase });
  }
  return { places, targets };
}

/* Where the avatar first stands: the current place, else the first open one. */
export function startPlace(places) {
  const cur = places.findIndex((p) => p.state === 'current');
  if (cur >= 0) return cur;
  const open = places.findIndex((p) => p.state !== 'done' && p.state !== 'skipped');
  return open >= 0 ? open : 0;
}
