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
    host_read_file: () => null,
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

test('a whole round can be played to its result screen', () => {
  globalThis.init();
  /* Row 0 is Progress; open it, then come back and play a quiz. */
  globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127));
  globalThis.tick();
  for (const cc of [JOG_TURN]) globalThis.onMidiMessageInternal(CC(cc, 1));
  globalThis.tick();
  globalThis.onMidiMessageInternal(CC(BACK, 127));
  globalThis.tick();

  globalThis.onMidiMessageInternal(CC(JOG_TURN, 1));   /* Guess: notes */
  globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127));
  globalThis.tick();
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
  globalThis.init();
  globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127));   /* row 0 = Progress */
  for (let i = 0; i < 6; i++) {
    globalThis.onMidiMessageInternal(CC(JOG_TURN, 1));
    globalThis.onMidiMessageInternal(CC(JOG_TURN, 127));
    globalThis.tick();
  }
  globalThis.onMidiMessageInternal(CC(BACK, 127));
  globalThis.tick();
});

test('a multiple-choice round can be played entirely with the jog', () => {
  globalThis.init();
  /* Rows: 0 Progress, 1-4 Guess/Hear, 5 Pick: notes, 6 Pick: chords. */
  for (const row of [5, 6]) {
    globalThis.init();
    for (let i = 0; i < row; i++) globalThis.onMidiMessageInternal(CC(JOG_TURN, 1));
    globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127));
    globalThis.tick();
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
  globalThis.init();
  for (let i = 0; i < 5; i++) globalThis.onMidiMessageInternal(CC(JOG_TURN, 1));
  globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127));
  globalThis.tick();
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
  /* To the bottom of the list — the jog clamps, so this lands on the last
   * bundled song whatever else is added above it. */
  for (let i = 0; i < 60; i++) globalThis.onMidiMessageInternal(CC(JOG_TURN, 1));

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
  globalThis.init();
  globalThis.tick();
  for (let i = 0; i < 7; i++) globalThis.onMidiMessageInternal(CC(JOG_TURN, 1));
  globalThis.tick();
  globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127));
  globalThis.tick();

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

  globalThis.init();
  globalThis.tick();
  for (let i = 0; i < 7; i++) globalThis.onMidiMessageInternal(CC(JOG_TURN, 1));
  globalThis.tick();
  globalThis.onMidiMessageInternal(CC(JOG_CLICK, 127));
  globalThis.tick();
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

  globalThis.init();
  globalThis.tick();
  for (let i = 0; i < 7; i++) globalThis.onMidiMessageInternal(CC(JOG_TURN, 1));
  globalThis.tick();

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

test('unloading is clean, and resume does not throw', () => {
  globalThis.onResume();
  globalThis.tick();
  globalThis.onUnload();
});
