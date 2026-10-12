// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * piano-worklet.js — the Move's piano engine, on the browser's audio thread.
 *
 * The processor instantiates build/wasm/piano.wasm (piano-engine compiled for
 * wasm32, see dsp/piano-wasm) from bytes handed over in processorOptions.wasm,
 * synchronously — an AudioWorkletGlobalScope has no fetch, and compiling here
 * means nothing can reach the engine before it exists. It then renders every
 * 128-frame quantum through pp_render and copies the mono result to each
 * output channel.
 *
 * Messages on the port:
 *   { type: 'notes', list: '60:100,64:0' }  the device's `n` list, verbatim
 *   { type: 'panic' }                       cut every voice now
 *   { type: 'releaseAll' }                  let every voice ring out
 *   { type: 'gain', value: 0.22 }           0..1, anything else ignored
 * Messages that arrive before the engine is ready are queued and applied in
 * order once it is. It answers { type: 'ready' } or { type: 'error', message }.
 *
 * No allocation on the render path: the output view is created once and only
 * again if the wasm memory is replaced (which a growth would do).
 */

/* Enough to hold a burst sent while the engine is still coming up; beyond it
 * something is wrong and holding more would only grow without bound. */
const MAX_QUEUED = 256;

class PianoProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.x = null;
    this.queue = [];
    this.view = null;
    this.port.onmessage = (e) => this.receive(e.data);
    try {
      const bytes = options && options.processorOptions && options.processorOptions.wasm;
      const x = new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports;
      if (x.pp_init(sampleRate) !== 1) throw new Error(`the engine refused ${sampleRate} Hz`);
      this.x = x;
      for (const m of this.queue.splice(0)) this.apply(m);
      this.port.postMessage({ type: 'ready', sampleRate });
    } catch (err) {
      this.queue.length = 0;
      this.port.postMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
    }
  }

  receive(msg) {
    if (this.x) this.apply(msg);
    else if (this.queue.length < MAX_QUEUED) this.queue.push(msg);
  }

  apply(msg) {
    const x = this.x;
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'notes':
        if (typeof msg.list === 'string') this.notes(msg.list);
        break;
      case 'panic':
        x.pp_panic();
        break;
      case 'releaseAll':
        x.pp_release_all();
        break;
      case 'gain':
        if (typeof msg.value === 'number') x.pp_gain(msg.value);
        break;
      default:
        break;
    }
  }

  /* ASCII into the engine's note buffer. A character outside ASCII becomes
   * '?', which spoils only its own entry — as its UTF-8 bytes would on the
   * device. Longer than the buffer is truncated, as the device truncates. */
  notes(list) {
    const x = this.x;
    const cap = x.pp_buf_cap();
    const len = Math.min(list.length, cap);
    const buf = new Uint8Array(x.memory.buffer, x.pp_buf_ptr(), cap);
    for (let i = 0; i < len; i++) {
      const c = list.charCodeAt(i);
      buf[i] = c < 0x80 ? c : 0x3f;
    }
    x.pp_notes(len);
  }

  process(_inputs, outputs) {
    const x = this.x;
    const out = outputs[0];
    if (!x || !out || out.length === 0) return true;
    const frames = out[0].length;
    const n = x.pp_render(frames);
    if (n !== frames) return true;
    if (!this.view || this.view.buffer !== x.memory.buffer || this.view.length !== frames) {
      this.view = new Float32Array(x.memory.buffer, x.pp_out_ptr(), frames);
    }
    for (const channel of out) channel.set(this.view);
    return true;
  }
}

registerProcessor('ni-piano', PianoProcessor);
