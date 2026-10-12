// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * engine.js — the browser's piano, behind five calls.
 *
 *   const piano = createPianoEngine({ wasmUrl, workletUrl });
 *   button.onclick = () => piano.resume();   // from a user gesture
 *   piano.strike(60, 100); piano.release(60);
 *
 * Underneath: an AudioContext, an AudioWorkletNode running piano-worklet.js,
 * and in it the Move's own piano engine compiled to wasm. Strikes and releases
 * made in one task go to the worklet as ONE `n` list, as the device's UI sends
 * one parameter write per tick, so a chord starts in a single quantum.
 *
 * Browsers only start audio from a user gesture, so nothing is created until
 * resume() is called from one. Where the page cannot have an AudioWorklet at
 * all (not a secure context, or an old browser) the engine is a shell that
 * reports 'unavailable' and ignores every call, so the app never has to branch.
 *
 * state: 'unavailable' | 'idle' | 'loading' | 'running' | 'suspended'
 *        | 'error' | 'closed'
 */
import { createNoteBatch } from './note-batch.js';

export const PROCESSOR_NAME = 'ni-piano';

function supported(g) {
  return g.isSecureContext === true
    && typeof g.AudioContext === 'function'
    && typeof g.AudioWorkletNode === 'function';
}

export function createPianoEngine({ wasmUrl, workletUrl }) {
  const g = globalThis;
  if (!supported(g)) return unavailableEngine();

  let ctx = null;
  let node = null;
  let starting = null;
  let live = false;
  let failed = false;
  let closed = false;
  let gain = null;

  const batch = createNoteBatch(() => queueMicrotask(flush));

  function post(msg) {
    node.port.postMessage(msg);
  }

  /* Until the node exists the batch keeps what it has; start() flushes it. */
  function flush() {
    if (!node) return;
    const list = batch.take();
    if (list !== null) post({ type: 'notes', list });
  }

  async function start() {
    const bytes = await fetch(wasmUrl).then((r) => {
      if (!r.ok) throw new Error(`${wasmUrl}: HTTP ${r.status}`);
      return r.arrayBuffer();
    });
    await ctx.audioWorklet.addModule(workletUrl);
    if (closed) return;
    const n = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { wasm: bytes },
    });
    const ready = new Promise((resolve, reject) => {
      n.port.onmessage = (e) => {
        if (e.data && e.data.type === 'ready') resolve();
        else if (e.data && e.data.type === 'error') reject(new Error(e.data.message));
      };
    });
    n.connect(ctx.destination);
    node = n;
    if (gain !== null) post({ type: 'gain', value: gain });
    flush();
    await ready;
    live = true;
  }

  return {
    /** Create or wake the audio. Call from a user gesture handler; resolves
     *  to the resulting state. Never rejects — a failure is state 'error'. */
    resume() {
      if (closed || failed) return Promise.resolve(this.state);
      if (!ctx) {
        ctx = new g.AudioContext({ latencyHint: 'interactive' });
        starting = start().catch((err) => {
          failed = true;
          batch.clear();
          console.error('piano engine:', err);
        });
      }
      /* Inside the gesture, before any await: that is what lets it start. */
      const woke = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
      return Promise.all([woke, starting]).then(() => this.state, () => this.state);
    },

    strike(pitch, vel) {
      if (!closed && !failed) batch.strike(pitch, vel);
    },

    release(pitch) {
      if (!closed && !failed) batch.release(pitch);
    },

    /** Cut every voice now, and drop strikes not yet sent. */
    silence() {
      batch.clear();
      if (node) post({ type: 'panic' });
    },

    /** Let every voice ring out, as lifting the hands off the keys does. */
    releaseAll() {
      flush();
      if (node) post({ type: 'releaseAll' });
    },

    /** 0..1; the engine ignores anything else. Remembered across start-up. */
    setGain(value) {
      gain = value;
      if (node) post({ type: 'gain', value });
    },

    async close() {
      if (closed) return;
      closed = true;
      batch.clear();
      if (node) node.disconnect();
      node = null;
      if (ctx && ctx.state !== 'closed') await ctx.close();
    },

    get state() {
      if (closed) return 'closed';
      if (failed) return 'error';
      if (!ctx) return 'idle';
      if (!live) return 'loading';
      return ctx.state === 'running' ? 'running' : 'suspended';
    },
  };
}

function unavailableEngine() {
  const nothing = () => {};
  return {
    resume: () => Promise.resolve('unavailable'),
    strike: nothing,
    release: nothing,
    silence: nothing,
    releaseAll: nothing,
    setGain: nothing,
    close: () => Promise.resolve(),
    get state() {
      return 'unavailable';
    },
  };
}
