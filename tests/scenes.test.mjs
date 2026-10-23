// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * scenes.test.mjs — the scene player: a queue played in order, each scene
 * for its time (a walk until it arrives), `then` once at the end, and any
 * key skipping straight there.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as SC from '../src/scenes.mjs';
import { layoutPlaces } from '../src/pathmap/layout.mjs';
import { walkDuration, STORY_MS_PER_CELL } from '../src/pathmap/walk.mjs';
import { BANNER_MS } from '../src/pathmap/anim.mjs';

const map = { layout: layoutPlaces(5) };

test('scenes play in order, each for its time, then `then` runs once', () => {
  const p = SC.createPlayer();
  const log = [];
  const first = SC.startScenes(p, [
    { kind: SC.CELEBRATE, say: 'a' },
    { kind: SC.ZOOM, dir: 'out', say: 'b' },
    { kind: SC.FINALE, say: 'c' },
  ], () => log.push('then'), 1000);
  assert.equal(first.say, 'a');
  assert.ok(SC.playing(p));
  assert.equal(SC.stepScenes(p, 1000 + SC.SCENE_MS.celebrate - 1).say, 'a', 'still the flag');
  assert.equal(SC.stepScenes(p, 1000 + SC.SCENE_MS.celebrate).say, 'b');
  const t1 = p.current.t0;
  assert.equal(SC.sceneProgress(p.current, t1 + SC.SCENE_MS.zoom / 2), 0.5);
  assert.equal(SC.stepScenes(p, t1 + SC.SCENE_MS.zoom).say, 'c');
  assert.deepEqual(log, []);
  assert.equal(SC.stepScenes(p, t1 + 10000), null);
  assert.deepEqual(log, ['then']);
  assert.equal(SC.stepScenes(p, t1 + 20000), null, 'nothing left');
  assert.deepEqual(log, ['then'], 'once');
  assert.ok(!SC.playing(p));
});

test('a frame that comes late runs through every scene it passed, in one step', () => {
  const p = SC.createPlayer();
  let done = 0;
  SC.startScenes(p, [{ kind: SC.ZOOM }, { kind: SC.ZOOM }], () => done++, 0);
  assert.equal(SC.stepScenes(p, 5000), null);
  assert.equal(done, 1);
});

test('a celebration with fireworks runs longer than a flag', () => {
  assert.ok(SC.sceneMs({ kind: SC.CELEBRATE, fireworks: true }) > SC.sceneMs({ kind: SC.CELEBRATE }));
  assert.equal(SC.sceneMs({ kind: SC.STAR, ms: 42 }), 42, 'a scene may set its own time');
  assert.equal(SC.sceneMs({ kind: SC.BANNER }), BANNER_MS, 'a banner runs the engine\'s length');
  assert.equal(SC.sceneMs({ kind: 'nope' }), 0);
});

test('a walk sets off when it starts, and lasts until the avatar arrives and is seen there', () => {
  const p = SC.createPlayer();
  SC.startScenes(p, [{ kind: SC.CELEBRATE }, { kind: SC.WALK, map, from: 0, to: 3 }], null, 0);
  assert.equal(p.queue[0].walk, undefined, 'not before its turn');
  const walk = SC.stepScenes(p, SC.SCENE_MS.celebrate);
  assert.equal(walk.kind, SC.WALK);
  assert.equal(walk.walk.target, 3);
  const ms = walkDuration(Math.abs(walk.walk.to - walk.walk.from), STORY_MS_PER_CELL) + SC.WALK_HOLD_MS;
  assert.ok(SC.stepScenes(p, walk.t0 + ms - 1), 'still walking');
  assert.equal(SC.stepScenes(p, walk.t0 + ms), null);
  assert.equal(SC.sceneProgress(walk, walk.t0 + ms), 1);
});

test('any key skips the rest and runs `then` at once; with nothing playing it does nothing', () => {
  const p = SC.createPlayer();
  const log = [];
  SC.startScenes(p, [{ kind: SC.ZOOM }, { kind: SC.FINALE }], () => log.push('then'), 0);
  assert.equal(SC.skipScenes(p), true);
  assert.deepEqual(log, ['then']);
  assert.ok(!SC.playing(p));
  assert.equal(SC.skipScenes(p), false);
  assert.deepEqual(log, ['then']);
});

test('no scenes: `then` at once, and nothing plays', () => {
  const p = SC.createPlayer();
  let done = 0;
  assert.equal(SC.startScenes(p, [], () => done++, 0), null);
  assert.equal(done, 1);
  assert.ok(!SC.playing(p));
  assert.equal(SC.startScenes(SC.createPlayer(), [], null, 0), null, 'and no `then` is fine');
});
