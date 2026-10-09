// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * ui_trace.test.mjs — what ui.js tells the host, held to a recording.
 *
 * ui_smoke proves nothing throws; ui_contract reads the source. Neither notices
 * a refactor that keeps every function and every regex but changes what the
 * Move actually receives — a note a tick later, an LED a different colour, a
 * settings file written twice. This one does: it drives ui.js through scripted
 * sessions on a frozen clock and records every host call, and the recording is
 * checked in. Moving the state machine out of ui.js must leave it byte for byte
 * the same.
 *
 * WHAT IS RECORDED. Every call that leaves the module, in order: DSP params,
 * MIDI to the track and to USB, file writes (path and text), screen-reader
 * announcements, exit. Drawing and LEDs are the bulk of the traffic and are
 * folded into one digest per tick, so a fixture stays readable and a changed
 * frame still fails the test.
 *
 *   UPDATE_TRACE=1 node --test tests/ui_trace.test.mjs   re-record
 *
 * Re-record only for a change that is MEANT to be visible on the device, and
 * say so in the commit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { padPitch } from '../src/padmap.mjs';

const SRC = new URL('../src/', import.meta.url).pathname;
const FIXTURES = new URL('./fixtures/ui_trace/', import.meta.url).pathname;
const UPDATE = process.env.UPDATE_TRACE === '1';
/* TRACE_SCREEN=1 prints the panel's text whenever it changes: how to see where
 * a scenario actually goes before recording it. */
const SCREEN = process.env.TRACE_SCREEN === '1';

/* ---- The staged module and its host ------------------------------------- */

function stageModule() {
  const dir = mkdtempSync(join(tmpdir(), 'pp-trace-'));
  mkdirSync(join(dir, 'shared'));
  writeFileSync(join(dir, 'shared', 'input_filter.mjs'), `
    export function setLED(n, c) { globalThis.__host.led('led', n, c); }
    export function setButtonLED(n, c) { globalThis.__host.led('btn', n, c); }
    export function invalidateLedCache() { globalThis.__host.led('inv'); }
    export function decodeDelta(v) { return v > 63 ? -(128 - v) : v; }
  `);
  writeFileSync(join(dir, 'shared', 'screen_reader.mjs'),
    'export function announce(t) { globalThis.__host.call("announce", t); }');
  cpSync(SRC, join(dir, 'src'), { recursive: true });
  const uiPath = join(dir, 'src', 'ui.js');
  writeFileSync(uiPath, readFileSync(uiPath, 'utf8')
    .replace(/'\/data\/UserData\/schwung\/shared\//g, "'../shared/"));
  return uiPath;
}

const EPOCH = Date.UTC(2026, 9, 9, 8, 0, 0);   /* a fixed wall clock */

/* A host that writes down everything it is told. Files live in memory, so a
 * scenario can read back what it wrote. */
function makeHost(files) {
  let ms = 0;
  let events = [];
  let tickNo = 0;
  let draw = createHash('sha1');
  let drew = false;
  let leds = createHash('sha1');
  let lit = false;
  let text = [];
  let shown = '';
  const host = {
    now: () => ms,
    advance(n) { ms += n; },
    call(name, ...args) { events.push([name, ...args]); },
    draw(name, args) {
      drew = true;
      draw.update(name + JSON.stringify(args));
      if (name === 'print') text.push(String(args[2]));
    },
    pads: new Map(),
    led(...args) {
      lit = true;
      leds.update(JSON.stringify(args));
      if (args[0] === 'led') host.pads.set(args[1], args[2]);
    },
    endTick() {
      if (drew || lit) {
        events.push(['tick', tickNo,
          drew ? draw.digest('hex').slice(0, 12) : '-',
          lit ? leds.digest('hex').slice(0, 12) : '-']);
      }
      if (drew) {
        const now = text.join(' | ');
        if (SCREEN && now !== shown) console.log(`  [${tickNo} ${ms}ms] ${now}`);
        shown = now;
      }
      text = [];
      draw = createHash('sha1'); leds = createHash('sha1');
      drew = false; lit = false; tickNo++;
    },
    take() { const e = events; events = []; return e; },
    /* The panel's text as last drawn, for a script that must know where it is. */
    screen: () => shown,
  };
  globalThis.__host = host;
  globalThis.performance = { now: () => ms };
  const record = (name) => (...args) => host.draw(name, args);
  Object.assign(globalThis, {
    clear_screen: record('clear'),
    fill_rect: record('fill'),
    draw_rect: record('rect'),
    draw_line: record('line'),
    print: record('print'),
    text_width: (s) => String(s).length * 6 - 1,
    host_read_file: (p) => readHostFile(files, p),
    host_write_file: (p, t) => { files.set(p, t); host.call('write', p, t); return true; },
    host_exit_module: () => host.call('exit'),
    host_send_screenreader: (t) => host.call('sr', t),
    host_module_set_param: (k, v) => host.call('dsp', k, v),
    move_midi_inject_to_move: (p) => { host.call('track', ...p); return true; },
    move_midi_external_send: (p) => { host.call('usb', ...p); return true; },
    move_midi_internal_send: (p) => { host.led('int', ...p); return true; },
    shadow_get_display_mode: () => 0,
  });
  return host;
}

/* The module's own files are read from the staged copy; settings, stats and
 * progress from the scenario's in-memory store. */
function readHostFile(files, p) {
  if (files.has(p)) return files.get(p);
  if (p.startsWith(MODULE_DIR + '/exercises/')) {
    const local = join(SRC, p.slice(MODULE_DIR.length + 1));
    return existsSync(local) ? readFileSync(local, 'utf8') : null;
  }
  return null;
}

/* Wall time and Math.random, frozen for the length of a scenario. */
function freezeWorld(host) {
  const realNow = Date.now;
  const realRandom = Math.random;
  Date.now = () => EPOCH + host.now();
  let s = 0x2545f491;
  Math.random = () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 1000003) / 1000003;
  };
  return () => { Date.now = realNow; Math.random = realRandom; };
}

