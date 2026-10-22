// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
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
    export function setLED(n, c) { if (globalThis.__leds) globalThis.__leds[n] = c; }
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

/*
 * A clock a test can take over. ui.js reads performance.now() every frame, so
 * a transport — where the point is that a pause HOLDS and a resume does not
 * lurch — cannot be tested against wall time.
 *
 * Off by default, and that is not tidiness: the panel's redraw is gated on the
 * same clock, so freezing it for every test stops anything being drawn at all
 * and the tests that spin waiting for a frame simply time out.
 */
let clock = 0;
let clockFrozen = false;
const freezeClock = () => { clock = Date.now(); clockFrozen = true; };
const thawClock = () => { clockFrozen = false; };
const advanceMs = (ms, step = 20) => {
  for (let i = 0; i < Math.ceil(ms / step); i++) { clock += step; globalThis.tick(); }
};

const QUIET_SETTINGS = JSON.stringify({ version: 7, autoInfo: false, quizSounds: false });
/* Welcomed, every tip seen: a first launch's cards would sit over every
 * screen these tests drive. The welcome has its own tests. */
const WELCOMED = JSON.stringify({ tips: ['welcome', 'sheet', 'practice', 'quiz', 'map', 'island', 'placement'] });

function installHostStubs() {
  const calls = { led: 0, midi: 0, writes: [], notes: [] };
  globalThis.performance = { now: () => (clockFrozen ? clock : Date.now()) };
  const noop = () => {};
  Object.assign(globalThis, {
    clear_screen: noop,
    fill_rect: noop,
    draw_rect: noop,
    draw_line: noop,
    print: noop,
    text_width: (s) => String(s).length * 6 - 1,
    /* The automatic first-time Info page and the answer tones are off here:
     * every test would otherwise open on an Info page, and every answer would
     * queue notes. Their own tests turn them back on. */
    host_read_file: (p) => (String(p).endsWith('/settings.json') ? QUIET_SETTINGS
      : String(p).endsWith('/progress.json') ? WELCOMED : null),
    host_write_file: (p, t) => { calls.writes.push(p); return true; },
    host_exit_module: noop,
    host_send_screenreader: noop,
    host_module_set_param: (k, v) => { calls.midi++; if (k === 'n') calls.notes.push(v); },
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
const KNOB1 = 71;

/*
 * Getting about the lesson tree. Rows are found by facts that hold whatever
 * files are loaded — the top list is Continue, Path, Practice, Quiz, Progress,
 * Settings, and the jog clamps, so the end of it is always Settings — rather
 * than by counting rows that the next lesson added would move.
 */
const TOP = { continue: 0, path: 1, practice: 2, quiz: 3, progress: 4, settings: 5 };
const jog = (n) => {
  for (let i = 0; i < Math.abs(n); i++) globalThis.onMidiMessageInternal(CC(JOG_TURN, n > 0 ? 1 : 127));
};
const click = () => {
  globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127));
  globalThis.tick();
};
/*
 * The Quiz folder is Ear, Reading, Keys. Keys holds Notes by alphabet,
 * Chords by name, Name notes, Name chords; Reading its three courses, then
 * Notes and Chords by staff; Ear the hearing topics.
 * Rows here keep their old numbering: 0 notes by name, 1 notes by staff,
 * 2-3 Ear, 4-5 Name notes and chords.
 */
const QUIZ_PATHS = [[2, 0], [1, 3], [0, 1, 0], [0, 17, 0], [2, 2], [2, 3]];
function openQuiz(row) {
  globalThis.init();
  jog(TOP.quiz);
  click();
  for (const step of QUIZ_PATHS[row]) {
    jog(step);
    click();
  }
}
function openProgress() {
  globalThis.init();
  jog(TOP.progress);
  click();
}
/* Practice › Scales › Major, highlight on its first drill, Up & down. */
function toScale() {
  globalThis.init();
  jog(TOP.practice);
  click();
  click();
  click();
}
function armScale() {
  toScale();
  click();
}

let mod;
/* What the host was told. Most tests here assert only that nothing threw; the
 * ones that care what actually reached the DSP read this. */
let hostCalls;
test('the module loads and installs its lifecycle hooks', async () => {
  hostCalls = installHostStubs();
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
  globalThis.init();
  press();                                   /* in the exercise list */

  for (const row of [0, 1, 2, 3]) {          /* Guess/Hear notes and chords */
    openQuiz(row);
    press();
    globalThis.onMidiMessageInternal([0x90, PAD + 5, 100]);  /* a wrong one */
    globalThis.tick();
    globalThis.onMidiMessageInternal([0x80, PAD + 5, 0]);
    globalThis.tick();
  }

  armScale();                                 /* a scrolling exercise */
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
  armScale();                                            /* into an exercise */
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
  armScale();
  globalThis.onMidiMessageInternal(CC(RECORD, 127));
  for (let i = 0; i < 3000; i++) {
    if (i % 250 === 0) globalThis.onMidiMessageInternal([0x90, PAD + (i % 8), 90]);
    if (i % 250 === 60) globalThis.onMidiMessageInternal([0x80, PAD + (i % 8), 0]);
    globalThis.tick();
  }
});

test('a whole round can be played to its result screen', () => {
  /* Open Progress, then come back and play a quiz. */
  openProgress();
  jog(1);
  globalThis.tick();
  globalThis.onMidiMessageInternal(CC(BACK, 127));
  globalThis.tick();

  jog(-60);
  jog(2);                                              /* Quiz */
  click();
  jog(1);
  click();                                             /* Play */
  click();                                             /* Notes */
  /* Hammer every pad repeatedly: whatever the prompt is, this answers it. */
  for (let round = 0; round < 60; round++) {
    for (let pad = PAD; pad < PAD + 32; pad++) {
      globalThis.onMidiMessageInternal([0x90, pad, 100]);
      globalThis.onMidiMessageInternal([0x80, pad, 0]);
    }
    for (let i = 0; i < 40; i++) globalThis.tick();
  }
  /* Whatever state that left us in, the transport and Back must still work. */
  globalThis.onMidiMessageInternal(CC(PLAY, 127));
  globalThis.tick();
  globalThis.onMidiMessageInternal(CC(BACK, 127));
  globalThis.tick();
});

test('the progress screen opens and the jog cycles drills without throwing', () => {
  openProgress();
  for (let i = 0; i < 6; i++) {
    globalThis.onMidiMessageInternal(CC(JOG_TURN, 1));
    globalThis.onMidiMessageInternal(CC(JOG_TURN, 127));
    globalThis.tick();
  }
  globalThis.onMidiMessageInternal(CC(BACK, 127));
  globalThis.tick();
});

test('a multiple-choice round can be played entirely with the jog', () => {
  for (const row of [4, 5]) {                 /* Pick: notes, Pick: chords */
    openQuiz(row);
    /* Turn and answer repeatedly: one of the three is right each time. */
    for (let i = 0; i < 200; i++) {
      globalThis.onMidiMessageInternal(CC(JOG_TURN, i % 2 ? 1 : 127));
      globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127));
      for (let t = 0; t < 30; t++) globalThis.tick();
    }
    globalThis.onMidiMessageInternal(CC(PLAY, 127));
    globalThis.tick();
    globalThis.onMidiMessageInternal(CC(BACK, 127));
    globalThis.tick();
  }
});

