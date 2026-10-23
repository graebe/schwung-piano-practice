// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * program.mjs — the Path: following it. Pure.
 *
 * curriculum.mjs says WHAT the path is: five phases of units of exercises.
 * On screen a phase is a STAGE; the code keeps its own word for it, and the
 * ids (p1, program/p1) never change, so nobody's progress moves.
 * This module says how a learner moves along it, from nothing but their
 * progress, so there is no second record to keep in step:
 *
 *   A unit is FINISHED when every step is finished or skipped, and READY when
 *   every unit it comes after is finished or sits in an assumed phase.
 *
 *   A phase is ASSUMED when it lies before the learner's start — set by
 *   Start the path here, or by passing its check through Test out:
 *   checkpoint. It is PASSED when its check steps are passed at stage 2
 *   however that happened, and DONE when every unit is finished.
 *
 *   The learner's phase is the earliest from the start that is neither done
 *   nor passed. Continue offers the next step of a ready unit from the start
 *   up to that phase — so units left over from a passed phase stay in the mix
 *   while the hands move on — choosing the unit whose strand was practised
 *   longest ago, so a session mixes reading, harmony, ear and pieces.
 *
 * The only thing stored is the start (progress.program.start): a choice the
 * learner made. Everything else follows from the results.
 *
 * Nothing is ever locked. The program only recommends.
 */

import { item, isFinished, stagePassed, programStart } from './progress.mjs';
import { exerciseByKey, isNaming, resolveLegacy } from './ear.mjs';
import { folder, slug, stampChildren } from './catalog.mjs';
import { buildPhases, levelSteps, N, C, EAR } from './curriculum.mjs';

/*
 * What the program's generated steps are built with, whatever the settings
 * say: the curriculum teaches in C, and "Random in key" must not turn Dorian
 * because Basics was last used in Dorian. The ids are the same as Basics', so
 * a drill played there in another key still counts for the step.
 */
export const PROGRAM_GEN = { rootPc: 0, mode: 'major' };

/*
 * The whole path, numbered: phases 1-5, units "2.3". A unit with nothing
 * installed in it (a whole-category unit whose files are missing) is left out
 * before numbering, so the numbers on screen have no gaps.
 */
export function buildProgram({ songs = [] } = {}) {
  const phases = buildPhases({ songs });
  for (let p = 0; p < phases.length; p++) {
    const ph = phases[p];
    ph.units = ph.units.filter((u) => u.exercises.length > 0);
    ph.index = p;
    ph.n = p + 1;
    for (let u = 0; u < ph.units.length; u++) {
      ph.units[u].num = ph.n + '.' + (u + 1);
      ph.units[u].phase = ph;
    }
  }
  return phases;
}

/* ---- Steps ----------------------------------------------------------------- */

export function unitSteps(unit) {
  const out = [];
  for (let e = 0; e < unit.exercises.length; e++) {
    const steps = unit.exercises[e].steps;
    for (let s = 0; s < steps.length; s++) out.push(steps[s]);
  }
  return out;
}

export function phaseSteps(phase) {
  let out = [];
  for (let u = 0; u < phase.units.length; u++) out = out.concat(unitSteps(phase.units[u]));
  return out;
}

export function allSteps(phases) {
  let out = [];
  for (let p = 0; p < phases.length; p++) out = out.concat(phaseSteps(phases[p]));
  return out;
}

/* What a step is called on its own, outside its folder. */
export function stepTitle(step) {
  return step.title || step.label;
}

/* The unit (and its phase) a step id belongs to. */
export function unitOf(phases, id) {
  for (let p = 0; p < phases.length; p++) {
    for (let u = 0; u < phases[p].units.length; u++) {
      const unit = phases[p].units[u];
      if (unitSteps(unit).some((s) => s.id === id)) return unit;
    }
  }
  return null;
}

export function findStep(phases, id) {
  const unit = unitOf(phases, id);
  return unit ? unitSteps(unit).find((s) => s.id === id) : null;
}

/* The exercise a step belongs to, for its description. */
export function exerciseOf(phases, id) {
  const unit = unitOf(phases, id);
  return unit ? unit.exercises.find((e) => e.steps.some((s) => s.id === id)) : null;
}

/* ---- State, from progress -------------------------------------------------- */

const settled = (progress, step) => {
  const it = item(progress, step.id);
  return isFinished(it) || Boolean(it && it.skip);
};