/* ---- Driving the Move ---------------------------------------------------- */

const MODULE_DIR = '/data/UserData/schwung/modules/tools/piano-practice';
const PAD = 68;
const JOG_TURN = 14, JOG_CLICK = 3, SHIFT = 49, MENU = 50, BACK = 51, PLAY = 85, RECORD = 86;
const KNOB1 = 71;
const NOW = 23;                  /* padmap's LED_TARGET_NEAR */

function driver(host) {
  /* Every tick is a 20ms frame, as on the device: the panel only redraws on
   * a clock that moves. */
  const tick = () => { host.advance(20); globalThis.tick(); host.endTick(); };
  const run = (ms) => { for (let i = 0; i < Math.ceil(ms / 20); i++) tick(); };
  const midi = (msg) => { globalThis.onMidiMessageInternal(msg); };
  const cc = (n, v = 127) => midi([0xb0, n, v]);
  const press = (n) => { cc(n, 127); tick(); cc(n, 0); tick(); };
  const jog = (n) => {
    for (let i = 0; i < Math.abs(n); i++) cc(JOG_TURN, n > 0 ? 1 : 127);
    tick();
  };
  const click = () => press(JOG_CLICK);
  const pad = (i, holdMs = 120, vel = 100) => {
    midi([0x90, PAD + i, vel]); run(holdMs); midi([0x80, PAD + i, 0]); tick();
  };
  const knob = (k, delta) => {
    for (let i = 0; i < Math.abs(delta); i++) cc(KNOB1 + k, delta > 0 ? 1 : 127);
    tick();
  };
  const shiftWith = (n) => { cc(SHIFT, 127); press(n); cc(SHIFT, 0); tick(); };
  /*
   * A player who reads the pads. With guide pads on (stage 1) the next note's
   * pad lights "now"; press it at that moment — one pad per pitch, since a
   * pitch has twins on the grid — and let go a moment later. Good enough to
   * play a drill through to its result.
   */
  const follow = (ms) => {
    const down = new Map();      /* pad note -> ms left until release */
    let before = new Map(host.pads);
    for (let i = 0; i < Math.ceil(ms / 20); i++) {
      const struck = new Set();
      for (const [n, colour] of host.pads) {
        const pitch = padPitch(n);
        if (colour === NOW && before.get(n) !== NOW && !down.has(n) && !struck.has(pitch)) {
          midi([0x90, n, 100]);
          down.set(n, 100);
          struck.add(pitch);
        }
      }
      before = new Map(host.pads);
      tick();
      for (const [n, left] of down) {
        if (left <= 20) { midi([0x80, n, 0]); down.delete(n); } else down.set(n, left - 20);
      }
    }
    for (const n of down.keys()) midi([0x80, n, 0]);
  };
  /* Back up to the top of the lesson list, and no further: one Back more
   * would close the module. */
  const toTop = () => {
    for (let i = 0; i < 8 && !host.screen().startsWith('EXERCISE'); i++) press(BACK);
  };
  return { tick, run, midi, cc, press, jog, click, pad, knob, shiftWith, follow, toTop };
}