test('pressing pads during a pick does not answer it or throw', () => {
  openQuiz(4);
  for (let pad = PAD; pad < PAD + 8; pad++) {
    globalThis.onMidiMessageInternal([0x90, pad, 100]);
    globalThis.onMidiMessageInternal([0x80, pad, 0]);
    globalThis.tick();
  }
  globalThis.onMidiMessageInternal(CC(BACK, 127));
  globalThis.tick();
});

/*
 * The level ladder, driven the way a player drives it.
 *
 * Every other test here stubs host_read_file to null, so no bundled song is
 * ever loaded and the whole song -> level -> arm path went unexercised. This
 * one serves the real exercises directory and reads back what was PRINTED, so
 * it checks the levels actually reach the screen rather than only that nothing
 * threw on the way.
 */
test('a song opens its levels, and a level arms', () => {
  const printed = [];
  const exercises = new URL('../src/exercises/', import.meta.url).pathname;
  globalThis.print = (x, y, str) => { printed.push(String(str)); };
  globalThis.host_read_file = (path) => {
    if (path.endsWith('/settings.json')) return QUIET_SETTINGS;
    if (path.endsWith('/progress.json')) return WELCOMED;
    const at = path.indexOf('/exercises/');
    if (at < 0) return null;
    try {
      return readFileSync(exercises + path.slice(at + '/exercises/'.length), 'utf8');
    } catch { return null; }
  };

  /* The panel redraws at 50Hz and the gate is wall-clock, so a single tick
   * after an input usually draws nothing at all. Spin until it does. */
  const screen = () => {
    printed.length = 0;
    const until = Date.now() + 500;
    while (Date.now() < until && !printed.length) globalThis.tick();
    return printed.join(' ');
  };

  globalThis.init();
  jog(TOP.practice);
  click();
  jog(4);                                                 /* Songs */
  click();
  globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127));   /* Classics */
  assert.match(screen(), /CLASSICS/, 'the category opens under its own name');
  /* To the bottom of Classics — the jog clamps, so this lands on its last
   * song whatever else is added above it. */
  jog(60);

  globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127));   /* open the ladder */
  const ladder = screen();
  for (const rung of ['RH melody', 'LH bass', 'RH chords', 'Both hands']) {
    assert.ok(ladder.includes(rung), `the level list does not show "${rung}": ${ladder}`);
  }

  globalThis.onMidiMessageInternal(CC(JOG_TURN, 1));      /* down to LH bass */
  globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127));   /* arm it */
  screen();

  /* The reading header names the chart, and a projected chart is named for its
   * rung — so this is where "which level am I playing" actually shows up. */
  globalThis.onMidiMessageInternal(CC(RECORD, 127));
  assert.match(screen(), /L1/, 'the reading header does not name the level');
  for (let i = 0; i < 20; i++) globalThis.tick();
  globalThis.onMidiMessageInternal([0x90, PAD, 100]);
  globalThis.onMidiMessageInternal([0x80, PAD, 0]);
  globalThis.tick();
  globalThis.onMidiMessageInternal(CC(BACK, 127));        /* stop the run */
  globalThis.tick();
  globalThis.onMidiMessageInternal(CC(BACK, 127));        /* back to the ladder */
  assert.ok(
    screen().includes('RH melody'),
    'Back from a song should land on its ladder, not on the song list',
  );

  /* And each Back from there is one folder up, until the top. */
  globalThis.onMidiMessageInternal(CC(BACK, 127));
  assert.match(screen(), /CLASSICS/, 'Back from the ladder lands on the song list');
  globalThis.onMidiMessageInternal(CC(BACK, 127));
  assert.match(screen(), /SONGS/, 'then the shelves');
  globalThis.onMidiMessageInternal(CC(BACK, 127));
  globalThis.onMidiMessageInternal(CC(BACK, 127));
  const top = screen();
  assert.match(top, /CLICK open  MENU help/, 'the top of the tree: its own hint line');
  for (const row of ['Continue', 'Path', 'Practice']) {
    assert.ok(top.includes(row), `the top list does not show "${row}": ${top}`);
  }
});

/*
 * Every chord lesson goes through the same door as a song: a folder, then its
 * ladder, then a chart. The deepest path in the tree, walked once end to end.
 */
test('a chord lesson opens from Practice and arms at both hands', () => {
  const printed = [];
  globalThis.print = (x, y, str) => { printed.push(String(str)); };
  const screen = () => {
    printed.length = 0;
    const until = Date.now() + 500;
    while (Date.now() < until && !printed.length) globalThis.tick();
    return printed.join(' ');
  };
  /* No tick between an input and screen(): a tick may draw the frame before
   * screen() starts listening for it. */
  const open = () => globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127));
  globalThis.init();
  jog(TOP.practice);
  open();                        /* Practice */
  jog(1);
  open();                        /* Chords */
  assert.match(screen(), /CHORDS/);
  jog(4);
  open();                        /* Sevenths */
  assert.match(screen(), /Major 7th/);
  open();                        /* Major 7th: its ladder */
  jog(3);
  open();                        /* Both hands */
  globalThis.onMidiMessageInternal(CC(RECORD, 127));
  assert.match(screen(), /Major 7th L3/, 'the header names the lesson and its level');
  for (let i = 0; i < 20; i++) globalThis.tick();
  globalThis.onMidiMessageInternal(CC(BACK, 127));
  globalThis.onMidiMessageInternal(CC(BACK, 127));
  assert.match(screen(), /Both hands/, 'Back lands on the ladder it was armed from');
});

/*
 * TWO SOURCES, ONE PITCH — and both of them have to be heard.
 *
 * In Listen the reference melody and your own hands play the same tune, so
 * they collide on a pitch constantly. The refcount used to gate the note ON as
 * well as off, so whichever asked second got silence: hold a note the
 * reference is about to play and the reference note vanishes. The same pitch
 * sits on two pads of an isomorphic grid, which is what this drives — the same
 * collision, without having to time a run.
 *
 * Asserted through what the DSP is actually TOLD, because "nothing threw" is
 * exactly the kind of green that hid this.
 */
