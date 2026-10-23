// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * scenes.mjs — the scene player: a short queue of moments on the Learning
 * Path, played one after another, and what a step changed on the path to
 * play them for. Pure: time is passed in.
 *
 * A scene is { kind, say, ... }; the player needs only what times it:
 *
 *   walk       { map: { layout }, from, to }   the avatar from place to place,
 *              at the story's pace, until it arrives, then a moment's hold
 *   celebrate  { big }      a place's flag rising; with fireworks after when big
 *   zoom, star, finale, banner                 the engine's lengths (ANIMS)
 *
 * Everything else on a scene (its maps, its words, how it is drawn, its
 * pads) is the module's. A scene may set its own length (`ms`).
 *
 * The player holds the queue and what to do after it (`then`). Each scene
 * starts when the one before it ended, not when a frame noticed, so the
 * timing holds however late the frames come; `then` runs once, after the
 * last. Any key skips the rest and runs `then` at once.
 *
 *   createPlayer() -> p
 *   startScenes(p, scenes, then, t) -> the first scene, or null (then ran)
 *   stepScenes(p, t)  -> the scene playing at t, or null once it is all done
 *   skipScenes(p)     -> true when it skipped something
 *   sceneProgress(scene, t) -> 0..1, for a page that draws by progress
 *
 * What a step changed (changes) compares two snapshots of the path, which
 * the module takes before and after recording a take:
 *
 *   { stages: { [stageKey]: { done, places: [ids of done places] } }, all }
 *
 * and returns what became done: { places: [ids], stages: [keys], all }.
 *
 * Pure: imports only its siblings. Vendored byte for byte into Drums Practice.
 */

import { createWalk, walkTo, walkDuration, STORY_MS_PER_CELL } from './walk.mjs';
import { ANIMS } from './anim.mjs';

export const WALK = 'walk';
export const CELEBRATE = 'celebrate';
export const ZOOM = 'zoom';
export const STAR = 'star';
export const FINALE = 'finale';
export const BANNER = 'banner';
export const KINDS = Object.freeze([WALK, CELEBRATE, ZOOM, STAR, FINALE, BANNER]);

/* How long each kind plays, from the engine's frames; fireworks follow a big
 * celebration's flag. */
export const SCENE_MS = Object.freeze({
  [CELEBRATE]: ANIMS.flag.ms,
  fireworks: ANIMS.fireworks.ms,
  [ZOOM]: ANIMS.zoomIn.ms,
  [STAR]: ANIMS.star.ms,
  [FINALE]: ANIMS.finale.ms,
  [BANNER]: ANIMS.banner.ms,
});
/* A walk holds on the place it reached, so the place is seen. */
export const WALK_HOLD_MS = 250;

/* How long a scene that is not a walk plays. */
export function sceneMs(scene) {
  if (scene.ms) return scene.ms;
  if (scene.kind === CELEBRATE) return SCENE_MS.celebrate + (scene.big ? SCENE_MS.fireworks : 0);
  return SCENE_MS[scene.kind] || 0;
}

/* How long a scene plays, all told: a walk until its avatar arrives, at the
 * story's pace, and the hold. */
export function runMs(scene) {
  if (scene.kind !== WALK) return sceneMs(scene);
  const w = scene.walk;
  return walkDuration(Math.abs(w.to - w.from), w.ms || STORY_MS_PER_CELL) + WALK_HOLD_MS;
}

/* ---- The player ---------------------------------------------------------- */

export function createPlayer() {
  return { queue: [], current: null, then: null };
}

export const playing = (p) => Boolean(p && p.current);

/* A scene on stage at `t`: its clock starts, and a walk sets off. */
function begin(p, scene, t) {
  scene.t0 = t;
  if (scene.kind === WALK) {
    scene.walk = createWalk(scene.map.layout, scene.from, { msPerCell: STORY_MS_PER_CELL });
    walkTo(scene.walk, scene.to, t);
  }
  p.current = scene;
  return scene;
}

function finish(p) {
  const then = p.then;
  p.queue = [];
  p.current = null;
  p.then = null;
  if (then) then();
}

/*
 * Play `scenes` from `t`, then call `then`. An empty list calls `then` at
 * once and returns null; otherwise the first scene, now playing.
 */
export function startScenes(p, scenes, then, t) {
  p.queue = scenes.slice(1);
  p.then = then || null;
  p.current = null;
  if (!scenes.length) {
    finish(p);
    return null;
  }
  return begin(p, scenes[0], t);
}

/* Whether `scene` has played its course at `t`. */
export function sceneOver(scene, t) {
  return t - scene.t0 >= runMs(scene);
}

/* 0..1 of the way through `scene` at `t`. */
export function sceneProgress(scene, t) {
  const ms = runMs(scene);
  return ms ? Math.max(0, Math.min(1, (t - scene.t0) / ms)) : 1;
}

/*
 * The clock moved to `t`: the next scene when this one is over, and `then`
 * after the last. Returns the scene playing now (a new one when it changed),
 * or null once the queue is done.
 */
export function stepScenes(p, t) {
  while (p.current && sceneOver(p.current, t)) {
    if (!p.queue.length) {
      finish(p);
      return null;
    }
    begin(p, p.queue.shift(), p.current.t0 + runMs(p.current));
  }
  return p.current;
}

/* Any key: the rest of the queue goes, and `then` runs now. */
export function skipScenes(p) {
  if (!p.current) return false;
  finish(p);
  return true;
}

/* ---- What a step changed ------------------------------------------------- */

/* What became done between two snapshots: { places, stages, all }. */
export function changes(before, after) {
  const out = { places: [], stages: [], all: false };
  if (!before || !after) return out;
  for (const key of Object.keys(after.stages)) {
    const was = before.stages[key] || { done: false, places: [] };
    const now = after.stages[key];
    if (now.done && !was.done) out.stages.push(key);
    for (const id of now.places) if (!was.places.includes(id)) out.places.push(id);
  }
  out.all = Boolean(after.all && !before.all);
  return out;
}
