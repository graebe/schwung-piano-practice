// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * scenes.mjs — the scene player: a short queue of moments on the Learning
 * Path, played one after another on their own screen. Pure: time is passed in.
 *
 *   { kind, say, ...what it shows }
 *
 *   walk       the avatar walks a map from one place to another
 *              (scene.map, scene.from, scene.to; the walk is made at start)
 *   celebrate  a place is done: its flag rises; `fireworks` for a stage
 *   zoom       into an island from the world (`dir: 'in'`), or out of one
 *   star       a burst round the result's big score (`over: 'result'`)
 *   finale     the whole Learning Path done: every flag, fireworks over all
 *
 * A player holds the queue and what to do after it (`then`). Every scene
 * runs for its time, or for a walk until the avatar arrives; any key skips
 * the rest of the queue and runs `then` at once, so a scene never stands
 * between the learner and what comes next. What a scene looks like is
 * view.mjs's (drawScene), what it says the session's (announce).
 */

import { createWalk, walkTo, walkDuration, STORY_MS_PER_CELL } from './pathmap/walk.mjs';
import { FLAG_MS, FIREWORKS_MS, ZOOM_MS, STAR_MS, FINALE_MS } from './pathmap/anim.mjs';

export const WALK = 'walk';
export const CELEBRATE = 'celebrate';
export const ZOOM = 'zoom';
export const STAR = 'star';
export const FINALE = 'finale';
export const KINDS = Object.freeze([WALK, CELEBRATE, ZOOM, STAR, FINALE]);

/*
 * How long each kind runs, in ms: the engine's own lengths (pathmap/anim.mjs).
 * A celebration is the flag going up, then for a stage its fireworks. A walk
 * runs at the story pace (STORY_MS_PER_CELL, slower than the jog's, so the
 * way can be followed) until the avatar arrives, then holds a moment so the
 * place it reached is seen.
 */
export const SCENE_MS = Object.freeze({
  [CELEBRATE]: FLAG_MS,
  fireworks: FLAG_MS + FIREWORKS_MS,
  [ZOOM]: ZOOM_MS,
  [STAR]: STAR_MS,
  [FINALE]: FINALE_MS,
});
export const WALK_HOLD_MS = 250;

export function createPlayer() {
  return { queue: [], current: null, then: null };
}

export const playing = (p) => Boolean(p && p.current);

/* How long a scene that is not a walk runs. */
export function sceneMs(scene) {
  if (scene.ms) return scene.ms;
  if (scene.kind === CELEBRATE && scene.fireworks) return SCENE_MS.fireworks;
  return SCENE_MS[scene.kind] || 0;
}

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

/*
 * Play `scenes`, then call `then`. An empty list calls `then` at once and
 * returns null; otherwise the first scene, now playing.
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

/* Whether `scene` has run its course at `t`. */
export function sceneOver(scene, t) {
  return t - scene.t0 >= runMs(scene);
}

/* A walk's time: the engine's own, for the cells between, and the hold. */
function runMs(scene) {
  if (scene.kind !== WALK) return sceneMs(scene);
  return walkDuration(Math.abs(scene.walk.to - scene.walk.from), STORY_MS_PER_CELL) + WALK_HOLD_MS;
}

/* 0..1, for a renderer that draws by progress (the web page). */
export function sceneProgress(scene, t) {
  const ms = runMs(scene);
  return ms ? Math.max(0, Math.min(1, (t - scene.t0) / ms)) : 1;
}

function finish(p) {
  const then = p.then;
  p.queue = [];
  p.current = null;
  p.then = null;
  if (then) then();
}

/*
 * The clock moved to `t`: the next scene when this one is over, and `then`
 * after the last. Returns the scene now playing (a new one when it changed),
 * or null once the queue is done.
 */
export function stepScenes(p, t) {
  while (p.current && sceneOver(p.current, t)) {
    if (!p.queue.length) {
      finish(p);
      return null;
    }
    /* The next starts when this one ended, not when a frame noticed: the
     * timing holds however late the frames come. */
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