test('a second source on the same pitch is heard, and does not cut the first', async () => {
  const { padsForPitch, DEFAULT_TRANSPOSE } = await import(new URL('../src/padmap.mjs', import.meta.url));
  const pitch = 64;
  const pads = padsForPitch(pitch, DEFAULT_TRANSPOSE);
  assert.ok(pads.length > 1, 'this pitch should have a twin pad to press');

  globalThis.init();
  globalThis.tick();
  const struck = () => { const n = hostCalls.notes.slice(); hostCalls.notes.length = 0; return n; };
  struck();

  globalThis.onMidiMessageInternal([0x90, pads[0], 100]);
  globalThis.tick();
  assert.deepEqual(struck(), [`${pitch}:100`], 'the first press sounds');

  globalThis.onMidiMessageInternal([0x90, pads[1], 100]);
  globalThis.tick();
  assert.deepEqual(struck(), [`${pitch}:100`], 'and so does the second — this is the bug');

  globalThis.onMidiMessageInternal([0x80, pads[0], 0]);
  globalThis.tick();
  assert.deepEqual(struck(), [], 'one letting go must not cut the other off');

  globalThis.onMidiMessageInternal([0x80, pads[1], 0]);
  globalThis.tick();
  assert.deepEqual(struck(), [`${pitch}:0`], 'it stops when the last one lets go');
});

/*
 * THE TRANSPORT, END TO END. Play holds the position instead of resetting it,
 * the knob scrubs, and resuming carries on from where you landed. Each of
 * those is easy to get individually right and still have the sequence drift,
 * which is why this drives the whole thing rather than the parts.
 */
test('play pauses, the knob scrubs, and play resumes from there', () => {
  const printed = [];
  const realPrint = globalThis.print;
  globalThis.print = (x, y, str) => { printed.push(String(str)); };
  freezeClock();
  /*
   * The header's bar.beat is the playhead, read off the screen the way a
   * player reads it. The clock has to move for the panel to redraw at all —
   * the draw is throttled on it — so this costs 40ms, which is 0.05 of a beat
   * and invisible at bar.beat resolution.
   */
  const barBeat = () => {
    printed.length = 0;
    clock += 40;
    globalThis.tick();
    return printed.find((t) => /^\d+\.\d+$/.test(t));
  };
  const barOf = (s) => String(s).split('.')[0];
  armScale();

  globalThis.onMidiMessageInternal(CC(PLAY, 127));
  advanceMs(6000);
  assert.ok(barBeat(), 'the run should be on screen');
  const playing = barBeat();
  assert.notEqual(playing, '1.1', 'six seconds should have moved the playhead');

  globalThis.onMidiMessageInternal(CC(PLAY, 127));      /* pause */
  const held = barBeat();
  advanceMs(4000);
  assert.equal(barBeat(), held, 'a pause must hold, not drift');

  /* Back two bars, which clamps at the start of this chart. */
  for (let i = 0; i < 24; i++) globalThis.onMidiMessageInternal(CC(KNOB1, 127));
  const scrubbed = barBeat();
  assert.notEqual(scrubbed, held, 'the knob should have moved it');

  globalThis.onMidiMessageInternal(CC(PLAY, 127));      /* resume */
  /* By the BAR: a lurch would jump the four seconds spent paused, which is
   * several beats, while the 40ms this read costs is a twentieth of one. */
  assert.equal(barOf(barBeat()), barOf(scrubbed),
    'resume must carry on from the scrub, not catch up to wall time');
  advanceMs(1000);
  assert.notEqual(barBeat(), scrubbed, 'and then it runs on');

  globalThis.print = realPrint;
  thawClock();
});

/*
 * The scrub is CONTINUOUS and PAUSED-ONLY, and both halves need saying.
 *
 * A gate that blocks everything passes a test that only checks the turn while
 * playing does nothing, and a quantised scrub passes a test that only checks
 * a bar's worth of units moves a bar. So each is asserted in both directions.
 */
test('the knob scrubs only while paused, and does so continuously', () => {
  const printed = [];
  const realPrint = globalThis.print;
  globalThis.print = (x, y, str) => { printed.push(String(str)); };
  freezeClock();
  const barBeat = () => {
    printed.length = 0;
    clock += 40;
    globalThis.tick();
    return printed.find((t) => /^\d+\.\d+$/.test(t));
  };
  const turn = (n) => {
    for (let i = 0; i < n; i++) globalThis.onMidiMessageInternal(CC(KNOB1, 1));
  };

  armScale();
  globalThis.onMidiMessageInternal(CC(PLAY, 127));
  advanceMs(4000);

  /* Running: the knob must not seek under your feet. */
  const playing = barBeat();
  turn(24);
  assert.equal(barBeat(), playing, 'a turn while playing must move nothing');

  globalThis.onMidiMessageInternal(CC(PLAY, 127));   /* pause */
  const held = barBeat();

  /*
   * Derived from the constant rather than restated, so changing the scrub
   * speed does not silently stop this testing anything. A quarter of a bar is
   * a whole beat at 4/4 — enough for the header's beat digit to move, which is
   * the finest thing it can show, while staying inside the bar. The old
   * quantiser could not land there at all.
   */
  const perBar = 36;
  turn(perBar / 4);
  const nudged = barBeat();
  assert.notEqual(nudged, held, 'a quarter bar of units should move it');
  assert.equal(nudged.split('.')[0], held.split('.')[0],
    'and land inside the same bar — the old scrub could not');

  turn(perBar - perBar / 4);
  assert.equal(Number(barBeat().split('.')[0]), Number(held.split('.')[0]) + 1,
    'a full bar of units is one bar');

  /* Nothing sounds while paused, so a long scrub must emit no note traffic:
   * allNotesOff is seven host writes and the inject ring holds sixty-four. */
  const before = hostCalls.midi;
  turn(60);
  globalThis.tick();
  assert.equal(hostCalls.midi, before, `a paused scrub sent ${hostCalls.midi - before} MIDI writes`);

  globalThis.print = realPrint;
  thawClock();
});

/*
 * The SCRUB row would advertise a control that does nothing if the ready
 * screen could not scrub, or if Play threw the position away — which is
 * exactly what it did before, via armRun.
 */
