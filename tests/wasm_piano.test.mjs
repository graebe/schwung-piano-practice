// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * wasm_piano.test.mjs — the browser's piano is the Move's piano.
 *
 * Drives build/wasm/piano.wasm through its raw exports, exactly as the
 * AudioWorklet does, and holds it to two things: that it behaves like an
 * instrument (sounds, decays, releases, panics, keeps its pitch at 48k), and
 * that at 44100 it renders the golden scenario sample for sample — the same
 * file dsp/piano-engine/tests/golden.rs holds the native engine to. Then
 * that the recorded piano and claves (samples/*.nisp) load the way the
 * worklet loads them, and that a broken pack is refused.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const WASM = ROOT + 'build/wasm/piano.wasm';
const ENGINE_TESTS = ROOT + 'dsp/piano-engine/tests/';
const QUANTUM = 128;
const PACKS = ROOT + 'samples/';

if (!existsSync(WASM)) {
  execFileSync('sh', [ROOT + 'scripts/build-wasm.sh'], { stdio: 'inherit' });
}
const MODULE = new WebAssembly.Module(readFileSync(WASM));

/* One fresh instance per test: the engine is module-global state. */
function piano(rate = 44100) {
  const x = new WebAssembly.Instance(MODULE, {}).exports;
  assert.equal(x.pp_init(rate), 1, `pp_init(${rate})`);
  const enc = new TextEncoder();
  return {
    x,
    notes(list) {
      const bytes = enc.encode(list);
      new Uint8Array(x.memory.buffer, x.pp_buf_ptr(), x.pp_buf_cap()).set(bytes);
      x.pp_notes(bytes.length);
    },
    /* A pack into linear memory and onto the engine, as the worklet does. */
    pack(bytes, kind) {
      const at = x.pp_pack_alloc(bytes.length);
      if (at === 0) return 0;
      new Uint8Array(x.memory.buffer, at, bytes.length).set(bytes);
      return x.pp_pack_commit(kind);
    },
    /* `frames` frames as 128-frame quanta, the worklet's way. */
    render(frames) {
      const out = new Float32Array(frames);
      for (let at = 0; at < frames; at += QUANTUM) {
        const n = x.pp_render(Math.min(QUANTUM, frames - at));
        out.set(new Float32Array(x.memory.buffer, x.pp_out_ptr(), n), at);
      }
      return out;
    },
  };
}

const peak = (s) => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const energy = (s) => s.reduce((e, v) => e + v * v, 0) / s.length;

test('the module is the raw ABI and nothing else', () => {
  const names = WebAssembly.Module.exports(MODULE).map((e) => e.name).sort();
  assert.deepEqual(names, [
    'memory', 'pp_buf_cap', 'pp_buf_ptr', 'pp_gain', 'pp_init', 'pp_notes',
    'pp_out_cap', 'pp_out_ptr', 'pp_pack_alloc', 'pp_pack_commit', 'pp_panic', 'pp_release_all',
    'pp_render', 'pp_source', 'pp_voices',
  ]);
  assert.deepEqual(WebAssembly.Module.imports(MODULE), [], 'needs no host imports');
});

test('refuses to run before init, and refuses a nonsense rate', () => {
  const x = new WebAssembly.Instance(MODULE, {}).exports;
  assert.equal(x.pp_render(QUANTUM), 0);
  assert.equal(x.pp_init(0), 0);
  assert.equal(x.pp_init(Number.NaN), 0);
  assert.equal(x.pp_init(1e7), 0);
  assert.equal(x.pp_render(QUANTUM), 0, 'a refused init leaves nothing running');
});

test('silent before any note', () => {
  const p = piano();
  assert.equal(peak(p.render(4096)), 0);
});

test('a note sounds, then decays', () => {
  const p = piano();
  p.notes('60:100');
  const onset = peak(p.render(4096));
  assert.ok(onset > 0.05, `audible: ${onset}`);
  assert.ok(onset <= 1);
  assert.equal(p.x.pp_voices(), 1);
  p.render(44100);
  const later = peak(p.render(4096));
  assert.ok(later < onset * 0.8, `decays: ${later} against ${onset}`);
});

test('a chord in one notes write sounds every note', () => {
  const one = piano();
  one.notes('60:100');
  const e1 = energy(one.render(8192));

  const chord = piano();
  chord.notes('48:100,60:100,64:100,67:100');
  const e4 = energy(chord.render(8192));
  assert.equal(chord.x.pp_voices(), 4, 'one voice per note');
  assert.ok(e4 > 2 * e1, `four notes carry more energy than one: ${e4} vs ${e1}`);
});

test('panic silences from the very next quantum', () => {
  const p = piano();
  p.notes('48:127,60:127,72:127');
  p.render(2048);
  p.x.pp_panic();
  assert.equal(peak(p.render(QUANTUM)), 0);
  assert.equal(p.x.pp_voices(), 0);
});

test('release_all rings out rather than cutting', () => {
  const p = piano();
  p.notes('48:127,60:127');
  p.render(2048);
  p.x.pp_release_all();
  assert.ok(peak(p.render(QUANTUM)) > 0, 'still sounding straight after');
  p.render(44100);
  assert.equal(p.x.pp_voices(), 0, 'and gone within a second');
});

test('gain is held to 0..1', () => {
  const p = piano();
  assert.equal(p.x.pp_gain(1.5), 0);
  assert.equal(p.x.pp_gain(-1), 0);
  assert.equal(p.x.pp_gain(0), 1);
  p.notes('60:127');
  assert.equal(peak(p.render(2048)), 0);
});

test('at 48000 the pitch is still the pitch', () => {
  /* Rising zero crossings of A4 over a third of a second. */
  const hz = (rate) => {
    const p = piano(rate);
    p.notes('69:100');
    const s = p.render(16384);
    let first = -1, last = -1, n = 0;
    for (let i = 1; i < s.length; i++) {
      if (s[i - 1] < 0 && s[i] >= 0) {
        if (first < 0) first = i;
        last = i;
        n++;
      }
    }
    return rate / ((last - first) / (n - 1));
  };
  const a = hz(44100), b = hz(48000);
  assert.ok(Math.abs(a - 440) < 1, `${a} Hz at 44.1k`);
  assert.ok(Math.abs(b - 440) < 1, `${b} Hz at 48k`);
});

test('at 44100 it renders the native engine\'s golden output, bit for bit', () => {
  const script = readFileSync(ENGINE_TESTS + 'golden.txt', 'utf8');
  const want = new Float32Array(new Uint8Array(readFileSync(ENGINE_TESTS + 'golden-44100.f32')).buffer);
  const p = piano(44100);
  const got = [];
  for (const raw of script.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [op, arg = ''] = line.split(/ (.*)/s);
    if (op === 'n') p.notes(arg);
    else if (op === 'g') assert.equal(p.x.pp_gain(Number(arg)), 1);
    else if (op === 'p') p.x.pp_panic();
    else if (op === 'a') p.x.pp_release_all();
    else if (op === 'r') got.push(...p.render(Number(arg)));
    else assert.fail(`unknown step: ${line}`);
  }
  assert.equal(got.length, want.length, 'golden length');
  const first = got.findIndex((v, i) => !Object.is(v, want[i]));
  assert.equal(first, -1, `first differing sample at ${first}: ${got[first]} vs ${want[first]}`);
});

/* ---- the AudioWorklet that hosts it in the browser ---------------------- */

async function loadWorklet(rate) {
  let Processor = null;
  globalThis.sampleRate = rate;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.port = { onmessage: null, sent: [], postMessage(m) { this.sent.push(m); } };
    }
  };
  globalThis.registerProcessor = (name, cls) => {
    assert.equal(name, 'ni-piano');
    Processor = cls;
  };
  await import(new URL('../web/src/audio/piano-worklet.js', import.meta.url) + `?rate=${rate}`);
  return Processor;
}

