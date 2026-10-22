// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * model.mjs — what a Path map shows: its places.
 *
 * A place is one island of the world map (a stage) or one place on an island
 * (a unit, a track, the hut, the cove, the fort). Each module's adapter turns
 * its own progress into these; the engine knows nothing else about either
 * module.
 *
 *   { id, label, short, percent (0..100), state, due (count), kind }
 *
 * state
 *   done      finished: a flag flies on it
 *   current   where Continue goes next
 *   started   some of it played
 *   fresh     nothing played yet
 *   skipped   assumed known: the student skipped or tested out of it
 *   ahead     its `after` places are not done yet; drawn dimmer, still
 *             enterable (there are no locks)
 *
 * kind: island | place | fort (checkpoint) | hut (lessons) | cove (electives)
 *
 * Pure: no imports. Vendored byte for byte into Drums Practice.
 */

export const STATES = Object.freeze(['done', 'current', 'started', 'fresh', 'skipped', 'ahead']);
export const KINDS = Object.freeze(['island', 'place', 'fort', 'hut', 'cove']);

/* The rows of ground an island body can fill (render.mjs's island glyph). */
export const FILL_LEVELS = 5;

/* A short name for a pad-sized label: the first word, up to 4 characters. */
export function shortOf(label) {
  const word = String(label || '').trim().split(/\s+/)[0] || '';
  return word.slice(0, 4);
}

/*
 * A place with every field present and in range, so the renderer and the LEDs
 * never have to guard. Unknown states and kinds fall back to fresh and place.
 */
export function makePlace(p = {}) {
  const percent = Number.isFinite(p.percent) ? Math.min(100, Math.max(0, Math.round(p.percent))) : 0;
  const due = Number.isFinite(p.due) ? Math.max(0, Math.floor(p.due)) : 0;
  const label = p.label == null ? '' : String(p.label);
  return {
    id: p.id == null ? '' : String(p.id),
    label,
    short: p.short == null ? shortOf(label) : String(p.short),
    percent,
    state: STATES.includes(p.state) ? p.state : 'fresh',
    due,
    kind: KINDS.includes(p.kind) ? p.kind : 'place',
  };
}

/*
 * How many of `levels` rows of ground a percentage fills. Rounded up, so any
 * progress shows at least one row and 20, 40 and 60% each show one more on a
 * body of 4 or 5 rows; only 100% shows them all, so "begun" and "finished" never
 * round away.
 */
export function fillLevel(percent, levels = FILL_LEVELS) {
  if (!(percent > 0)) return 0;
  if (percent >= 100) return levels;
  return Math.min(levels - 1, Math.max(1, Math.ceil((percent / 100) * levels - 1e-9)));
}

/* The places that still ask for a visit: reviews due, summed over the map. */
export function dueTotal(places) {
  let n = 0;
  for (let i = 0; i < places.length; i++) n += places[i].due || 0;
  return n;
}