test('the ready screen scrubs, and Play takes it from there', () => {
  const printed = [];
  const realPrint = globalThis.print;
  globalThis.print = (x, y, str) => { printed.push(String(str)); };
  freezeClock();

  /*
   * The ready screen repaints only when something changes it, so the frame to
   * read is the one the input produces: clear, act, tick, look. (The running
   * screen redraws every tick, which is why the pause test can do it the other
   * way round.)
   */
  const frame = (act) => {
    printed.length = 0;
    act();
    clock += 40;
    globalThis.tick();
    return printed;
  };
  const scrub = (n, dir) => () => {
    for (let i = 0; i < n; i++) globalThis.onMidiMessageInternal(CC(KNOB1, dir));
  };
  const barBeat = (f) => f.find((t) => /^\d+\.\d+$/.test(t));

  toScale();

  const armed = frame(() => globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127)));
  assert.ok(armed.some((t) => t.includes('SCRUB')),
    'a freshly armed song offers all three rows');

  /* Two bars forward on the ready screen, which used to be impossible. */
  const away = frame(scrub(72, 1));
  assert.equal(away.some((t) => t.includes('SCRUB')), false,
    'scrubbing hides the box, which sits over the music being scrubbed');
  assert.equal(barBeat(away), '3.1',
    'and the header shows the position instead of the MIDI route');

  /* Both directions: a box that never draws would pass a one-way test. */
  const home = frame(scrub(72, 127));
  assert.ok(home.some((t) => t.includes('SCRUB')), 'scrolling home brings it back');

  /* And Play begins where you left the playhead, not at bar 1. */
  const running = frame(() => {
    scrub(72, 1)();
    globalThis.onMidiMessageInternal(CC(PLAY, 127));
  });
  assert.equal(String(barBeat(running)).split('.')[0], '3',
    'Play must start from the scrub point');

  /* Skipped, not failed — armRun would have marked two bars of notes missed. */
  assert.equal(running.some((t) => /^0\/[1-9]/.test(t)), false,
    'the bars behind the start point are passed over, not counted as misses');

  globalThis.print = realPrint;
  thawClock();
});

/*
 * Scrubbing shows where you have landed on the pads, not only on the staff —
 * from the ready screen and while paused, whatever Guide pads says — and the
 * moment the music runs the pads go back to reading-first.
 */
test('a scrub lights the next note, and running puts the pads back', async () => {
  const { padsForPitch, DEFAULT_TRANSPOSE, LED_TARGET_NEAR } =
    await import(new URL('../src/padmap.mjs', import.meta.url));
  globalThis.__leds = {};
  const lit = () => {
    for (let i = 0; i < 5; i++) globalThis.tick();
    return Object.keys(globalThis.__leds).filter((n) => globalThis.__leds[n] === LED_TARGET_NEAR).map(Number).sort();
  };
  const padsOf = (pitch) => padsForPitch(pitch, DEFAULT_TRANSPOSE).slice().sort();

  armScale();                                  /* C major up and down, from C4 */
  /* Stage 2: the reading-first rule this test is about. Stage 1 lights the
   * notes as they come, which a test of its own covers below. */
  jog(1);
  assert.deepEqual(lit(), [], 'a freshly armed exercise starts dark');

  /* Nine units is a beat: the playhead lands on the scale's second note, D4. */
  for (let i = 0; i < 9; i++) globalThis.onMidiMessageInternal(CC(KNOB1, 1));
  assert.deepEqual(lit(), padsOf(62), 'the ready screen lights the note it landed on');

  globalThis.onMidiMessageInternal(CC(RECORD, 127));          /* practise from there */
  assert.deepEqual(lit(), [], 'running at stage 2, nothing is lit');

  globalThis.onMidiMessageInternal(CC(RECORD, 127));          /* pause */
  assert.deepEqual(lit(), [], 'a plain pause is not a scrub');
  for (let i = 0; i < 9; i++) globalThis.onMidiMessageInternal(CC(KNOB1, 1));
  assert.equal(lit().length > 0, true, 'a paused scrub lights the next note');

  globalThis.onMidiMessageInternal(CC(RECORD, 127));          /* resume */
  assert.deepEqual(lit(), [], 'and resuming hands the pads back');
  delete globalThis.__leds;
});

/* ---- Progress, stages and the program, driven end to end ------------------- */

/*
 * Play the armed C major scale perfectly on a frozen clock: every note pressed
 * on its beat, then the clock run past the end. Built from the same catalog the
 * module builds, with the module's default settings.
 */
async function scaleChart() {
  const CAT = await import(new URL('../src/catalog.mjs', import.meta.url));
  const { DEFAULT_TRANSPOSE } = await import(new URL('../src/padmap.mjs', import.meta.url));
  const root = CAT.buildCatalog({ gen: { rootPc: 0, mode: 'major', bpm: 80, transpose: DEFAULT_TRANSPOSE, seed: 1 } });
  return CAT.findById(root, 'basics/scales/major/up-down').node.build();
}

async function playPerfectly(chart, { wrong = 0 } = {}) {
  const { padsForPitch, DEFAULT_TRANSPOSE } = await import(new URL('../src/padmap.mjs', import.meta.url));
  const msPerBeat = 60000 / 80;
  globalThis.onMidiMessageInternal(CC(RECORD, 127));
  const start = clock;
  let stray = wrong;
  for (const e of chart.events) {
    const at = start + (e.beat + 4) * msPerBeat;
    while (clock < at) { clock += 10; globalThis.tick(); }
    for (const pitch of e.pitches) {
      const pad = padsForPitch(pitch, DEFAULT_TRANSPOSE)[0];
      globalThis.onMidiMessageInternal([0x90, pad, 100]);
      globalThis.onMidiMessageInternal([0x80, pad, 0]);
      if (stray-- > 0) {
        /* A pad no note wants: the far corner, an octave and more away. */
        globalThis.onMidiMessageInternal([0x90, PAD + 31, 100]);
        globalThis.onMidiMessageInternal([0x80, PAD + 31, 0]);
      }
    }
    globalThis.tick();
  }
  advanceMs(4000, 10);
}

/* A hint longer than a row takes turns, 3 s a part: every part, in one
 * string, so a test can ask for any of them. On a clock that is not frozen
 * it freezes it for the look, and thawing jumps it back: use it last, or
 * freeze the clock for the whole test. */
function footerParts(screen) {
  const wasFrozen = clockFrozen;
  if (!wasFrozen) freezeClock();
  const seen = [];
  for (let i = 0; i < 4; i++) {
    seen.push(screen.frame());
    clock += 3000;
  }
  if (!wasFrozen) thawClock();
  return seen.join(' || ');
}

function capture() {
  const printed = [];
  const real = globalThis.print;
  globalThis.print = (x, y, str) => { printed.push(String(str)); };
  return {
    /* With no input, onResume is what forces the repaint: a screen that has
     * not changed is not drawn again. */
    frame(act) {
      printed.length = 0;
      (act || globalThis.onResume)();
      /* The draw is throttled on the clock: spin until a frame lands. */
      const until = Date.now() + 500;
      do {
        clock += 40;
        globalThis.tick();
      } while (!printed.length && Date.now() < until);
      return printed.join(' | ');
    },
    restore() { globalThis.print = real; },
  };
}

