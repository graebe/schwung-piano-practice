/*
 * ui_smoke.test.mjs — actually RUN ui.js, with the host stubbed out.
 *
 * Everything else about ui.js is checked by regex, because it talks to globals
 * that only exist inside Schwung. That gap let a refactor delete flashPad and
 * flashPitch — still called from four places — and ship it. `node --check`
 * passed, every other test passed, and the module died on the first pad press
 * with "ReferenceError: 'flashPad' is not defined".
 *
 * A reference error inside an event handler cannot be found by reading the
 * file. It has to be executed. So: stub the host, load the module, and drive
 * every входной path — pads, transport, jog, knobs, every view — asserting
 * only that nothing throws.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname;

/*
 * ui.js imports the shared libraries by their on-device absolute path, which
 * cannot resolve here, so the module is staged with those rewritten to local
 * stubs. Nothing else about it is altered.
 */
function stageModule() {
  const dir = mkdtempSync(join(tmpdir(), 'pp-smoke-'));
  mkdirSync(join(dir, 'shared'));
  writeFileSync(join(dir, 'shared', 'input_filter.mjs'), `
    export function setLED() {}
    export function setButtonLED() {}
    export function invalidateLedCache() {}
    export function decodeDelta(v) { return v > 63 ? -(128 - v) : v; }
  `);
  writeFileSync(join(dir, 'shared', 'screen_reader.mjs'), 'export function announce() {}');
  cpSync(SRC, join(dir, 'src'), { recursive: true });
  const uiPath = join(dir, 'src', 'ui.js');
  writeFileSync(uiPath, readFileSync(uiPath, 'utf8')
    .replace(/'\/data\/UserData\/schwung\/shared\//g, "'../shared/"));
  return { dir, uiPath };
}

function installHostStubs() {
  const calls = { led: 0, midi: 0, writes: [] };
  const noop = () => {};
  Object.assign(globalThis, {
    clear_screen: noop,
    fill_rect: noop,
    draw_rect: noop,
    draw_line: noop,
    print: noop,
    text_width: (s) => String(s).length * 6 - 1,
    host_read_file: () => null,
    host_write_file: (p, t) => { calls.writes.push(p); return true; },
    host_exit_module: noop,
    host_send_screenreader: noop,
    host_module_set_param: () => { calls.midi++; },
    move_midi_inject_to_move: () => { calls.midi++; return true; },
    move_midi_external_send: () => { calls.midi++; return true; },
    move_midi_internal_send: () => { calls.led++; return true; },
    shadow_get_display_mode: () => 0,
  });
  return calls;
}

/* Move hardware numbers, from src/shared/constants.mjs. */
const PAD = 68;
const CC = (n, v) => [0xb0, n, v];
const JOG_TURN = 14, JOG_CLICK = 3, SHIFT = 49, BACK = 51, PLAY = 85, RECORD = 86, MENU = 50;

let mod;
test('the module loads and installs its lifecycle hooks', async () => {
  installHostStubs();
  const { uiPath } = stageModule();
  mod = await import(uiPath);
  for (const hook of ['init', 'tick', 'onMidiMessageInternal', 'onMidiMessageExternal', 'onResume', 'onUnload']) {
    assert.equal(typeof globalThis[hook], 'function', `${hook} missing`);
  }
});

test('init and a tick run without throwing', () => {
  globalThis.init();
  for (let i = 0; i < 5; i++) globalThis.tick();
});

/*
 * The regression this file exists for. A pad press in the menu, in a run, and
 * in each quiz — every path that reaches flashPad, the judgement, the markers
 * and the LED paint.
 */
test('a pad press never throws, in any view', () => {
  const press = () => {
    globalThis.onMidiMessageInternal([0x90, PAD, 100]);
    globalThis.tick();
    globalThis.onMidiMessageInternal([0x80, PAD, 0]);
    globalThis.tick();
  };
  const openRow = (index) => {
    globalThis.init();
    for (let i = 0; i < index; i++) globalThis.onMidiMessageInternal(CC(JOG_TURN, 1));
    globalThis.tick();
    globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127));
    globalThis.tick();
  };

  globalThis.init();
  press();                                   /* in the exercise list */

  for (const row of [0, 1, 2, 3]) {          /* Guess/Hear notes and chords */
    openRow(row);
    press();
    globalThis.onMidiMessageInternal([0x90, PAD + 5, 100]);  /* a wrong one */
    globalThis.tick();
    globalThis.onMidiMessageInternal([0x80, PAD + 5, 0]);
    globalThis.tick();
  }

  openRow(4);                                 /* a scrolling exercise */
  press();
  globalThis.onMidiMessageInternal(CC(RECORD, 127));   /* practice */
  for (let i = 0; i < 20; i++) globalThis.tick();
  press();
  globalThis.onMidiMessageInternal(CC(PLAY, 127));     /* listen */
  for (let i = 0; i < 20; i++) globalThis.tick();
  press();
});

