// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * remote.test.mjs — the pace ui.js keeps with a browser page (src/remote.mjs).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRemote, parseInbox, POLL_IDLE_MS, POLL_WATCHED_MS, PUBLISH_MIN_MS, HEARTBEAT_MS, STALE_EVERY_MS,
} from '../src/remote.mjs';
import { STATE_LIMIT } from '../src/view_model.mjs';

function rig({ inbox = '-', accept = true } = {}) {
  const writes = [];
  const reads = [];
  const r = {
    inbox,
    accept,
    picture: { screen: '"menu"', clock: JSON.stringify({ beats: 0, bpm: 90, paused: false }) },
  };
  r.remote = createRemote({
    get: (k) => { reads.push(k); return r.inbox; },
    set: (k, v) => { if (r.accept) writes.push([k, v]); return r.accept; },
    snapshot: () => ({ ...r.picture }),
  });
  r.writes = writes;
  r.reads = reads;
  return r;
}

test('the inbox: the watch flag, then whole actions; junk is skipped', () => {
  assert.deepEqual(parseInbox(null), { watched: false, actions: [] });
  assert.deepEqual(parseInbox(''), { watched: false, actions: [] });
  assert.deepEqual(parseInbox('-'), { watched: false, actions: [] });
  assert.deepEqual(parseInbox('w\n{"type":"open"}\n{bad\n42\n{"type":7}\n{"type":"back"}'), {
    watched: true, actions: [{ type: 'open' }, { type: 'back' }],
  });
});

test('reads are paced: once a second unwatched, five a second watched', () => {
  const r = rig();
  assert.deepEqual(r.remote.poll(0), []);
  r.remote.poll(POLL_IDLE_MS - 1);
  assert.equal(r.reads.length, 1);
  r.inbox = 'w\n{"type":"open"}';
  assert.deepEqual(r.remote.poll(POLL_IDLE_MS), [{ type: 'open' }]);
  assert.equal(r.remote.watched, true);
  r.remote.poll(POLL_IDLE_MS + POLL_WATCHED_MS - 1);
  r.remote.poll(POLL_IDLE_MS + POLL_WATCHED_MS);
  assert.equal(r.reads.length, 3);
});

test('unwatched: no picture, only a nudge every couple of seconds', () => {
  const r = rig();
  r.remote.poll(0);
  assert.equal(r.remote.publish(0, false), true);
  assert.equal(r.remote.publish(STALE_EVERY_MS - 1, false), false);
  assert.equal(r.remote.publish(STALE_EVERY_MS, false), true);
  assert.deepEqual(r.writes, [['stale', '1'], ['stale', '1']]);
});

test('watched: a change goes out, no faster than the manager reads it', () => {
  const r = rig({ inbox: 'w' });
  r.remote.poll(0);
  assert.equal(r.remote.publish(0, false), true);
  assert.equal(JSON.parse(r.writes[0][1]).screen, '"menu"');
  r.picture.screen = '"ready"';
  assert.equal(r.remote.publish(PUBLISH_MIN_MS - 1, false), false, 'too soon');
  assert.equal(r.remote.publish(PUBLISH_MIN_MS, false), true);
  assert.equal(r.remote.publish(PUBLISH_MIN_MS * 2, false), false, 'nothing new');
});

test('the playhead alone waits for the heartbeat; a pause does not', () => {
  const r = rig({ inbox: 'w' });
  r.remote.poll(0);
  r.remote.publish(0, false);
  r.picture.clock = JSON.stringify({ beats: 3.5, bpm: 90, paused: false, bar: 1, beat: 3, beatFlash: true });
  assert.equal(r.remote.publish(500, false), false, 'the page carries the beat itself');
  assert.equal(r.remote.publish(HEARTBEAT_MS, false), true, 'the heartbeat keeps the watch alive');
  r.picture.clock = JSON.stringify({ beats: 4, bpm: 90, paused: true });
  assert.equal(r.remote.publish(HEARTBEAT_MS + PUBLISH_MIN_MS, false), true);
});

test('one write a tick, and a refused write is tried again', () => {
  const r = rig({ inbox: 'w', accept: false });
  r.remote.poll(0);
  assert.equal(r.remote.publish(0, true), false, 'the notes went this tick');
  assert.equal(r.remote.publish(0, false), false, 'the slot was busy');
  r.accept = true;
  assert.equal(r.remote.publish(2, false), true, 'next tick, not next heartbeat');
});

test('a picture the manager could not read whole is never sent', () => {
  const r = rig({ inbox: 'w' });
  r.picture.chart = '"' + 'x'.repeat(STATE_LIMIT) + '"';
  r.remote.poll(0);
  assert.equal(r.remote.publish(0, false), false);
  assert.deepEqual(r.writes, []);
});