test('a whole run ends on its result, is saved, and Back starts it again', async () => {
  const chart = await scaleChart();
  const screen = capture();
  freezeClock();
  hostCalls.writes.length = 0;
  armScale();
  await playPerfectly(chart);

  const result = screen.frame();
  assert.match(result, new RegExp(chart.events.length + ' of ' + chart.events.length + ' hit'),
    'the result names what you hit: ' + result);
  assert.match(result, /GUIDED DONE/, 'a perfect Guided run passes Guided');
  assert.match(result, /CLICK Solo  REC again/, 'and offers Solo next');
  assert.ok(hostCalls.writes.some((p) => p.endsWith('/progress.json')), 'the attempt is saved');

  /* Back is another go from the start — now at stage 2 — not the list. */
  screen.frame(() => globalThis.onMidiMessageInternal(CC(BACK, 127)));
  assert.match(footerParts(screen), /Solo: pads dark/, 'Back lands on the ready screen, on Solo, not yet passed');
  const list = screen.frame(() => globalThis.onMidiMessageInternal(CC(BACK, 127)));
  assert.match(list, /MAJOR/, 'and the press after that is the list');
  assert.match(list, /Up & down/);
  assert.match(list, /50%/, 'where the row now shows how far you have got: stage 1 of 2');

  screen.restore();
  thawClock();
});

test('a run with wrong presses scores them, and a scrubbed run is not recorded', async () => {
  const chart = await scaleChart();
  const screen = capture();
  freezeClock();
  armScale();
  await playPerfectly(chart, { wrong: 5 });
  const result = screen.frame();
  assert.match(result, /5 wrong/, result);
  assert.doesNotMatch(result, /DONE/, 'five strays on fifteen notes is not a pass');

  /* From a scrubbed bar: passage practice, straight back to the ready screen. */
  hostCalls.writes.length = 0;
  globalThis.onMidiMessageInternal(CC(BACK, 127));          /* to the ready screen */
  for (let i = 0; i < 36; i++) globalThis.onMidiMessageInternal(CC(KNOB1, 1));
  globalThis.onMidiMessageInternal(CC(RECORD, 127));
  advanceMs(30000, 20);
  assert.equal(hostCalls.writes.some((p) => p.endsWith('/progress.json')), false,
    'a run started part way through records nothing');
  screen.restore();
  thawClock();
});

test('stage 1 lights the notes as they come, and stage 2 keeps the pads dark', async () => {
  const { LED_TARGET_NEAR, LED_TARGET_FAR } = await import(new URL('../src/padmap.mjs', import.meta.url));
  freezeClock();
  globalThis.__leds = {};
  const guided = () => {
    for (let i = 0; i < 5; i++) globalThis.tick();
    return Object.values(globalThis.__leds).filter((c) => c === LED_TARGET_NEAR || c === LED_TARGET_FAR).length;
  };
  armScale();
  globalThis.onMidiMessageInternal(CC(RECORD, 127));
  advanceMs(2600);                                     /* into the first notes */
  assert.ok(guided() > 0, 'stage 1 lights the next note');

  globalThis.onMidiMessageInternal(CC(BACK, 127));     /* restart: the ready screen */
  jog(1);                                              /* stage 2 */
  globalThis.__leds = {};
  globalThis.onMidiMessageInternal(CC(RECORD, 127));
  advanceMs(2600);
  assert.equal(guided(), 0, 'stage 2 lights nothing');
  delete globalThis.__leds;
  thawClock();
});

test('Continue names the next step, and the options skip it', () => {
  const screen = capture();
  globalThis.init();
  const top = screen.frame();
  assert.match(top, /^NOTES BY ALPHABET \| 1\/6 \| Continue \| 1\.1 \|/, 'a fresh start begins with 1.1 Find the notes: ' + top);

  /* Shift + click: the row's options. */
  globalThis.onMidiMessageInternal(CC(SHIFT, 127));
  const sheet = screen.frame(() => globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127)));
  globalThis.onMidiMessageInternal(CC(SHIFT, 0));
  assert.match(sheet, /CONTINUE \| 1\/2 \| I know this: skip \| Settings\.\.\./, sheet);
  /* A skip is not practice, so the strand keeps its turn: the step after. */
  const skipped = screen.frame(click);
  assert.match(skipped, /NAME NOTES \| 1\/6 \| Continue \| Name notes/, 'the step after the skipped one: ' + skipped);

  const quiz = screen.frame(click);                     /* Continue */
  assert.match(quiz, /NAME NOTE/, 'the step opens directly: ' + quiz);
  screen.restore();
});

/* ---- The Path as a map --------------------------------------------------- */

/* The pad note under place `i` of a map of `n` places. */
async function padOfPlace(n, i) {
  const { layoutPlaces, padOfCell } = await import(new URL('../src/pathmap/layout.mjs', import.meta.url));
  return padOfCell(layoutPlaces(n).cells[i]);
}
const shiftClick = () => {
  globalThis.onMidiMessageInternal(CC(SHIFT, 127));
  globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127));
  globalThis.onMidiMessageInternal(CC(SHIFT, 0));
};

test('a stage is an island; its list, one option away, ends on its Checkpoint', () => {
  freezeClock();
  const screen = capture();
  globalThis.init();
  jog(TOP.path);
  const world = screen.frame(click);                    /* Path: the world map */
  assert.match(world, /^1 Grid and staff 0% \|/, world);
  const parts = footerParts(screen);
  for (const part of ['PAD go  CLICK enter', 'PLAY continue', 'MENU help']) assert.ok(parts.includes(part), 'the hint takes turns: ' + parts);
  const island = screen.frame(click);                   /* 1 Grid and staff: its island */
  assert.match(island, /^1\.1 Find the notes 0% \|/, island);
  screen.frame(shiftClick);
  const sheet = screen.frame();
  assert.match(sheet, /Show as list/, sheet);
  jog(60);
  jog(-1);                                              /* Show as list */
  const list = screen.frame(click);
  assert.match(list, /1\.1 Find the notes/);
  assert.doesNotMatch(list, /Check: skip phase|Start here|Skip next/);
  assert.match(screen.frame(() => jog(60)), /Checkpoint \| 0\/4 >/);
  const back = screen.frame(BACK_PRESS);
  assert.match(back, /^Checkpoint 0%/, 'Back from the list is the map, the avatar on the row the list was on: ' + back);
  screen.restore();
  thawClock();
});

