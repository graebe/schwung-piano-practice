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
 * frame still fails the test. So is the picture sent to a browser page: one
 * digest per write, with what it showed checked by the `page` scenario itself.
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
import { padPitch, padsForPitch, DEFAULT_TRANSPOSE } from '../src/padmap.mjs';
import { layoutPlaces, padOfCell } from '../src/pathmap/layout.mjs';
import * as PROG from '../src/progress.mjs';
import * as PLAN from '../src/program.mjs';
import * as CAT from '../src/catalog.mjs';
import { fakeDsp } from './support/fake_dsp.mjs';

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
function makeHost(files, dsp) {
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
    host_module_set_param: (k, v) => {
      host.call('dsp', k, k === 'vm' ? 'sha:' + createHash('sha1').update(v).digest('hex').slice(0, 12) : v);
      if (dsp) dsp.set(k, v);
      return true;
    },
    /* Only a scenario with a page has a DSP to read; without one ui.js must
     * not read at all, which is what every other recording holds it to. */
    host_module_get_param: dsp ? (k) => { host.call('read', k); return dsp.get(k); } : undefined,
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
  /* A settings knob turned `values` values: ten units each (knob_accel.mjs). */
  const turn = (k, values) => {
    for (let i = 0; i < Math.abs(values) * 10; i++) cc(KNOB1 + k, values > 0 ? 1 : 127);
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
  /*
   * A player who knows the piece: REC, then every note of `chart` on its beat
   * after the count-in, whether or not a pad is lit (Solo keeps them dark).
   */
  const playChart = (chart) => {
    press(RECORD);
    const start = host.now() - 20;
    const msPerBeat = 60000 / chart.bpm;
    for (const e of chart.events) {
      const at = start + (e.beat + 4) * msPerBeat;
      while (host.now() < at) tick();
      for (const pitch of e.pitches) midi([0x90, padsForPitch(pitch, DEFAULT_TRANSPOSE)[0], 100]);
      tick();
      for (const pitch of e.pitches) midi([0x80, padsForPitch(pitch, DEFAULT_TRANSPOSE)[0], 0]);
    }
    run(3000);
  };
  /* Back up to home, the top of the lesson list, and no further: one Back
   * more would close the module. Home's title is the module's name. */
  const toTop = () => {
    for (let i = 0; i < 8 && !host.screen().startsWith('PIANO | '); i++) press(BACK);
  };
  return { tick, run, midi, cc, press, jog, click, pad, knob, turn, shiftWith, follow, playChart, toTop, host };
}

const QUIET = JSON.stringify({ version: 7, autoInfo: false, quizSounds: false, roundSize: 10 });

/*
 * Progress for the scenes: what the Learning Path holds when a take is about
 * to finish something. Played an hour before the scenario's clock, so
 * nothing is due for review yet.
 */
const TIPS_SEEN = ['welcome', 'sheet', 'practice', 'quiz', 'map', 'island', 'placement', 'cells'];
function progressWith(fn) {
  const p = PROG.emptyProgress();
  p.tips = TIPS_SEEN.slice();
  const at = EPOCH - 3600000;
  const learn = (id) => {
    PROG.recordAttempt(p, id, { stage: 1, score: 1, at });
    PROG.recordAttempt(p, id, { stage: 2, score: 1, at });
  };
  const guided = (id) => PROG.recordAttempt(p, id, { stage: 1, score: 1, at });
  fn({ learn, guided, phases: PLAN.buildProgram() });
  return PROG.serialiseProgress(p);
}
/* 1.3 Major scale with Major down left to play Solo. */
const LAST_OF_UNIT = progressWith(({ learn, guided }) => {
  learn('basics/scales/major/up-down');
  guided('basics/scales/major/down');
});
/* Stage 1 learned but Major up & down, which its checkpoint plays Solo. */
const LAST_OF_STAGE = progressWith(({ learn, guided, phases }) => {
  for (const step of PLAN.phaseSteps(phases[0])) if (step.id !== 'basics/scales/major/up-down') learn(step.id);
  guided('basics/scales/major/up-down');
});
/* A Path step's chart, as the session builds it: in C, at the settings' tempo. */
function pathChart(id) {
  const pinned = CAT.basics({ rootPc: 0, mode: 'major', bpm: 80, transpose: DEFAULT_TRANSPOSE, seed: 1,
    ...PLAN.PROGRAM_GEN });
  CAT.stampChildren([pinned], '');
  return CAT.findById({ children: [pinned] }, id).node.build();
}
/* Island 1's places: a pad for each, the island's own layout. */
const islandPad = (n, i) => padOfCell(layoutPlaces(n, { kind: 'island' }).cells[i]) - 68;
/* Welcomed, with every tip seen: the scenarios below are about what they
 * drive, not about the first-visit cards, which `welcome` and `sheet` cover. */
const WELCOMED = JSON.stringify({ tips: ['welcome', 'sheet', 'practice', 'quiz', 'map', 'island', 'placement', 'cells'] });

/*
 * Each scenario is a session someone might actually have. They start from
 * init() on a fresh copy of the module, with settings.json as given.
 */
/* Chords › Hear with a Custom set of one chord: too few to name. */
const CUSTOM_MAJOR = JSON.stringify({
  tips: TIPS_SEEN,
  trainers: { chord: { hear: { answer: 'name', level: 'custom', custom: ['maj'] } } },
});

const SCENARIOS = {
  /* The list, its folders, Back, the settings folder, a group's page and an
   * edit that rebuilds. */
  navigate: { settings: QUIET, progress: WELCOMED, play(d) {
    d.run(100);
    d.jog(1); d.click(); d.jog(4); d.click();     /* Practice › Progressions: a trainer */
    d.jog(3); d.click();                          /* its Learn: the charts */
    d.press(BACK); d.press(BACK); d.press(BACK);
    d.jog(1); d.click(); d.jog(1); d.click(); d.jog(1);   /* Songs › Electronic */
    d.press(BACK); d.press(BACK);
    d.jog(60); d.click();                         /* Settings: the page */
    d.click(); d.jog(1); d.click();              /* Octave up: a rebuild */
    d.jog(2); d.click(); d.jog(-1); d.click();    /* Key down a semitone */
    d.turn(0, 1); d.turn(1, 2); d.turn(2, -1);    /* the knobs: the rows on screen */
    d.jog(60); d.click(); d.run(100);             /* Advanced */
    d.click(); d.click(); d.jog(1); d.click();    /* Practice: Tempo up */
    d.toTop(); d.run(1200);                       /* the throttled save lands */
  } },

  /* Practice › Scales › Major › Up & down: listen, pause, scrub, resume, restart. */
  listen: { settings: QUIET, progress: WELCOMED, play(d) {
    d.jog(1); d.click(); d.jog(2); d.click();     /* Practice › Scales: the trainer */
    d.jog(3); d.click(); d.click(); d.click();    /* Learn › Major › Up & down */
    d.press(PLAY); d.run(4000);
    d.press(PLAY); d.run(200);                    /* pause */
    d.knob(0, 12); d.knob(0, -5); d.run(100);     /* scrub */
    d.press(PLAY); d.run(1500);                   /* resume */
    d.knob(7, 3); d.run(500);                     /* tempo */
    d.press(BACK); d.run(300);                    /* restart */
  } },

  /* The same drill practised, played from the guide pads to its result, then
   * again with a few wrong pads and a wait; then on from the result. */
  practice: { settings: QUIET, progress: WELCOMED, play(d) {
    d.jog(1); d.click(); d.jog(2); d.click();
    d.jog(3); d.click(); d.click(); d.click();
    d.press(RECORD); d.follow(26000);
    d.run(1000);
    d.press(RECORD); d.run(3500);
    for (let i = 0; i < 6; i++) { d.pad((i * 5) % 32, 60); d.follow(900); }
    d.run(4000);                                  /* stuck: the scroll waits */
    d.follow(20000);
    d.click(); d.run(500);                        /* next from the result */
  } },

  /* Path › 1 › 1.3 Major scale › Major up & down, guide pads on stage 1, Back
   * to the list. */
  program: { settings: QUIET, progress: WELCOMED, play(d) {
    d.click(); d.run(100); d.click(); d.run(400);   /* the world, then the island zooms in */
    d.jog(2); d.click(); d.click(); d.run(100);
    d.press(PLAY); d.run(2500);                   /* listen a little */
    d.press(PLAY); d.press(BACK); d.run(100);     /* pause, back to the top */
    d.press(RECORD); d.follow(30000);             /* stage 1, to its result */
    d.click(); d.run(300);                        /* next: stage 2 */
    d.toTop(); d.run(200);
  } },

  /*
   * Every quiz kind, each from the Quiz folder (Ear, Reading, Keys):
   *   Notes by alphabet  every pad in turn, so some are right and most are
   *                      wrong, and the row glides on after each right one
   *   Chords by staff    both hints, then a few wrong pads
   *   Ear                Pitch & melody › Higher or lower, answered with the
   *                      jog until the round ends
   *   Name notes         the same, through to its result and the stats it writes
   *   Reading            Identify intervals › 1 2nds › up, on the staff, by jog
   */
  /*
   * What Quiz held, as the trainers have it now: a note by name, played with
   * every pad and helped; notes off the staff, heard and helped; intervals
   * named by ear with the jog to the result; a note named off the staff with
   * help, on to the next round; a note heard and played back.
   */
  quiz: { settings: QUIET, progress: WELCOMED, play(d) {
    /* Practice › subject › circle: its setup on Start, `turn` rows above it
     * turned one value on, then Start. */
    const open = (subject, circle, answer = 0) => {
      d.jog(-60); d.jog(1); d.click();
      d.jog(-60); d.jog(subject); d.click();
      d.jog(-60); d.jog(circle); d.click();
      if (answer) d.turn(1, answer);              /* knob 2: the answer */
      d.press(PLAY); d.run(600);
    };
    const leave = () => d.toTop();
    const answerWithJog = (n) => { for (let i = 0; i < n; i++) { d.jog(1); d.click(); d.run(1500); } };

    open(0, 2);                                   /* Notes › Play */
    d.press(RECORD); d.press(RECORD);
    for (let p = 0; p < 32; p++) d.pad(p, 40);
    d.run(600); leave();

    open(0, 0);                                   /* Notes › Read, played */
    d.press(PLAY); d.press(RECORD); d.press(RECORD); d.run(400);
    for (const p of [0, 4, 7]) d.pad(p, 60);
    leave();

    open(1, 1);                                   /* Intervals › Hear, named */
    answerWithJog(30); d.run(1000); leave();

    open(0, 0, 1);                                /* Notes › Read, named */
    d.press(RECORD); d.run(200);
    answerWithJog(30); d.run(1000); d.click(); d.run(300); leave();

    open(0, 1);                                   /* Notes › Hear, played back */
    d.press(PLAY); d.run(1500);
    for (let i = 0; i < 6; i++) { d.pad(i * 5, 60); d.run(600); }
    leave();
  } },

  /* Factory settings: the first Info page opens by itself, quiz sounds on. */
  info: { settings: null, progress: WELCOMED, play(d) {
    d.run(200);
    d.jog(1); d.press(MENU); d.jog(3); d.jog(-1); d.press(MENU);
    d.click(); d.run(300); d.press(MENU); d.press(BACK);
    d.press(BACK);
    d.toTop(); d.jog(-60); d.jog(1); d.click();  /* Practice */
    d.click(); d.jog(2); d.click(); d.press(PLAY); d.run(800);   /* Notes › Play, sounds on */
    for (let i = 0; i < 4; i++) { d.pad(i * 7, 60); d.run(900); }
  } },

  /* Progress: the list, a chart, the jog across drills, back out. */
  progress: { settings: QUIET, progress: WELCOMED, play(d) {
    d.jog(3); d.click(); d.run(100);
    d.jog(1); d.click(); d.jog(1); d.jog(1); d.press(BACK); d.press(BACK);
  } },

  /*
   * A browser page on the Move's session: nobody watching, then a page opens,
   * steers into the scales drill, listens, plays a note, and backs out past
   * the top of the list — which must not close the tool. Then it closes, and
   * ui.js goes back to sending nothing but the occasional nudge.
   */
  page: { settings: QUIET, progress: WELCOMED, page: true, play(d, dsp) {
    d.run(2500);                                  /* unwatched: reads, nudges */
    dsp.openPage(); d.run(1200);
    for (const a of [{ type: 'move', delta: 1 }, { type: 'open' }, { type: 'open' },
      { type: 'move', delta: 1 }, { type: 'move', delta: 1 }, { type: 'move', delta: 1 },
      { type: 'open' }, { type: 'open' }, { type: 'open' }]) {
      dsp.act(a); d.run(250);
    }
    dsp.act({ type: 'listen' }); d.run(2000);
    dsp.act({ type: 'listen' }); d.run(400);      /* pause */
    dsp.act({ type: 'noteOn', pitch: 60, vel: 90 }); d.run(250);
    dsp.act({ type: 'noteOff', pitch: 60 }); d.run(250);
    for (let i = 0; i < 8; i++) { dsp.act({ type: 'back' }); d.run(250); }
    d.run(1500);
    dsp.closePage(); d.run(6000);
  } },

  /* A song armed from its row, its level walked on the ready screen,
   * practised briefly; then Shift+Back. */
  exit: { settings: QUIET, progress: WELCOMED, play(d) {
    d.jog(1); d.click(); d.jog(4); d.click(); d.click(); d.press(PLAY); d.run(100);   /* a chart: armed at once */
    d.jog(1); d.jog(1); d.jog(-1); d.run(100);    /* the jog walks its levels: 1 Solo, 2 Guided, 1 Solo */
    d.press(RECORD); d.run(2500); d.pad(10); d.pad(11);
    d.shiftWith(BACK); d.run(600);
    globalThis.onUnload(); d.tick();
  } },

  /*
   * A first launch: the welcome's three pages, the Shift layer of the hint
   * line, "I already play", the Path with its tip, help on that tip, and the
   * hint line taking turns.
   */
  welcome: { settings: QUIET, progress: null, play(d) {
    d.run(200);
    d.click(); d.run(100);                        /* Lit pads can be pressed */
    d.cc(SHIFT, 127); d.tick(); d.cc(SHIFT, 0); d.tick();
    d.jog(1); d.run(100);                         /* Keys */
    d.jog(1); d.run(100);                         /* New to piano? */
    d.jog(1); d.click(); d.run(200);              /* I already play: the Path, and a tip */
    d.press(MENU); d.press(MENU);                 /* help on the tip, and back */
    d.click(); d.run(100);                        /* the tip closes on the Path */
    d.run(6500);                                  /* nothing moves; the hint stays */
    d.toTop(); d.run(200);
  } },

  /*
   * Home: the jog growing circle after circle (every frame of a grow drawn),
   * MENU's help, a pad opening Quiz and making no sound, Back finding its
   * circle selected, a pad off the five doing nothing, home shown as a list
   * for the session and Back to the circles, and Settings by its pad.
   */
  home: { settings: QUIET, progress: WELCOMED, play(d) {
    d.run(100);
    for (let i = 0; i < 4; i++) { d.jog(1); d.run(60); }
    d.jog(1); d.run(200);                         /* clamped on Settings */
    d.jog(-1); d.run(200);                        /* Progress */
    d.press(MENU); d.press(MENU);                 /* help, and closed */
    d.pad(3, 60); d.run(200);                     /* pad 71: Quiz, silent */
    d.press(BACK); d.run(200);                    /* Quiz's circle selected */
    d.pad(0, 60); d.pad(20, 60); d.run(200);      /* off the five: nothing */
    d.shiftWith(JOG_CLICK); d.click(); d.run(100);   /* Show as list */
    d.jog(1); d.run(100);
    d.press(BACK); d.run(200);                    /* the circles again */
    d.pad(5, 60); d.run(200);                     /* pad 73: Settings */
    d.toTop(); d.run(200);
  } },

  /*
   * The Path as a map: the world, a pad walking the avatar to stage 3 and a
   * second press going in, the jog walking the island, MENU's help, the
   * island as a list and back, Back up to the world, and Play as Continue.
   * The pads light the places; nothing sounds.
   */
  map: { settings: QUIET, progress: WELCOMED, play(d) {
    d.run(100);
    d.click(); d.run(300);                        /* Path: the world */
    const third = padOfCell(layoutPlaces(5).cells[2]) - PAD;
    d.pad(third, 60); d.run(700);                 /* walk to stage 3 */
    d.pad(third, 60); d.run(400);                 /* and in: its island zooms in */
    d.jog(1); d.run(400); d.jog(1); d.run(400);   /* walk the island */
    d.press(MENU); d.jog(3); d.press(MENU);       /* help, scrolled, closed */
    d.shiftWith(JOG_CLICK); d.jog(60); d.jog(-1); d.click(); d.run(100);   /* Show as list */
    d.press(BACK); d.run(100);                    /* the map again */
    d.press(BACK); d.run(400);                    /* up to the world */
    d.press(PLAY); d.run(600);                    /* Continue */
    d.toTop(); d.run(200);
  } },

  /*
   * Practice and Quiz as rings: Practice's five circles grown in turn, MENU's
   * help for the ring, Songs opened by its pad and Back finding its circle,
   * the ring as a list and back, home again on Practice; Quiz's three on
   * pads 70..72, Keys by its pad, and Back twice to home.
   */
  rings: { settings: QUIET, progress: WELCOMED, play(d) {
    d.run(100);
    d.jog(1); d.click(); d.run(200);              /* the Practice ring: five trainers */
    for (let i = 0; i < 4; i++) { d.jog(1); d.run(60); }
    d.jog(-4); d.run(200);                        /* back to Notes */
    d.press(MENU); d.press(MENU);                 /* its help, closed */
    d.pad(4, 60); d.run(200);                     /* pad 72: Chords, silent */
    d.pad(3, 60); d.run(200);                     /* its pad 71: Play's setup */
    d.press(BACK); d.press(BACK); d.run(200);     /* the Chords ring, then Practice on Chords */
    d.shiftWith(JOG_CLICK); d.click(); d.run(100);   /* Show as list */
    d.jog(-1); d.run(100);
    d.press(BACK); d.run(200);                    /* the circles again */
    d.press(BACK); d.run(200);                    /* home, on Practice */
    d.jog(1); d.click(); d.run(200);              /* the Songs ring: four */
    d.pad(1, 60); d.run(200);                     /* pad 69: no circle of four? */
    d.pad(3, 60); d.run(200);
    d.press(BACK); d.press(BACK); d.run(200);
  } },

  /*
   * The chord trainer, read: the ring, Read's setup (Answer to name, Level 3),
   * a round answered with the jog to its result, the result's next, Back to
   * the setup and the ring.
   */
  'chord-read': { settings: QUIET, progress: WELCOMED, play(d) {
    d.run(100);
    d.jog(1); d.click(); d.run(200);              /* Practice */
    d.jog(3); d.click(); d.run(200);              /* Chords: the trainer's ring */
    d.click(); d.run(100);                        /* Read: its knobs */
    d.turn(3, 1);                                 /* knob 4, Answer: name (Level 2) */
    d.turn(0, 1);                                 /* knob 1, Level 3 */
    d.press(PLAY); d.run(400);                    /* PLAY starts */
    for (let i = 0; i < 30; i++) { d.jog(1); d.click(); d.run(1500); }
    d.run(1000); d.click(); d.run(400);           /* the result's next: another round */
    d.press(BACK); d.run(100);                    /* its setup */
    d.press(BACK); d.run(100);                    /* the ring */
  } },

  /* Hear: block chords played back on the pads, then named, broken. */
  'chord-hear': { settings: QUIET, progress: WELCOMED, play(d) {
    d.run(100);
    d.jog(1); d.click(); d.run(200);
    d.jog(3); d.click(); d.run(200);
    d.jog(1); d.click(); d.run(100);              /* Hear: its knobs */
    d.press(PLAY); d.run(1500);                   /* play it back */
    for (const p of [0, 4, 7, 12]) d.pad(p, 60);
    d.press(PLAY); d.run(1500);                   /* again */
    d.press(RECORD); d.run(400);                  /* help */
    d.press(BACK); d.run(100);                    /* the knobs */
    d.turn(3, 1);                                 /* knob 4, Answer: name */
    d.turn(6, 1);                                 /* knob 7, Sound: broken */
    d.press(PLAY); d.run(2500);
    for (let i = 0; i < 4; i++) { d.pad(i, 60); d.run(1500); }
    d.press(BACK); d.press(BACK); d.run(100);
  } },

  /* Scales, heard: one played back on the pads (a wrong note starts it
   * again), then named, up and down. */
  'scale-hear': { settings: QUIET, progress: WELCOMED, play(d) {
    d.run(100);
    d.jog(1); d.click(); d.run(200);              /* Practice */
    d.jog(2); d.click(); d.run(200);              /* Scales: the trainer's ring */
    d.jog(1); d.click(); d.run(100);              /* Hear: its knobs */
    d.press(PLAY); d.run(4500);                   /* listen */
    for (const p of [0, 2, 3]) d.pad(p, 60);      /* a wrong note in it */
    d.press(RECORD); d.run(4500);                 /* help: again, slower */
    d.press(BACK); d.run(100);
    d.turn(2, 1);                                 /* knob 3, Answer: name */
    d.turn(3, 2);                                 /* knob 4, Direction: both */
    d.press(PLAY); d.run(8000);
    for (let i = 0; i < 6; i++) { d.jog(1); d.click(); d.run(1500); }
    d.press(BACK); d.press(BACK); d.run(100);
  } },

  /* Scales, played: from the name, then read and played as a chart. */
  'scale-play': { settings: QUIET, progress: WELCOMED, play(d) {
    d.run(100);
    d.jog(1); d.click(); d.run(200);
    d.jog(2); d.click(); d.run(200);
    d.jog(2); d.click(); d.run(100);              /* Play: its knobs */
    d.press(PLAY); d.run(400);                    /* C major, by name */
    for (const p of [3, 5, 7, 8, 10, 12, 14, 15]) d.pad(p, 60);   /* C D E F G A B C */
    d.run(800);
    d.press(BACK); d.press(BACK); d.run(100);     /* the knobs, the ring */
    d.jog(-2); d.click(); d.run(100);             /* Read */
    d.press(PLAY); d.run(300);                    /* a chart on its ready screen */
    d.knob(7, -2); d.run(200);                    /* Knob 8: slower */
    d.press(BACK); d.run(100);                    /* its knobs */
    d.press(BACK); d.run(100);
  } },

  /* Progressions, heard: played back chord by chord after the home chord,
   * a wrong chord on the way; then named. */
  'prog-hear': { settings: QUIET, progress: WELCOMED, play(d) {
    d.run(100);
    d.jog(1); d.click(); d.run(200);              /* Practice */
    d.jog(4); d.click(); d.run(200);              /* Progressions: the trainer's ring */
    d.jog(1); d.click(); d.run(100);              /* Hear: its knobs */
    d.press(PLAY); d.run(5000);                   /* listen */
    for (const p of [3, 7, 10]) d.pad(p, 80);     /* a chord */
    d.pad(1, 80);                                 /* a wrong note */
    d.press(RECORD); d.run(5000);                 /* help: again, slower */
    d.press(BACK); d.run(100);
    d.turn(1, 1);                                 /* knob 2, Answer: name */
    d.press(PLAY); d.run(5000);
    for (let i = 0; i < 6; i++) { d.jog(1); d.click(); d.run(1500); }
    d.press(BACK); d.press(BACK); d.run(100);
  } },

  /* Progressions, played: from the numerals with Key all 12, then read as a
   * chart in pop eighths. */
  'prog-play': { settings: QUIET, progress: WELCOMED, play(d) {
    d.run(100);
    d.jog(1); d.click(); d.run(200);
    d.jog(4); d.click(); d.run(200);
    d.jog(2); d.click(); d.run(100);              /* Play: its knobs */
    d.turn(1, 20);                                /* knob 2, Key: all 12 */
    d.press(PLAY); d.run(400);
    for (const p of [3, 7, 10, 8, 12, 15]) d.pad(p, 60);
    d.run(600);
    d.press(BACK); d.press(BACK); d.run(100);
    d.jog(-2); d.click(); d.run(100);             /* Read */
    d.turn(4, 1);                                 /* knob 5, Rhythm: pop 8ths */
    d.press(PLAY); d.run(300);                    /* a chart on its ready screen */
    d.press(PLAY); d.run(3000);                   /* listen */
    d.press(BACK); d.press(BACK); d.run(100);     /* its setup */
    d.press(BACK); d.run(100);
  } },

  /*
   * The setup page of Chords › Hear: blocked with too little ticked (the bar
   * says why, PLAY dark), Level's Custom tick list from a click, then the
   * knob overlay: a touch opens it, a turn steps the options a value per ten
   * units, letting go closes it 1.5 s later; a turn without a touch opens
   * and closes it too; Back closes it and stays; a knob with no setting says
   * which do; the jog walks the knobs; PLAY starts, Back returns.
   */
  'trainer-knobs': { settings: QUIET, progress: CUSTOM_MAJOR, play(d) {
    const touch = (k) => d.midi([0x90, k, 100]);
    const release = (k) => d.midi([0x80, k, 0]);
    d.run(100);
    d.jog(1); d.click(); d.run(200);              /* Practice */
    d.jog(3); d.click(); d.run(200);              /* Chords */
    d.jog(1); d.click(); d.run(200);              /* Hear: the page, blocked */
    d.press(PLAY); d.run(200);                    /* nothing starts */
    d.click(); d.run(100);                        /* Level is Custom: its tick list */
    d.jog(1); d.click(); d.run(60);               /* Minor ticked */
    d.press(BACK); d.run(200);                    /* the page, ready */
    d.run(3000);                                  /* the bar's other turn */
    touch(4); d.run(100);                         /* knob 5, Roots: its overlay */
    d.knob(4, 5); d.run(60);                      /* half a value: nothing moves */
    d.knob(4, 5); d.run(60);                      /* the tenth unit: in key */
    d.turn(4, 1); d.run(60);                      /* chromatic */
    release(4); d.run(1600);                      /* let go: closed 1.5 s later */
    for (const k of [1, 2, 3, 5, 6, 7]) { d.turn(k, 1); d.run(60); }
    d.run(1600);                                  /* no touch: closed after the last turn */
    touch(0); d.run(100); d.turn(0, -1);          /* knob 1, Level: the top one */
    d.press(BACK); d.run(100);                    /* Back closes the overlay, stays */
    release(0);
    touch(7); d.run(100); release(7); d.run(1600); /* knob 8, Round */
    d.jog(1); d.run(60); d.jog(-3); d.run(1600);  /* the jog walks the knobs */
    d.press(PLAY); d.run(2000);                   /* a round */
    d.press(BACK); d.run(200);                    /* the page again */
    d.shiftWith(JOG_CLICK); d.run(100);           /* as a list */
    d.press(BACK); d.press(BACK); d.run(100);
    d.jog(1); d.click(); d.run(200);              /* Chords > Play: six knobs */
    touch(7); d.run(100); release(7); d.run(1600); /* knob 8 sets nothing here */
    d.press(BACK); d.run(100);
  } },

  /* Stats: a round heard, then the list, a row's detail and Back. */
  'trainer-stats': { settings: QUIET, progress: WELCOMED, play(d) {
    d.run(100);
    d.jog(1); d.click(); d.run(200);
    d.jog(3); d.click(); d.run(200);
    d.jog(4); d.click(); d.run(200);              /* Stats, nothing yet */
    d.press(BACK); d.run(100);
    d.jog(-3); d.click(); d.run(100);             /* Hear */
    d.turn(3, 1);                                 /* knob 4, Answer: name */
    d.press(PLAY); d.run(2500);
    for (let i = 0; i < 40 && d.host.screen().startsWith('CHORDS HEAR'); i++) {
      d.jog(1); d.click(); d.run(1500);
    }
    d.run(1000);                                  /* the result */
    d.press(BACK); d.press(BACK); d.press(BACK); d.run(200);   /* again, its knobs, the ring */
    d.jog(3); d.click(); d.run(200);              /* Stats */
    d.jog(1); d.click(); d.run(200);              /* a row's detail */
    d.press(BACK); d.press(BACK); d.run(200);
  } },

  /*
   * Into an island and out: the zoom in (frames on the way), Back's zoom out,
   * and a zoom skipped by the jog, which only skips.
   */
  zoom: { settings: QUIET, progress: WELCOMED, play(d) {
    d.run(100);
    d.click(); d.run(300);                        /* the world */
    d.click();                                    /* into stage 1: the zoom */
    for (let i = 0; i < 4; i++) d.run(100);
    d.press(BACK);                                /* out again */
    for (let i = 0; i < 4; i++) d.run(100);
    d.click(); d.run(60); d.jog(1); d.run(100);   /* in, and a skip mid-zoom */
    d.press(BACK); d.run(400);
    d.toTop(); d.run(200);
  } },

  /*
   * The last step of a place played Solo: a star round the score (learned),
   * then Next: the flag up on 1.3 Major scale, the walk to the next place,
   * and its step armed.
   */
  'next-walk': { settings: QUIET, progress: LAST_OF_UNIT, play(d) {
    d.run(100);
    d.click(); d.run(300);                        /* the world */
    d.click(); d.run(400);                        /* island 1 */
    d.pad(islandPad(9, 2), 60); d.run(1000);      /* walk to 1.3 Major scale */
    d.pad(islandPad(9, 2), 60); d.run(100);       /* and in */
    d.jog(1); d.click(); d.run(100);              /* Major down, Solo */
    d.playChart(pathChart('basics/scales/major/down'));
    d.run(700);                                   /* the star */
    d.click();                                    /* Next: the flag, the walk */
    d.run(4000);
    d.toTop(); d.run(200);
  } },

  /*
   * A stage's checkpoint passed: fireworks over the fort, CHECKPOINT PASSED,
   * out to the world, the sail to stage 2, in, and on.
   */
  'stage-done': { settings: QUIET, progress: LAST_OF_STAGE, play(d) {
    d.run(100);
    d.click(); d.run(300);                        /* the world */
    d.shiftWith(JOG_CLICK); d.jog(2); d.click(); d.run(100);   /* Test out: checkpoint */
    d.playChart(pathChart('basics/scales/major/up-down'));
    d.run(700);                                   /* the star */
    d.click();                                    /* Next */
    d.run(8000);
    d.toTop(); d.run(200);
  } },

  /*
   * The options of a row: the sheet's tip once, Test out: checkpoint on a
   * stage, the Path as a list, I know this on its Continue and Continue then
   * opening the step after, and Settings... from home: the page, Start at.
   */
  sheet: { settings: QUIET, progress: JSON.stringify({ tips: ['welcome', 'practice', 'quiz', 'map', 'island', 'cells'] }), play(d) {
    d.run(100);
    d.click(); d.run(100);                        /* Path */
    d.shiftWith(JOG_CLICK); d.run(100);           /* 1 Grid and staff: its tip, over the sheet */
    d.click(); d.run(100);                        /* the tip closes */
    d.jog(2); d.click(); d.run(300);              /* Test out: checkpoint */
    d.press(BACK); d.run(100); d.toTop();
    d.click(); d.run(100);                        /* the Path again */
    d.shiftWith(JOG_CLICK); d.jog(60); d.jog(-1); d.click(); d.run(100);   /* Show as list */
    d.jog(-1); d.shiftWith(JOG_CLICK); d.run(100); /* Continue */
    d.click(); d.run(100);                        /* I know this: skip */
    d.click(); d.run(600);                        /* Continue: the step after */
    d.toTop();
    d.jog(1); d.shiftWith(JOG_CLICK); d.run(100); /* Practice: Show as list, Settings... */
    d.jog(1); d.click(); d.run(100);              /* Settings...: the page */
    d.jog(4); d.click(); d.jog(1); d.click(); d.run(100);   /* Start at: stage 2 */
    d.press(BACK); d.toTop(); d.run(1200);
  } },
};

/* ---- The test ------------------------------------------------------------ */

const uiPath = stageModule();
let loads = 0;

async function record(name, scenario, seen = {}) {
  const files = new Map();
  if (scenario.settings) files.set(MODULE_DIR + '/settings.json', scenario.settings);
  if (scenario.progress) files.set(MODULE_DIR + '/progress.json', scenario.progress);
  let clockOf = () => 0;
  const dsp = scenario.page ? fakeDsp(() => clockOf()) : null;
  const host = makeHost(files, dsp);
  clockOf = host.now;
  seen.dsp = dsp;
  const thaw = freezeWorld(host);
  try {
    await import(`${uiPath}?trace=${name}-${loads++}`);
    globalThis.init();
    host.endTick();
    scenario.play(driver(host), dsp);
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

/* What the `page` recording means, said outright. */
test('a page watches and steers the Move, and cannot close it', async () => {
  const seen = {};
  const events = await record('page', SCENARIOS.page, seen);
  const { dsp } = seen;
  const firstVm = events.findIndex((e) => e[0] === 'dsp' && e[1] === 'vm');
  const before = events.slice(0, firstVm);
  assert.ok(before.some((e) => e[0] === 'read' && e[1] === 'inbox'), 'unwatched: the inbox is read');
  assert.ok(before.some((e) => e[0] === 'dsp' && e[1] === 'stale'), 'unwatched: a nudge, no picture');
  assert.ok(dsp.pictures.length >= 5, `pictures sent while watched: ${dsp.pictures.length}`);
  const screens = dsp.pictures.map((p) => JSON.parse(p.screen));
  assert.ok(screens.includes('ready'), 'the page saw the drill armed: ' + [...new Set(screens)]);
  assert.ok(events.some((e) => e[0] === 'dsp' && e[1] === 'n' && /(^|,)60:90/.test(e[2])), 'its note sounded');
  assert.ok(!events.some((e) => e[0] === 'exit'), 'a page closed the tool');
  assert.equal(dsp.last().screen, 'menu');
  /* From the moment the close is noticed — the first nudge after the last
   * picture — about six seconds remain: a read a second, not five. Counted
   * from the notice, not from the last picture, which can fall anywhere in
   * the last second the page was open. */
  const lastVm = events.map((e, i) => (e[0] === 'dsp' && e[1] === 'vm' ? i : -1)).filter((i) => i >= 0).pop();
  const noticed = events.findIndex((e, i) => i > lastVm && e[0] === 'dsp' && e[1] === 'stale');
  const tail = events.slice(noticed + 1);
  assert.ok(noticed > lastVm, 'the close is noticed');
  assert.ok(tail.filter((e) => e[0] === 'read').length <= 7, 'closed: back to a read a second');
});
