// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * engine_batch.test.mjs — what the browser piano sends, and when.
 *
 * The batching is pure (note-batch.js) and tested directly. engine.js is then
 * driven against a stand-in for Web Audio that records what reaches the
 * worklet's port, which is enough to hold it to "one notes message per task"
 * without a browser. The worklet and the wasm themselves are proven in
 * tests/wasm_piano.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNoteBatch, strikeEntry, releaseEntry, clickEntry } from '../src/audio/note-batch.js';
import { createPianoEngine, PROCESSOR_NAME } from '../src/audio/engine.js';

test('entries use the device\'s pitch:velocity syntax', () => {
  assert.equal(strikeEntry(60, 100), '60:100');
  assert.equal(strikeEntry(0, 1), '0:1');
  assert.equal(strikeEntry(127, 127), '127:127');
  assert.equal(releaseEntry(60), '60:0');
});

test('a strike without a velocity is 100, as the device\'s UI sends it', () => {
  assert.equal(strikeEntry(60), '60:100');
  assert.equal(strikeEntry(60, 0), '60:100', 'velocity 0 would be a release');
  assert.equal(strikeEntry(60, Number.NaN), '60:100');
  assert.equal(strikeEntry(60, 300), '60:127');
  assert.equal(strikeEntry(60, -5), '60:1');
  assert.equal(strikeEntry(60, 63.6), '60:64');
});

test('anything that is not a MIDI note is dropped, not sent', () => {
  for (const p of [-1, 128, 60.5, Number.NaN, '60', null, undefined]) {
    assert.equal(strikeEntry(p, 100), null, String(p));
    assert.equal(releaseEntry(p), null, String(p));
  }
  let pending = 0;
  const b = createNoteBatch(() => pending++);
  assert.equal(b.strike(200, 100), false);
  assert.equal(b.size, 0);
  assert.equal(pending, 0, 'nothing to flush, nothing scheduled');
});

test('one task of notes is one list, in the order played', () => {
  let pending = 0;
  const b = createNoteBatch(() => pending++);
  b.strike(60, 90);
  b.strike(64, 80);
  b.strike(67, 70);
  b.release(60);
  b.strike(60, 100);
  assert.equal(pending, 1, 'scheduled once for the whole batch');
  assert.equal(b.take(), '60:90,64:80,67:70,60:0,60:100');
  assert.equal(b.take(), null, 'emptied');
  b.strike(72, 50);
  assert.equal(pending, 2, 'the next batch schedules again');
  assert.equal(b.take(), '72:50');
});

test('clear drops what is pending, and the next note schedules afresh', () => {
  let pending = 0;
  const b = createNoteBatch(() => pending++);
  b.strike(60, 100);
  b.clear();
  assert.equal(b.size, 0);
  assert.equal(b.take(), null);
  b.strike(62, 100);
  assert.equal(pending, 2);
  assert.equal(b.take(), '62:100');
});

test('a metronome tick rides in the list with the notes of its moment', () => {
  assert.equal(clickEntry(true), 'c:1');
  assert.equal(clickEntry(false), 'c:0');
  const b = createNoteBatch(() => {});
  b.strike(60, 90);
  b.click(true);
  b.release(60);
  assert.equal(b.take(), '60:90,c:1,60:0');
});

/* ---- engine.js against a stand-in for Web Audio ------------------------- */