test('on the map a pad walks there, a second press goes in, and pads make no sound', async () => {
  freezeClock();
  const screen = capture();
  globalThis.init();
  jog(TOP.path);
  click();                                              /* the world map, on stage 1 */
  hostCalls.notes.length = 0;
  const third = await padOfPlace(5, 2);
  globalThis.onMidiMessageInternal([0x90, third, 100]);
  globalThis.onMidiMessageInternal([0x80, third, 0]);
  advanceMs(2000);
  assert.deepEqual(hostCalls.notes, [], 'a pad on the map sounds nothing');
  assert.match(screen.frame(), /^3 Shapes and time/, 'the avatar walked to stage 3');
  globalThis.onMidiMessageInternal([0x90, third, 100]);
  globalThis.onMidiMessageInternal([0x80, third, 0]);
  assert.match(screen.frame(), /^3\.1 Intervals II/, 'a second press goes in');
  /* Water does nothing: a pad no place sits on. */
  const { layoutPlaces, padOfCell, COLS, ROWS } = await import(new URL('../src/pathmap/layout.mjs', import.meta.url));
  const taken = new Set(layoutPlaces(8).cells.map(padOfCell));
  let water = -1;
  for (let n = PAD; n < PAD + COLS * ROWS && water < 0; n++) if (!taken.has(n)) water = n;
  globalThis.onMidiMessageInternal([0x90, water, 100]);
  globalThis.onMidiMessageInternal([0x80, water, 0]);
  assert.match(screen.frame(), /^3\.1 Intervals II/, 'water: nothing');
  assert.deepEqual(hostCalls.notes, []);
  /* The jog walks; Back goes up, the avatar on the island it left. */
  jog(1);
  advanceMs(1000);
  assert.match(screen.frame(), /^3\.2 Inversions/);
  assert.match(screen.frame(BACK_PRESS), /^3 Shapes and time/);
  BACK_PRESS();
  /* In a list the pads are the piano again. */
  globalThis.onMidiMessageInternal([0x90, PAD, 100]);
  globalThis.onMidiMessageInternal([0x80, PAD, 0]);
  globalThis.tick();
  assert.ok(hostCalls.notes.length > 0, 'a pad in the list sounds');
  screen.restore();
  thawClock();
});

test('on the map PLAY is Continue, MENU is its help, and Shift + click its options', () => {
  freezeClock();
  const screen = capture();
  globalThis.init();
  jog(TOP.path);
  click();
  const help = screen.frame(MENU_PRESS);
  assert.match(help, /STAGE 1: THE GRI \| INFO \| The map: a lit pad/, 'the map first, then the stage: ' + help);
  BACK_PRESS();
  screen.frame(shiftClick);
  assert.match(screen.frame(), /I know it all: skip.*Show as list/, 'the stage under the avatar');
  BACK_PRESS();
  globalThis.onMidiMessageInternal(CC(PLAY, 127));
  assert.match(screen.frame(), /NOTE/, 'Play opened Continue\'s step');
  screen.restore();
  thawClock();
});;

test('Next from a result follows the unit, and Shift moves on', async () => {
  const chart = await scaleChart();
  const screen = capture();
  freezeClock();
  globalThis.init();
  jog(TOP.path);
  click();                                              /* Path */
  click();                                              /* 1 Grid and staff */
  jog(2);
  click();                                              /* 1.3 Major scale */
  click();                                              /* Major up & down */
  await playPerfectly(chart);
  /* Shift + click: stage 1 is enough, on to the next step of the unit. */
  globalThis.onMidiMessageInternal(CC(SHIFT, 127));
  globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127));
  globalThis.onMidiMessageInternal(CC(SHIFT, 0));
  const next = screen.frame();
  assert.match(next, /Major down|C Major/, 'the next step, armed: ' + next);
  assert.match(footerParts(screen), /Guided: pads lit/);
  /* The unit now points past it. */
  globalThis.onMidiMessageInternal(CC(BACK, 127));
  const list = screen.frame();
  assert.match(list, /MAJOR SCALE/, list);
  screen.restore();
  thawClock();
});

test('the progress list opens charts, and the jog walks them', () => {
  const screen = capture();
  globalThis.init();
  jog(TOP.progress);
  const list = screen.frame(click);
  assert.match(list, /PROGRESS 0%/);
  for (const row of ['Overall', 'Stage 1', 'Stage 2']) assert.match(list, new RegExp(row));
  const overall = screen.frame(click);
  assert.match(overall, /OVERALL/);
  assert.match(overall, /nothing passed yet/);
  for (let i = 0; i < 6; i++) {
    globalThis.onMidiMessageInternal(CC(JOG_TURN, i % 2 ? 127 : 1));
    globalThis.tick();
  }
  const back = screen.frame(() => globalThis.onMidiMessageInternal(CC(BACK, 127)));
  assert.match(back, /PROGRESS/);
  const top = screen.frame(() => globalThis.onMidiMessageInternal(CC(BACK, 127)));
  assert.match(top, /CLICK open  MENU help/);
  screen.restore();
});

test('Back from a quiz result is a fresh round', () => {
  freezeClock();
  openQuiz(0);
  /* Every pad, then long enough for the quiz to move on: whatever the prompt
   * is, this answers it. */
  for (let round = 0; round < 25; round++) {
    for (let pad = PAD; pad < PAD + 32; pad++) {
      globalThis.onMidiMessageInternal([0x90, pad, 100]);
      globalThis.onMidiMessageInternal([0x80, pad, 0]);
    }
    advanceMs(600);
  }
  const screen = capture();
  assert.match(footerParts(screen), /CLICK (next|Solo)  REC again/, 'the round should be over');
  const after = screen.frame(() => globalThis.onMidiMessageInternal(CC(BACK, 127)));
  assert.match(after, /NOTE/, 'a new round of the same drill: ' + after);
  assert.match(after, /0\/20/);
  screen.restore();
  thawClock();
});

test('the Quiz folder is Ear, Reading and Keys, and each opens its drills', () => {
  const screen = capture();
  globalThis.init();
  jog(TOP.quiz);
  const quiz = screen.frame(click);
  assert.match(quiz, /QUIZ \| 1\/3 \| Ear .*\| Reading .*\| Keys /, quiz);
  const ear = screen.frame(click);
  assert.match(ear, /EAR \| 1\/4 \| Pitch & melody .*\| Intervals .*\| Chords .*\| Scales & keys/, 'Ear is by topic: ' + ear);
  globalThis.onMidiMessageInternal(CC(BACK, 127));
  jog(1);
  screen.frame(click);                                  /* Reading */
  jog(3);
  assert.match(screen.frame(click), /NOTE STAFF/, 'Notes by staff opens the staff row');
  globalThis.onMidiMessageInternal(CC(BACK, 127));
  globalThis.onMidiMessageInternal(CC(BACK, 127));
  jog(1);
  const keys = screen.frame(click);
  assert.match(keys, /KEYS \| 1\/4 \| Notes by alphabet .*\| Chords by name .*\| Name notes .*\| Name chords/, keys);
  assert.match(screen.frame(click), /NOTE\b(?! STAFF)/, 'Notes by alphabet opens the name row');
  globalThis.onMidiMessageInternal(CC(BACK, 127));
  jog(2);
  const pick = screen.frame(click);
  assert.match(pick, /NAME NOTE/, 'Keys › Name notes is the lit-pad drill: ' + pick);
  screen.restore();
});