/* The first step neither finished nor skipped, or null when the unit is done. */
export function nextInUnit(progress, unit) {
  const steps = unitSteps(unit);
  for (let i = 0; i < steps.length; i++) if (!settled(progress, steps[i])) return steps[i];
  return null;
}

export function unitFinished(progress, unit) {
  return nextInUnit(progress, unit) === null;
}

export function phaseDone(progress, phase) {
  return phase.units.every((u) => unitFinished(progress, u));
}

/* Its check steps, each passed at stage 2 — however it came about. */
export function checkPassed(progress, phase) {
  return phase.check.length > 0 && phase.check.every((id) => stagePassed(item(progress, id), 2));
}

/* The phase Continue starts from: 0, or where the learner put it. */
export function startIndex(progress, phases) {
  return Math.max(0, Math.min(phases.length - 1, programStart(progress)));
}

export function isAssumed(progress, phases, phase) {
  return phase.index < startIndex(progress, phases);
}

/* The learner's phase, or null when every phase from the start is through. */
export function currentPhase(progress, phases) {
  for (let p = startIndex(progress, phases); p < phases.length; p++) {
    if (!phaseDone(progress, phases[p]) && !checkPassed(progress, phases[p])) return phases[p];
  }
  return null;
}

function unitByKey(phases, key) {
  for (let p = 0; p < phases.length; p++) {
    const u = phases[p].units.find((x) => x.key === key);
    if (u) return u;
  }
  return null;
}

export function unitReady(progress, phases, unit) {
  return unit.after.every((key) => {
    const before = unitByKey(phases, key);
    return !before || unitFinished(progress, before) || isAssumed(progress, phases, before.phase);
  });
}

/* When each strand was last practised, by any of its steps, in unix seconds:
 * { grid: t, read: t, ... }, in one pass over the path. */
export function strandActivity(progress, phases) {
  const latest = {};
  for (let p = 0; p < phases.length; p++) {
    for (let u = 0; u < phases[p].units.length; u++) {
      const unit = phases[p].units[u];
      const steps = unitSteps(unit);
      let t = latest[unit.strand] || 0;
      for (let s = 0; s < steps.length; s++) {
        const it = item(progress, steps[s].id);
        if (it && it.t > t) t = it.t;
      }
      latest[unit.strand] = t;
    }
  }
  return latest;
}

/*
 * Continue: among the ready units with something left, from the start up to
 * the learner's phase, the one whose strand was practised longest ago; ties
 * go to the earlier unit, so a fresh start opens 1.1 and the first session
 * walks the strands in turn. Past every phase, whatever is left anywhere.
 */
export function continueStep(progress, phases) {
  const cur = currentPhase(progress, phases);
  const from = cur ? startIndex(progress, phases) : 0;
  const to = cur ? cur.index : phases.length - 1;
  const activity = strandActivity(progress, phases);
  let best = null;
  let bestAt = Infinity;
  for (let p = from; p <= to; p++) {
    for (let u = 0; u < phases[p].units.length; u++) {
      const unit = phases[p].units[u];
      const step = nextInUnit(progress, unit);
      if (!step || !unitReady(progress, phases, unit)) continue;
      const at = activity[unit.strand] || 0;
      if (at < bestAt) {
        best = { phase: phases[p], unit, step };
        bestAt = at;
      }
    }
  }
  return best;
}

/* A check's next step: the first not yet passed at stage 2. */
export function nextCheckStep(progress, phases, phase) {
  for (let i = 0; i < phase.check.length; i++) {
    if (!stagePassed(item(progress, phase.check[i]), 2)) return findStep(phases, phase.check[i]);
  }
  return null;
}

/*
 * The quiz options behind a quiz id, so a repetition or a step can be opened
 * without a row of the Quiz folder to read them from.
 */
export function quizFromId(id) {
  const parts = String(id).replace(/^quiz:/, '').split(':');
  if (parts.length !== 3) return null;
  const [mode, kind, set] = parts;
  if (mode === EAR) {
    /* An exercise the courses replaced opens its course twin. */
    const [exKey, level] = resolveLegacy(kind, set);
    const ex = exerciseByKey(exKey);
    if (!isNaming(ex) || !ex.levels.some((l) => l.key === level)) return null;
    return { kind: EAR, exercise: exKey, level, hear: true, pick: true };
  }
  if (kind !== N && kind !== C) return null;
  return {
    kind,
    hear: mode === 'hear',
    pick: mode === 'pick',
    read: mode === 'staff' ? 'staff' : null,
    halfTones: kind === N ? set === 'half' : false,
    chordSet: kind === C ? set : 'triads',
  };
}