const QUIET = JSON.stringify({ version: 7, autoInfo: false, quizSounds: false, roundSize: 10 });

/*
 * Each scenario is a session someone might actually have. They start from
 * init() on a fresh copy of the module, with settings.json as given.
 */
const SCENARIOS = {
  /* The list, its folders, Back, the settings page and an edit that rebuilds. */
  navigate: { settings: QUIET, play(d) {
    d.run(100);
    d.jog(1); d.click(); d.jog(2); d.click(); d.press(BACK); d.press(BACK);
    d.jog(3); d.click(); d.jog(1); d.press(BACK);
    d.shiftWith(JOG_CLICK);
    d.click(); d.jog(1); d.click();              /* edit row 0 */
    d.jog(2); d.click(); d.jog(-1); d.click();    /* edit row 2 */
    d.knob(0, 1); d.knob(1, 2); d.knob(2, -1);
    d.toTop(); d.run(1200);                       /* the throttled save lands */
  } },

  /* Basics › Scales › Major › Up & down: listen, pause, scrub, resume, restart. */
  listen: { settings: QUIET, play(d) {
    d.jog(1); d.click(); d.click(); d.click(); d.click();
    d.press(PLAY); d.run(4000);
    d.press(PLAY); d.run(200);                    /* pause */
    d.knob(0, 12); d.knob(0, -5); d.run(100);     /* scrub */
    d.press(PLAY); d.run(1500);                   /* resume */
    d.knob(7, 3); d.run(500);                     /* tempo */
    d.press(BACK); d.run(300);                    /* restart */
  } },

  /* The same drill practised, played from the guide pads to its result, then
   * again with a few wrong pads and a wait; then on from the result. */
  practice: { settings: QUIET, play(d) {
    d.jog(1); d.click(); d.click(); d.click(); d.click();
    d.press(RECORD); d.follow(26000);
    d.run(1000);
    d.press(RECORD); d.run(3500);
    for (let i = 0; i < 6; i++) { d.pad((i * 5) % 32, 60); d.follow(900); }
    d.run(4000);                                  /* stuck: the scroll waits */
    d.follow(20000);
    d.click(); d.run(500);                        /* next from the result */
  } },

  /* Learning Program › Continue, guide pads on stage 1, Back to the list. */
  program: { settings: QUIET, play(d) {
    d.click(); d.run(100); d.click(); d.run(100);
    d.press(PLAY); d.run(2500);                   /* listen a little */
    d.press(PLAY); d.press(BACK); d.run(100);     /* pause, back to the top */
    d.press(RECORD); d.follow(30000);             /* stage 1, to its result */
    d.click(); d.run(300);                        /* next: stage 2 */
    d.toTop(); d.run(200);
  } },

  /*
   * Every quiz kind, each from the Quiz folder (Hear, Play, Name):
   *   Play notes   every pad in turn, so some are right and most are wrong
   *   Play chords  both hints, then a few wrong pads
   *   Hear         Higher or lower, answered with the jog until the round ends
   *   Name notes   the same, through to its result and the stats it writes
   */
  quiz: { settings: QUIET, play(d) {
    const open = (path) => {
      d.jog(-60); d.jog(2); d.click();
      for (const step of path) { d.jog(step); d.click(); }
      d.run(600);
    };
    const leave = () => d.toTop();
    const answerWithJog = (n) => { for (let i = 0; i < n; i++) { d.jog(1); d.click(); d.run(1500); } };

    open([1, 0]);
    d.press(RECORD); d.press(RECORD);
    for (let p = 0; p < 32; p++) d.pad(p, 40);
    d.run(600); leave();

    open([1, 1]);
    d.press(PLAY); d.press(RECORD); d.press(RECORD); d.run(400);
    for (const p of [0, 4, 7]) d.pad(p, 60);
    leave();

    open([0, 0, 0]);
    answerWithJog(30); d.run(1000); leave();

    open([2, 0]);
    d.press(RECORD); d.run(200);
    answerWithJog(30); d.run(1000); d.click(); d.run(300); leave();
  } },

  /* Factory settings: the first Info page opens by itself, quiz sounds on. */
  info: { settings: null, play(d) {
    d.run(200);
    d.jog(1); d.press(MENU); d.jog(3); d.jog(-1); d.press(MENU);
    d.click(); d.run(300); d.press(MENU); d.press(BACK);
    d.press(BACK);
    d.jog(1); d.click(); d.jog(1); d.click(); d.run(800);   /* a quiz, sounds on */
    for (let i = 0; i < 4; i++) { d.pad(i * 7, 60); d.run(900); }
  } },

  /* Progress: the list, a chart, the jog across drills, back out. */
  progress: { settings: QUIET, play(d) {
    d.jog(60); d.click(); d.run(100);
    d.jog(1); d.click(); d.jog(1); d.jog(1); d.press(BACK); d.press(BACK);
  } },

  /* A song: its levels, a level armed, practised briefly; then Shift+Back. */
  exit: { settings: QUIET, play(d) {
    d.jog(3); d.click(); d.click(); d.run(100); d.click(); d.run(100);
    d.press(RECORD); d.run(2500); d.pad(10); d.pad(11);
    d.shiftWith(BACK); d.run(600);
    globalThis.onUnload(); d.tick();
  } },
};