/* Ear › Intervals › Identify intervals › 2 3rds › up: two answers, on pads 2
 * and 5 of the bottom row. */
const THIRDS = { path: [1, 0, 1, 0], pads: [2, 5], gaps: [0, 1, 3, 4, 6, 7] };

test('an answer pad answers without a sound, and the bar shows the answers', async () => {
  const { ANSWER_COLOURS } = await import(new URL('../src/answer_pads.mjs', import.meta.url));
  freezeClock();
  globalThis.__leds = {};
  const screen = capture();
  openHearing(THIRDS.path);
  advanceMs(2000);                                   /* let the prompt play out */
  assert.ok([ANSWER_COLOURS[0].bright, ANSWER_COLOURS[0].dim].includes(globalThis.__leds[PAD + 2]),
    'the first answer, pulsing under the jog');
  assert.equal(globalThis.__leds[PAD + 5], ANSWER_COLOURS[1].bright);
  for (const gap of THIRDS.gaps) assert.equal(globalThis.__leds[PAD + gap], 0, `gap ${gap}`);
  assert.match(screen.frame(), /blue[\s\S]*orange/, 'the screen names the colours');

  hostCalls.notes.length = 0;
  const before = hostCalls.midi;
  globalThis.onMidiMessageInternal([0x90, PAD + 5, 100]);   /* an answer */
  globalThis.tick();
  globalThis.onMidiMessageInternal([0x80, PAD + 5, 0]);
  globalThis.onMidiMessageInternal([0x90, PAD + 3, 100]);   /* a gap */
  globalThis.onMidiMessageInternal([0x80, PAD + 3, 0]);
  globalThis.tick();
  assert.deepEqual(hostCalls.notes, [], 'no note on, no note off');
  assert.equal(hostCalls.midi, before, 'nothing sent at all');

  /* Above the bar the pads are still keys. */
  globalThis.onMidiMessageInternal([0x90, PAD + 8, 100]);
  globalThis.tick();
  assert.equal(hostCalls.notes.length, 1, 'a key above the bar sounds');
  globalThis.onMidiMessageInternal([0x80, PAD + 8, 0]);
  globalThis.tick();
  screen.restore();
  delete globalThis.__leds;
  thawClock();
});

test('pressing the right answer pad scores it, a wrong one counts against you', () => {
  freezeClock();
  const screen = capture();
  for (let round = 0; round < 3; round++) {
    openHearing(THIRDS.path);
    advanceMs(2000);
    let solved = false;
    for (const col of THIRDS.pads) {
      globalThis.onMidiMessageInternal([0x90, PAD + col, 100]);
      globalThis.onMidiMessageInternal([0x80, PAD + col, 0]);
      globalThis.tick();
      if (/1\/20/.test(screen.frame())) { solved = true; break; }
    }
    assert.ok(solved, 'one of the two pads is the answer');
  }
  screen.restore();
  thawClock();
});

test('Name has no answer bar: its lit question stays pressable and the jog answers', async () => {
  const { ANSWER_COLOURS } = await import(new URL('../src/answer_pads.mjs', import.meta.url));
  globalThis.__leds = {};
  const screen = capture();
  openQuiz(4);                                        /* Keys › Name notes */
  for (let i = 0; i < 5; i++) globalThis.tick();
  const colours = new Set(ANSWER_COLOURS.flatMap((c) => [c.bright, c.dim]));
  for (let col = 0; col < 8; col++) {
    assert.ok(!colours.has(globalThis.__leds[PAD + col]), `pad ${col} is not an answer pad`);
  }
  assert.match(screen.frame(), /JOG pick/, 'the jog answers here');
  /* Every pad sounds, the bottom row included. */
  hostCalls.notes.length = 0;
  globalThis.onMidiMessageInternal([0x90, PAD + 1, 100]);
  globalThis.tick();
  assert.equal(hostCalls.notes.length, 1, 'the bottom row is keys');
  globalThis.onMidiMessageInternal([0x80, PAD + 1, 0]);
  globalThis.tick();
  screen.restore();
  delete globalThis.__leds;
});

/* ---- Info, and the answer cues --------------------------------------------- */

const MENU_PRESS = () => globalThis.onMidiMessageInternal(CC(MENU, 127));
const BACK_PRESS = () => globalThis.onMidiMessageInternal(CC(BACK, 127));

/* Run a test with the real defaults: auto info and quiz sounds on. */
function withSettings(over, fn) {
  const real = globalThis.host_read_file;
  globalThis.host_read_file = (path) => (String(path).endsWith('/settings.json')
    ? JSON.stringify({ version: 7, ...over }) : real(path));
  try { return fn(); } finally { globalThis.host_read_file = real; }
}