function fakeAudio() {
  const sent = [];
  const env = {
    sent,
    contexts: 0,
    modules: [],
    nodes: [],
  };
  class AudioContext {
    constructor() {
      env.contexts++;
      this.state = 'suspended';
      this.destination = {};
      this.audioWorklet = { addModule: async (url) => env.modules.push(url) };
    }
    async resume() {
      this.state = 'running';
    }
    async close() {
      this.state = 'closed';
    }
  }
  class AudioWorkletNode {
    constructor(ctx, name, options) {
      this.name = name;
      this.options = options;
      this.port = {
        onmessage: null,
        postMessage: (m) => sent.push(m),
      };
      env.nodes.push(this);
      /* The processor answers once constructed. */
      queueMicrotask(() => this.port.onmessage({ data: { type: 'ready' } }));
    }
    connect() {}
    disconnect() {}
  }
  Object.assign(globalThis, {
    isSecureContext: true,
    AudioContext,
    AudioWorkletNode,
    fetch: async (url) => {
      env.fetched = (env.fetched || []).concat(url);
      if (String(url).includes('missing')) return { ok: false, status: 404 };
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    },
  });
  return env;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('the recorded sounds follow the engine, and a missing one leaves the synth', async () => {
  const env = fakeAudio();
  const piano = createPianoEngine({
    wasmUrl: '/piano.wasm', workletUrl: '/w.js',
    packUrls: { piano: '/piano.nisp', click: '/missing.nisp' },
  });
  assert.deepEqual(piano.recorded, { piano: false, click: false });
  piano.click(false);
  assert.equal(await piano.resume(), 'running');
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(env.fetched, ['/piano.wasm', '/piano.nisp', '/missing.nisp'], 'packs only after the engine runs');
  const packs = env.sent.filter((m) => m.type === 'pack');
  assert.equal(packs.length, 1, 'the missing click is not sent');
  assert.equal(packs[0].kind, 0);
  assert.ok(packs[0].bytes instanceof ArrayBuffer);
  assert.deepEqual(env.sent.find((m) => m.type === 'notes'), { type: 'notes', list: 'c:0' });
  env.nodes[0].port.onmessage({ data: { type: 'pack', kind: 0, ok: true } });
  env.nodes[0].port.onmessage({ data: { type: 'pack', kind: 9, ok: true } });
  assert.deepEqual(piano.recorded, { piano: true, click: false });
  await piano.close();
});

test('without a secure context the engine is an inert shell', async () => {
  globalThis.isSecureContext = false;
  const piano = createPianoEngine({ wasmUrl: 'x.wasm', workletUrl: 'w.js' });
  assert.equal(piano.state, 'unavailable');
  assert.equal(await piano.resume(), 'unavailable');
  piano.strike(60, 100);
  piano.release(60);
  piano.click(true);
  piano.silence();
  piano.setGain(0.5);
  assert.deepEqual(piano.recorded, { piano: false, click: false });
  await piano.close();
  assert.equal(piano.state, 'unavailable');
});

test('the engine sends one notes message per task, after it starts', async () => {
  const env = fakeAudio();
  const piano = createPianoEngine({ wasmUrl: '/piano.wasm', workletUrl: '/piano-worklet.js' });
  assert.equal(piano.state, 'idle');
  assert.equal(env.contexts, 0, 'no AudioContext before a gesture');

  piano.setGain(0.5);
  piano.strike(60, 100);                 /* struck before start: held, not lost */
  assert.equal(await piano.resume(), 'running');
  assert.equal(env.contexts, 1);
  assert.deepEqual(env.modules, ['/piano-worklet.js']);
  assert.equal(env.nodes[0].name, PROCESSOR_NAME);
  assert.ok(env.nodes[0].options.processorOptions.wasm instanceof ArrayBuffer);
  assert.deepEqual(env.sent.splice(0), [
    { type: 'gain', value: 0.5 },
    { type: 'notes', list: '60:100' },
  ]);

  piano.strike(48, 90);
  piano.strike(52, 90);
  piano.strike(55, 90);
  piano.release(60);
  assert.deepEqual(env.sent, [], 'nothing until the task ends');
  await tick();
  assert.deepEqual(env.sent.splice(0), [{ type: 'notes', list: '48:90,52:90,55:90,60:0' }]);

  piano.strike(72, 100);
  piano.silence();
  await tick();
  assert.deepEqual(env.sent.splice(0), [{ type: 'panic' }], 'a panic drops the unsent strike');

  piano.strike(40, 100);
  piano.releaseAll();
  assert.deepEqual(env.sent.splice(0), [
    { type: 'notes', list: '40:100' },
    { type: 'releaseAll' },
  ], 'pending notes go first, so the release catches them');

  assert.equal(await piano.resume(), 'running', 'a second resume is harmless');
  assert.equal(env.contexts, 1);

  await piano.close();
  assert.equal(piano.state, 'closed');
  piano.strike(60, 100);
  await tick();
  assert.deepEqual(env.sent, [], 'silent after close');
});