/* ---- The test ------------------------------------------------------------ */

const uiPath = stageModule();
let loads = 0;

async function record(name, scenario) {
  const files = new Map();
  if (scenario.settings) files.set(MODULE_DIR + '/settings.json', scenario.settings);
  const host = makeHost(files);
  const thaw = freezeWorld(host);
  try {
    await import(`${uiPath}?trace=${name}-${loads++}`);
    globalThis.init();
    host.endTick();
    scenario.play(driver(host));
    return host.take();
  } finally {
    thaw();
  }
}

for (const [name, scenario] of Object.entries(SCENARIOS)) {
  test(`trace: ${name}`, async () => {
    const events = await record(name, scenario);
    const file = join(FIXTURES, `${name}.json`);
    const text = JSON.stringify(events, null, 0).replace(/\],\[/g, '],\n[') + '\n';
    if (UPDATE || !existsSync(file)) {
      mkdirSync(FIXTURES, { recursive: true });
      writeFileSync(file, text);
      if (!UPDATE) assert.fail(`${name}: no recording yet; wrote one — run again`);
      return;
    }
    const want = readFileSync(file, 'utf8').split('\n');
    const got = text.split('\n');
    const at = got.findIndex((line, i) => line !== want[i]);
    assert.ok(at === -1 && got.length === want.length,
      `${name}: host trace differs at event ${at}\n  want ${want[at]}\n  got  ${got[at]}`);
  });
}

/* A trace that recorded nothing would pass forever. */
test('every scenario reaches the host', async () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    const events = await record(name, scenario);
    assert.ok(events.some((e) => e[0] === 'tick'), `${name}: nothing drawn`);
  }
  const practice = await record('practice', SCENARIOS.practice);
  assert.ok(practice.some((e) => e[0] === 'dsp' && e[1] === 'n'), 'practice: no notes reached the piano');
  const exit = await record('exit', SCENARIOS.exit);
  assert.ok(exit.some((e) => e[0] === 'exit'), 'exit: the module never left');
});