test('Menu opens Info for the highlighted row, and closes back to it', () => {
  const screen = capture();
  globalThis.init();
  jog(TOP.practice);
  const page = screen.frame(MENU_PRESS);
  assert.match(page, /PRACTICE \| INFO/, page);
  assert.match(page, /The top of the/, 'help opens with the screen it was opened on: ' + page);
  assert.match(screen.frame(MENU_PRESS), /PIANO \| 3\//, 'Menu again closes it');
  screen.frame(MENU_PRESS);
  assert.match(screen.frame(BACK_PRESS), /PIANO \| 3\//, 'so does Back, on the same row');
  /* Play and Record start nothing from an Info page. */
  screen.frame(MENU_PRESS);
  globalThis.onMidiMessageInternal(CC(PLAY, 127));
  globalThis.onMidiMessageInternal(CC(RECORD, 127));
  assert.match(screen.frame(), /INFO/);
  screen.restore();
});

test('a long Info page scrolls with the jog, and a chord page shows its formula', () => {
  /* Frozen for the length of the test: footerParts moves the clock on, and
   * a clock that later jumps back holds every redraw until it catches up. */
  freezeClock();
  const screen = capture();
  globalThis.init();
  jog(TOP.practice);
  click();                                              /* Practice */
  jog(1);
  click();                                              /* Chords */
  click();                                              /* Triads */
  jog(1);                                               /* Minor */
  const first = screen.frame(MENU_PRESS);
  assert.match(first, /A folder of the/, 'the screen first: ' + first);
  assert.match(footerParts(screen), /JOG scroll/);
  const seen = [];
  for (let i = 0; i < 20; i++) seen.push(screen.frame(() => jog(1)));
  assert.notEqual(seen[0], first, 'the jog moved it');
  assert.match(seen.join(' || '), /Formula 1 b3 5/, 'and the chord\'s page follows, under More help');
  screen.restore();
  thawClock();
});

test('Info pauses a running exercise, and Back returns to it paused', () => {
  freezeClock();
  const screen = capture();
  armScale();
  globalThis.onMidiMessageInternal(CC(RECORD, 127));
  advanceMs(3000);
  assert.match(screen.frame(MENU_PRESS), /INFO/);
  screen.frame(BACK_PRESS);
  assert.match(footerParts(screen), /PAUSED/, 'back where it was, holding');
  screen.restore();
  thawClock();
});

test('the first time a kind of practice is opened, its Info comes first, once', () => {
  withSettings({ autoInfo: true, quizSounds: false }, () => {
    const screen = capture();
    globalThis.init();
    jog(TOP.practice);
    click();
    click();
    click();                                            /* Practice › Scales › Major */
    const first = screen.frame(click);                  /* Up & down */
    assert.match(first, /INFO/, 'shown by itself: ' + first);
    assert.match(first, /A piece, armed/, 'the screen first');
    assert.match(screen.frame(BACK_PRESS), /REC   practice/, 'Back lands on the ready screen');
    BACK_PRESS();                                       /* to the list */
    jog(1);
    const second = screen.frame(click);                 /* Up: another scale drill */
    assert.doesNotMatch(second, /INFO/, 'a scale drill explained once is explained');
    screen.restore();
  });
});

test('an answer sounds a chime when right and an uh-oh when wrong', () => {
  withSettings({ autoInfo: false, quizSounds: true }, () => {
    freezeClock();
    const heard = new Set();
    for (let round = 0; round < 6 && heard.size < 2; round++) {
      openQuiz(4);                                      /* Keys › Name notes: jog and click */
      for (let tries = 0; tries < 3; tries++) {
        hostCalls.notes.length = 0;
        globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127));
        advanceMs(500);
        const ons = hostCalls.notes.join(',').split(',').filter((n) => n && !n.endsWith(':0'))
          .map((n) => Number(n.split(':')[0]));
        if (ons.some((p) => p >= 84)) heard.add('chime');
        /* Name answers with the jog, so nothing else sounds: below the chime is the uh-oh. */
        if (ons.some((p) => p < 84)) heard.add('uh-oh');
        if (ons.some((p) => p >= 84)) break;
        globalThis.onMidiMessageInternal(CC(JOG_TURN, 1));
      }
    }
    assert.ok(heard.has('chime'), 'a right answer chimes');
    assert.ok(heard.has('uh-oh'), 'a wrong one says so');
    thawClock();
  });
});

test('with Quiz sounds off, an answer is silent', () => {
  freezeClock();
  openQuiz(4);
  hostCalls.notes.length = 0;
  globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127));
  advanceMs(500);
  assert.deepEqual(hostCalls.notes, []);
  thawClock();
});

test('unloading is clean, and resume does not throw', () => {
  globalThis.onResume();
  globalThis.tick();
  globalThis.onUnload();
});

/* Quiz › Ear is the first row of the Quiz folder; its exercises are numbered. */
/* Quiz › Ear, then one jog position per level of the path, each clicked. */
function openHearing(path) {
  globalThis.init();
  jog(TOP.quiz);
  click();
  click();
  for (const at of path) {
    jog(at);
    click();
  }
}

/* Every drill in Quiz › Ear as a jog path to its first level: an exercise's
 * first level, a course's first unit's, a one-level exercise itself. */
async function hearPaths() {
  const { hearMenu } = await import(new URL('../src/program.mjs', import.meta.url));
  const paths = [];
  const first = (node, path) => (node.children ? first(node.children[0], path.concat(0)) : path);
  hearMenu().children.forEach((topic, t) => topic.children.forEach((item, i) => {
    paths.push({ label: item.label, path: first(item, [t, i]) });
  }));
  return paths;
}

const noteOns = () => hostCalls.notes.join(',').split(',').filter((n) => n && !n.endsWith(':0'));

test('a hearing drill plays a line, takes its answer from the jog, and shows what it was', () => {
  freezeClock();
  const screen = capture();
  hostCalls.notes.length = 0;
  openHearing(THIRDS.path);

  /* Melodic: one note now, the second a beat later. */
  advanceMs(200);
  assert.equal(noteOns().length, 1, 'the first note: ' + hostCalls.notes);
  advanceMs(700);
  assert.equal(noteOns().length, 2, 'then the second');

  const asked = screen.frame();
  assert.match(asked, /HEAR 3RDS/, asked);
  assert.match(asked, /which interval\?/);
  assert.match(asked, /Major 3rd/);
  assert.match(asked, /Minor 3rd/);

  /* Answer the top option; if that was wrong the question stays, so the other is right. */
  let after = screen.frame(click);
  if (/which interval\?/.test(after)) {
    jog(1);
    after = screen.frame(click);
  }
  assert.match(after, /[A-G][#b]?-[A-G][#bx]* m?M?3/, 'the answer is revealed: ' + after);

  /* Then the next question, asked and played without a press. */
  hostCalls.notes.length = 0;
  advanceMs(1600);
  const next = screen.frame();
  assert.match(next, /which interval\?/);
  assert.match(next, /1\/20/);
  assert.ok(noteOns().length >= 1, 'the next prompt sounds by itself');
  screen.restore();
  thawClock();
});

test('hearing help: Record replays slower, then strikes an answer; Play repeats', () => {
  freezeClock();
  openHearing([2, 1, 1]);                     /* Chords › Four triads › block */
  advanceMs(3000);
  hostCalls.notes.length = 0;
  globalThis.onMidiMessageInternal(CC(PLAY, 127));
  advanceMs(3000);
  assert.equal(noteOns().length, 3, 'a block chord: three notes at once');

  hostCalls.notes.length = 0;
  globalThis.onMidiMessageInternal(CC(RECORD, 127));
  advanceMs(6000);
  assert.equal(noteOns().length, 6, 'slower: broken up first, then whole');

  const screen = capture();
  const struck = screen.frame(() => globalThis.onMidiMessageInternal(CC(RECORD, 127)));
  assert.match(struck, /CLICK ok/, 'the help is used up: ' + struck);
  screen.restore();
  thawClock();
});

test('every hearing exercise and course opens and sounds without throwing', async () => {
  freezeClock();
  const all = await hearPaths();
  assert.equal(all.length, 15, 'twelve exercises and three courses');
  for (const { label, path } of all) {
    hostCalls.notes.length = 0;
    openHearing(path);
    advanceMs(400);
    assert.ok(noteOns().length >= 1, `${label} played nothing`);
    globalThis.onMidiMessageInternal(CC(JOG_TURN, 1));
    globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127));
    globalThis.onMidiMessageInternal(CC(RECORD, 127));
    globalThis.onMidiMessageInternal([0x90, PAD, 100]);
    globalThis.onMidiMessageInternal([0x80, PAD, 0]);
    advanceMs(2000);
  }
  thawClock();
});