/* ---- As rows of the lesson list ------------------------------------------- */

/* A step as a row of a list: a leaf under its own id, so it is summed and
 * marked wherever it appears. */
export function stepRow(step) {
  return { label: step.label, value: '', key: step.id, absolute: true, step };
}

/* A step where it sits on the path, which is where it can be skipped. */
const pathStepRow = (step) => ({ ...stepRow(step), path: true });

/* An exercise in a unit: its step, or a folder of its steps. */
function exerciseRow(ex) {
  if (ex.steps.length === 1) return pathStepRow(ex.steps[0]);
  return { ...folder(ex.label, ex.steps.map(pathStepRow), slug(ex.label)), pathFolder: true };
}

function unitRow(unit) {
  return { label: unit.num + ' ' + unit.name, value: '>', key: unit.key, unit, children: unit.exercises.map(exerciseRow) };
}

/*
 * A stage's exam, as the last row of its folder: the check steps, each named
 * on its own since they come from several units. Opened from here they are
 * played at S2, one after another, as Test out: checkpoint does.
 */
function checkpointRow(phase, phases) {
  const rows = phase.check.map((id) => {
    const step = findStep(phases, id);
    return { ...pathStepRow(step), label: stepTitle(step) };
  });
  return { label: 'Checkpoint', value: '>', key: 'checkpoint', checkpoint: phase, children: rows };
}

function phaseRow(phase, phases) {
  const rows = phase.units.map(unitRow);
  if (phase.check.length) rows.push(checkpointRow(phase, phases));
  /* Shown as the stage's island (map_places.mjs): a place per unit, then the fort. */
  return { label: phase.n + ' ' + phase.name, value: '>', key: phase.key, phase, view: 'map', children: rows };
}

/*
 * The Path folder: Continue, the five stages, then Review while anything is
 * due (Continue and Review are rows of its list; on its map Continue is
 * PLAY, and Review one option away). What
 * is due changes with the day and with every result, so the folder's rows are
 * asked for each time rather than built once; the stages are built once and
 * stamped here, since a folder made on demand is not stamped by the catalog.
 * Review's rows are the caller's (they need the session's titles), and the
 * folder sums leave them out.
 */
export function programFolder(phases, repetitionRows = () => []) {
  const stages = phases.map((p) => phaseRow(p, phases));
  stampChildren(stages, 'program');
  const cont = { label: 'Continue', value: '', continueRow: true, id: 'program/continue' };
  const review = {
    label: 'Review',
    value: '>',
    key: 'repetition',
    id: 'program/repetition',
    untracked: true,
    get children() { return repetitionRows(); },
  };
  return {
    label: 'Learning Path',
    value: '>',
    key: 'program',
    /* Shown as the world map: an island per stage. Review is in its list. */
    view: 'map',
    /* In its list, Continue first: on the map it is PLAY. */
    get children() {
      const rows = [cont].concat(stages);
      return repetitionRows().some((r) => !r.done) ? rows.concat([review]) : rows;
    },
  };
}

/* Every step inside a node of the path (a stage, a unit, an exercise), in
 * order, each once. A checkpoint's steps are the units' own, so they are not
 * counted twice. */
export function stepsUnder(node) {
  const out = [];
  const seen = new Set();
  const walk = (n) => {
    if (n.step) {
      if (!seen.has(n.step.id)) { seen.add(n.step.id); out.push(n.step); }
      return;
    }
    if (!n.children || n.untracked) return;
    for (const c of n.children) walk(c);
  };
  walk(node);
  return out;
}

/* ---- The hearing drills under the trainers' Learn ------------------------ */

/* An exercise in a list: a folder of its levels, or, with one level, the
 * level itself, named as the exercise. */
function levelsRow(ex, name = ex.name) {
  const steps = levelSteps(ex);
  if (steps.length === 1) return stepRow({ ...steps[0], label: name });
  return folder(name, steps.map(stepRow), ex.key);
}

/* A hearing drill as a row of a trainer's Learn list, by its key: under the
 * quiz ids it has always had, wherever the list is. */
export function drillRow(key) {
  return levelsRow(exerciseByKey(key));
}