test('the worklet renders the engine to both channels, driven by port messages', async () => {
  const Processor = await loadWorklet(44100);
  const proc = new Processor({ processorOptions: { wasm: readFileSync(WASM) } });
  assert.deepEqual(proc.port.sent, [{ type: 'ready', sampleRate: 44100 }]);
  const send = (data) => proc.port.onmessage({ data });

  const quantum = () => {
    const out = [[new Float32Array(QUANTUM), new Float32Array(QUANTUM)]];
    assert.equal(proc.process([], out), true);
    return out[0];
  };

  send({ type: 'gain', value: 0.5 });
  send({ type: 'notes', list: '60:100,64:90,ü:3' });
  const ref = piano(44100);
  ref.x.pp_gain(0.5);
  ref.notes('60:100,64:90,?:3');
  for (let q = 0; q < 8; q++) {
    const [l, r] = quantum();
    const want = ref.render(QUANTUM);
    assert.deepEqual(l, want, `left, quantum ${q}`);
    assert.deepEqual(r, want, `right, quantum ${q}`);
  }

  send({ type: 'releaseAll' });
  assert.ok(peak(quantum()[0]) > 0, 'a release rings out');
  send({ type: 'panic' });
  assert.equal(peak(quantum()[0]), 0, 'a panic cuts');
  send({ type: 'nonsense' });
  send(null);
  quantum();
});