test('every transport and navigation control survives being pressed', () => {
  globalThis.init();
  for (const cc of [PLAY, RECORD, JOG_CLICK, MENU, BACK, SHIFT]) {
    globalThis.onMidiMessageInternal(CC(cc, 127));
    globalThis.tick();
    globalThis.onMidiMessageInternal(CC(cc, 0));
    globalThis.tick();
  }
});

test('the jog and every knob can be turned in every view', () => {
  globalThis.init();
  const turn = () => {
    for (const cc of [JOG_TURN, 71, 72, 73, 74]) {
      globalThis.onMidiMessageInternal(CC(cc, 1));
      globalThis.onMidiMessageInternal(CC(cc, 127));
      globalThis.tick();
    }
  };
  turn();
  globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127));  /* into an exercise */
  globalThis.tick();
  turn();
  /* Shift + click opens settings; every row must be editable without throwing. */
  globalThis.onMidiMessageInternal(CC(SHIFT, 127));
  globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127));
  globalThis.onMidiMessageInternal(CC(SHIFT, 0));
  globalThis.tick();
  for (let row = 0; row < 20; row++) {
    globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127));   /* edit */
    globalThis.onMidiMessageInternal(CC(JOG_TURN, 1));
    globalThis.onMidiMessageInternal(CC(JOG_TURN, 127));
    globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127));   /* done */
    globalThis.onMidiMessageInternal(CC(JOG_TURN, 1));      /* next row */
    globalThis.tick();
  }
});

test('knob touches and stray MIDI are ignored, not crashed on', () => {
  globalThis.init();
  for (const msg of [[0x90, 0, 127], [0x90, 9, 127], [0xa0, PAD, 60], [0xb0, 123, 0], [0xf8]]) {
    globalThis.onMidiMessageInternal(msg);
    globalThis.onMidiMessageExternal(msg);
    globalThis.tick();
  }
  globalThis.onMidiMessageInternal(null);
  globalThis.onMidiMessageInternal([]);
  globalThis.tick();
});

test('a long run ticks thousands of times without throwing', () => {
  globalThis.init();
  globalThis.onMidiMessageInternal(CC(JOG_TURN, 1));
  globalThis.onMidiMessageInternal(CC(JOG_TURN, 1));
  globalThis.onMidiMessageInternal(CC(JOG_TURN, 1));
  globalThis.onMidiMessageInternal(CC(JOG_TURN, 1));
  globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127));
  globalThis.onMidiMessageInternal(CC(RECORD, 127));
  for (let i = 0; i < 3000; i++) {
    if (i % 250 === 0) globalThis.onMidiMessageInternal([0x90, PAD + (i % 8), 90]);
    if (i % 250 === 60) globalThis.onMidiMessageInternal([0x80, PAD + (i % 8), 0]);
    globalThis.tick();
  }
});

test('unloading is clean, and resume does not throw', () => {
  globalThis.onResume();
  globalThis.tick();
  globalThis.onUnload();
});