test('the worklet reports a module it cannot run, and stays silent', async () => {
  const Processor = await loadWorklet(48000);
  const proc = new Processor({ processorOptions: { wasm: new Uint8Array([0, 1, 2, 3]) } });
  assert.equal(proc.port.sent.length, 1);
  assert.equal(proc.port.sent[0].type, 'error');
  proc.port.onmessage({ data: { type: 'notes', list: '60:100' } });
  const out = [[new Float32Array(QUANTUM)]];
  assert.equal(proc.process([], out), true);
  assert.equal(peak(out[0][0]), 0);
});

test('the recorded piano loads, plays and outlives a new engine', () => {
  const p = piano();
  assert.equal(p.x.pp_source(), 0, 'the synth until a pack arrives');
  assert.equal(p.pack(readFileSync(PACKS + 'piano.nisp'), 0), 1);
  assert.equal(p.x.pp_source(), 1);
  p.notes('60:100,64:100,67:100');
  assert.ok(peak(p.render(4096)) > 0.05);
  assert.equal(p.x.pp_voices(), 3);
  assert.equal(p.x.pp_init(48000), 1);
  assert.equal(p.x.pp_source(), 1, 'a new engine keeps the committed pack');
  p.notes('72:100');
  assert.ok(peak(p.render(4096)) > 0.01, 'and plays it at 48k');
});

test('the claves click, louder on the downbeat, and are not piano voices', () => {
  const p = piano();
  assert.equal(p.pack(readFileSync(PACKS + 'click.nisp'), 1), 1);
  p.notes('c:1');
  const down = energy(p.render(4096));
  assert.equal(p.x.pp_voices(), 0);
  p.render(44100);
  p.notes('c:0');
  const beat = energy(p.render(4096));
  assert.ok(beat > 0 && down > beat, `downbeat ${down} against beat ${beat}`);
});

test('a broken pack is refused and the synth plays on', () => {
  const p = piano();
  assert.equal(p.pack(new TextEncoder().encode('NISP but not really'), 0), 0);
  assert.equal(p.x.pp_source(), 0);
  assert.equal(p.x.pp_pack_commit(0), 0, 'nothing pending: nothing to commit');
  assert.equal(p.x.pp_pack_alloc(0), 0, 'an empty pack has no room');
  assert.equal(p.pack(readFileSync(PACKS + 'click.nisp'), 7), 0, 'an unknown kind');
  p.notes('60:100');
  assert.ok(peak(p.render(4096)) > 0.05);
});
