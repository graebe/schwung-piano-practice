// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * Piano Practice — a scrolling sight-reading trainer for Schwung / Ableton Move.
 *
 * A treble clef and five staff lines sit still on the left of the 128x64 OLED.
 * Notes and bar lines scroll in from the right, cross the hit line, and vanish
 * just before the clef. Play the right pad at the right moment and the
 * notehead gets fatter; miss it and it turns into an X.
 *
 * This file is the MOVE: host glue only — lifecycle, MIDI out, the built-in
 * piano's mailbox, pads and their LEDs, the buttons, the 128x64 panel. What the
 * module does — lessons, the transport, scoring, quizzes, progress, settings —
 * is session.mjs, which knows nothing about a Move and also runs in a browser.
 * Everything that can be reasoned about without a Move lives in the .mjs
 * modules beside it and is covered by `npm test`.
 *
 * The module's page in Schwung's web manager watches and steers the session
 * from a browser (src/remote.mjs); the device's half of that is at the end of
 * the host bindings below.
 *
 * Two host facts shape the code here:
 *  - tick() runs at ~500Hz in overtake mode but the OLED tops out near 49Hz,
 *    so the draw is throttled off performance.now() and the rest of the frame
 *    returns early.
 *  - host_module_get_param / shadow_get_param cost ~2.8ms each, more than a
 *    whole frame. Nothing in the draw path may call them.
 */

import {
  setLED,
  setButtonLED,
  invalidateLedCache,
  decodeDelta,
} from '/data/UserData/schwung/shared/input_filter.mjs';
import { announce } from '/data/UserData/schwung/shared/screen_reader.mjs';

import * as L from './layout.mjs';
import * as PAD from './padmap.mjs';
import * as GEN from './generator.mjs';
import * as VIEW from './view.mjs';
import * as CTRL from './controls.mjs';
import * as SET from './settings_def.mjs';
import * as GUESS from './guess.mjs';
import * as LEDS from './led_paint.mjs';
import * as STATS from './stats.mjs';
import * as PROG from './progress.mjs';
import * as AP from './answer_pads.mjs';
import * as CAT from './catalog.mjs';
import {
  createSession, OUT_TRACK, OUT_USB, OUT_INTERNAL,
  MENU, READY, RUNNING, SETTINGS, GUESS_VIEW, RESULT_VIEW, PROGRESS_VIEW, PROGRESS_DETAIL, INFO_VIEW,
} from './session.mjs';
import { viewModel, encodeViewModel } from './view_model.mjs';
import { applyAction } from './actions.mjs';
import { createRemote } from './remote.mjs';

/* ---- Host bindings ------------------------------------------------------ */
/* Several documented host_* functions do not exist on device; guard them all. */

/* Everything the session saves — settings.json, stats.json, progress.json —
 * and the exercises it reads sit beside the module. */
const MODULE_DIR = '/data/UserData/schwung/modules/tools/piano-practice';

/* CCs and notes (src/shared/constants.mjs). */
const CC_JOG_CLICK = 3;
const CC_JOG_TURN = 14;
const CC_SHIFT = 49;
const CC_MENU = 50;
const CC_BACK = 51;
const CC_PLAY = 85;
const CC_RECORD = 86;
const CC_KNOB1 = 71;
const KNOB_COUNT = 8;

/* The draw ctx: one thin wrapper over the host primitives so view.mjs can be
 * rendered into a byte buffer in tests instead. */
const ctx = {
  clear() {
    clear_screen();
  },
  fillRect(x, y, w, h, v) {
    if (w <= 0 || h <= 0) return;
    fill_rect(x, y, w, h, v);
  },
  drawRect(x, y, w, h, v) {
    if (w <= 0 || h <= 0) return;
    draw_rect(x, y, w, h, v);
  },
  line(x0, y0, x1, y1, v) {
    draw_line(x0, y0, x1, y1, v);
  },
  text(x, y, s, v) {
    print(x, y, s, v);
  },
  textWidth(s) {
    if (typeof text_width === 'function') return text_width(s);
    return s.length * 6 - 1;
  },
};

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function readFile(path) {
  if (typeof host_read_file !== 'function') return null;
  try {
    return host_read_file(path);
  } catch (e) {
    return null;
  }
}

function writeFile(path, text) {
  if (typeof host_write_file !== 'function') return false;
  try {
    return host_write_file(path, text) === true;
  } catch (e) {
    return false;
  }
}
/* ---- MIDI out: pads and playback sound through a Move track instrument --- */
/*
 * Cable 2 is the virtual cable Move's tracks listen to for MIDI in — the same
 * path ChordDex and seq-test use. Load a piano on a track and set its MIDI
 * input to channel 1 and everything here is audible.
 *
 * Injection is deferred until ~6ms after any hardware MIDI, so the metronome
 * click jitters slightly while you are actually playing. The visual beat marker
 * never does, which is why it is always drawn.
 */
let midiChannel = 0;
function sendTrack(status, d1, d2) {
  if (typeof move_midi_inject_to_move !== 'function') return;
  const cin = (status >> 4) & 0x0f;
  try {
    move_midi_inject_to_move([(2 << 4) | cin, status, d1, d2]);
  } catch (e) {
    /* ring full — a dropped note is better than a thrown frame */
  }
}

function sendUsb(status, d1, d2) {
  if (typeof move_midi_external_send !== 'function') return;
  const cin = (status >> 4) & 0x0f;
  try {
    move_midi_external_send([cin, status, d1, d2]);
  } catch (e) {
    /* as above */
  }
}

/*
 * A paced outbox, because a single musical event can be a lot of packets.
 *
 * Move's inject ring holds 64 and drains 31 per audio block. A three-note chord
 * broadcast to all sixteen channels is 48 packets, and the reference line can
 * be doing the same in the same frame — enough to overrun the ring and lose
 * notes, including note-offs, which is how notes get stuck. So nothing writes
 * to the ring directly: everything queues here and leaves at a rate the ring
 * can always absorb.
 *
 * At 8 per tick and a 500Hz tick that is ~4000 packets a second against a ring
 * that swallows ~10,700 — it can never back up, and the worst case latency for
 * a big chord is a couple of milliseconds, under the injection deferral itself.
 */
const outbox = [];
const OUTBOX_PER_TICK = 8;
const OUTBOX_MAX = 512;

function queue(route, status, d1, d2) {
  if (outbox.length >= OUTBOX_MAX) return;
  outbox.push(route, status, d1, d2);
}

function flushOutbox(all) {
  let n = all ? outbox.length >> 2 : OUTBOX_PER_TICK;
  while (n-- > 0 && outbox.length) {
    const route = outbox.shift();
    const status = outbox.shift();
    const d1 = outbox.shift();
    const d2 = outbox.shift();
    if (route & OUT_TRACK) sendTrack(status, d1, d2);
    if (route & OUT_USB) sendUsb(status, d1, d2);
  }
}

/*
 * Channel 0 means "every channel".
 *
 * A Move track only hears the channel its MIDI input is set to, and there is no
 * way for a module to read that, let alone change it — so a mismatch is silent
 * and gives you no clue. Broadcasting removes the question: whatever channel
 * the track is listening on, it is one of the sixteen.
 */
function eachChannel(fn) {
  if (S.settings.midiCh === 0) {
    for (let ch = 0; ch < 16; ch++) fn(ch);
  } else {
    fn(midiChannel);
  }
}

/* Everything goes out channel-aware; the status byte's nibble is filled here. */
function midiOutCh(kind, d1, d2) {
  eachChannel((ch) => queue(S.settings.midiOut, kind | ch, d1, d2));
}

/*
 * Notes for the built-in piano, batched into one parameter write per tick.
 * The overtake parameter channel is a single-slot mailbox, so one call per
 * note would have a chord overwrite itself and only the last note would sound.
 */
const dspNotes = [];
/* Whether this tick has written a param: the mailbox takes one per tick. */
let paramWritten = false;

function dspNote(pitch, vel) {
  dspNotes.push(pitch + ':' + vel);
}

/* False when the host refused the write: in overtake mode a write is dropped,
 * not queued, while the single slot is busy. */
function dspSet(key, val) {
  if (typeof host_module_set_param !== 'function') return false;
  paramWritten = true;
  try {
    const ok = host_module_set_param(key, val);
    return ok !== false && ok !== 0;
  } catch (e) {
    /* the slot may not be loaded; silence is the right failure here */
    return false;
  }
}

function flushDsp() {
  if (!dspNotes.length) return;
  dspSet('n', dspNotes.join(','));
  dspNotes.length = 0;
}

/*
 * Silence one channel on BOTH routes, whatever the current setting says.
 * A panic is not the place to be selective: the route may have been changed
 * mid-session, and an extra packet costs nothing next to a note left sounding
 * in someone's DAW after the module has closed.
 *
 *   120 All Sound Off   — cuts release tails too
 *   123 All Notes Off
 *    64 Sustain off     — in case a pedal is latched downstream
 */
function panicChannel(ch) {
  for (const send of [sendTrack, sendUsb]) {
    send(0xb0 | ch, 120, 0);
    send(0xb0 | ch, 123, 0);
    send(0xb0 | ch, 64, 0);
  }
}
/*
 * Where the session's notes go. It only says a note should sound; which of
 * the three routes carries it is the MIDI out setting, decided here per note
 * so that changing it takes effect at once. Notes for the built-in piano are
 * queued for the one parameter write per tick (flushDsp).
 */
function strike(pitch, vel) {
  const out = S.settings.midiOut;
  if (out & OUT_INTERNAL) dspNote(pitch, vel);
  if (out & (OUT_TRACK | OUT_USB)) midiOutCh(0x90, pitch, vel);
}

function release(pitch) {
  const out = S.settings.midiOut;
  if (out & OUT_INTERNAL) dspNote(pitch, 0);
  if (out & (OUT_TRACK | OUT_USB)) midiOutCh(0x80, pitch, 0);
}

/*
 * Everything off. The DSP's pending notes are dropped and it is told to stop;
 * every pitch still held gets an explicit note-off on both routes and every
 * channel — the setting may have changed since the note-on, and a note is only
 * ever released by the path that started it — and our channel is panicked.
 */
function silence(held) {
  dspNotes.length = 0;
  dspSet('panic', '1');
  for (let i = 0; i < held.length; i++) {
    for (let ch = 0; ch < 16; ch++) {
      sendTrack(0x80 | ch, held[i], 0);
      sendUsb(0x80 | ch, held[i], 0);
    }
  }
  panicChannel(midiChannel);
}

/* ---- The page ------------------------------------------------------------ */
/*
 * The browser page reaches ui.js through the piano's DSP (src/remote.mjs). Its
 * actions are the same ones the page applies to a session of its own
 * (src/actions.mjs), so here they are applied exactly as the page would.
 *
 * The one param READ in this file is here, and it is paced: remote.mjs reads
 * the inbox at most five times a second, never from the draw.
 *
 * A page steers but does not close the tool. Its Back at the top of the list
 * would; the Move's own Back is the only way out.
 */
let page = null;
let fromPage = false;

function pageRead(key) {
  try {
    return host_module_get_param(key);
  } catch (e) {
    return null;
  }
}

function openPage() {
  page = typeof host_module_get_param === 'function'
    ? createRemote({
      get: pageRead,
      set: dspSet,
      snapshot: (t) => encodeViewModel(viewModel(S, { t })),
    })
    : null;
}

function servicePage(t) {
  const actions = page.poll(t);
  if (!actions.length) return;
  fromPage = true;
  try {
    for (let i = 0; i < actions.length; i++) applyAction(S, actions[i]);
  } finally {
    fromPage = false;
  }
  ledDirty = true;
  S.dirty = true;
}

/* ---- The session ---------------------------------------------------------- */
const S = createSession({
  now,
  wallNow: () => Date.now(),
  strike,
  release,
  silence,
  announce,
  readText: (name) => readFile(MODULE_DIR + '/' + name),
  writeText: (name, text) => writeFile(MODULE_DIR + '/' + name, text),
  exit() {
    if (!fromPage) exitModule();
  },
  settingChanged(key) {
    if (key === 'midiCh') midiChannel = S.settings.midiCh > 0 ? S.settings.midiCh - 1 : 0;
  },
  /* Where an answer sits on the grid: every pad of each pitch, lit as right. */
  reveal(pitches, ms) {
    for (let i = 0; i < pitches.length; i++) flashPitch(pitches[i], PAD.LED_HIT, ms);
  },
});

/* ---- Device state ----------------------------------------------------------- */
let shiftHeld = false;
let lastDrawMs = 0;
const DRAW_INTERVAL_MS = 20; /* ~50Hz; the panel cannot show more */
const LED_INTERVAL_MS = 20;
let lastLedMs = 0;
let ledPhase = -1;        /* Play-button pulse, so we only write on a change */
/* LEDs that change for the device's own reasons — a press, a flash, the pulse.
 * The session raises its own ledDirty for everything it changes. */
let ledDirty = true;

/* Pad feedback: pad -> { color, untilMs } */
const padFlash = {};
const heldPads = {};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/* ---- LEDs --------------------------------------------------------------- */
/* One reused descriptor and one reused output array: this runs in the frame
 * path and must not produce garbage. */
const ledState = {
  transpose: 0, rootPc: 0, intervals: null, phase: 0, now: 0,
  heldPads: null, flashes: null,
  soundingPitches: null, stuckPitches: null, targetPitches: null, targetNear: false,
  promptPitches: null,
  answerRows: 0, answerPads: null, answerColours: null,
};

const answerColourBuf = [];
const answerStruck = (i) => GUESS.isEliminated(S.quiz, i);

function collectAnswers() {
  if (!S.answerBarActive()) {
    ledState.answerRows = 0;
    ledState.answerPads = null;
    return;
  }
  const quiz = S.quiz;
  const n = quiz.choices.length;
  ledState.answerRows = AP.answerRows(n);
  ledState.answerPads = AP.answerPads(n);
  ledState.answerColours = AP.answerLeds(n, quiz.solved ? -1 : quiz.choiceIndex,
    answerStruck, ledPhase, answerColourBuf);
}
/*
 * Momentary pad feedback: a judgement that just landed. Outranks everything
 * else in led_paint, including a held pad, for as long as it lasts.
 */
function flashPad(pad, color, ms) {
  padFlash[pad] = { color, untilMs: now() + (ms || 150) };
  ledDirty = true;
}

/* Every pad that sounds this pitch — the grid has twins. */
function flashPitch(pitch, color, ms) {
  const pads = PAD.padsForPitch(pitch, S.settings.transpose);
  for (let i = 0; i < pads.length; i++) flashPad(pads[i], color, ms);
}

const ledWorkspace = LEDS.createLedState();
const padColorBuf = new Array(PAD.PAD_COUNT);

function paintPads() {
  const near = S.collectTarget();
  S.collectStuck();
  S.collectSounding();
  S.collectPrompt();
  collectAnswers();

  const settings = S.settings;
  const soundingBuf = S.soundingBuf;
  const stuckBuf = S.stuckBuf;
  const targetBuf = S.targetBuf;
  const promptBuf = S.promptBuf;
  ledState.transpose = settings.transpose;
  ledState.rootPc = settings.rootPc;
  ledState.intervals = GEN.MODES[settings.mode] || GEN.MODES.major;
  ledState.phase = ledPhase;
  ledState.now = now();
  ledState.heldPads = heldPads;
  ledState.flashes = padFlash;
  ledState.soundingPitches = soundingBuf.length ? soundingBuf : null;
  ledState.stuckPitches = stuckBuf.length ? stuckBuf : null;
  ledState.targetPitches = targetBuf.length ? targetBuf : null;
  ledState.promptPitches = promptBuf.length ? promptBuf : null;
  ledState.targetNear = near;

  LEDS.padColors(ledState, ledWorkspace, padColorBuf);
  for (let i = 0; i < PAD.PAD_COUNT; i++) setLED(PAD.PAD_FIRST + i, padColorBuf[i]);

  /* The Play button is the only thing that starts a run, so in READY it has to
   * say so by itself — it pulses. This was once `view === RUNNING ? 127 : 0`,
   * i.e. dark in exactly the state that needs it lit. */
  const view = S.view;
  const quiz = S.quiz;
  const ledView = view === GUESS_VIEW ? CTRL.GUESS : view;
  setButtonLED(CC_PLAY, CTRL.playLedColor(ledView, ledPhase, S.listening, S.paused));
  setButtonLED(CC_RECORD, CTRL.recordLedColor(ledView, S.listening, ledPhase,
    Boolean(quiz && GUESS.hintsLeft(quiz) === 0), S.paused));
}
/* ---- Drawing ------------------------------------------------------------ */
/*
 * The Info page's lines, wrapped to the panel's font. The session keeps the
 * paragraphs; how they break, and how far down you have scrolled, is the
 * panel's business.
 */
let infoShown = null;
let infoLines = [];
let infoScroll = 0;

function infoView() {
  if (S.info === infoShown) return;
  infoShown = S.info;
  infoLines = infoShown ? VIEW.infoLines(ctx, infoShown.paragraphs) : [];
  infoScroll = 0;
}

function draw() {
  const view = S.view;
  const nav = S.nav;
  const quiz = S.quiz;
  const settings = S.settings;
  const chart = S.chart;
  const songBeats = S.songBeats;
  const lastResult = S.lastResult;
  if (view === MENU) {
    const top = CAT.navTop(nav);
    VIEW.drawList(ctx, top.node.label.toUpperCase(), top.node.children, top.cursor, {
      footer: nav.length > 1 ? VIEW.FOLDER_HINT : VIEW.SETTINGS_HINT,
      centreFooter: true,
      decorate: S.decorateRow,
    });
  } else if (view === PROGRESS_VIEW) {
    VIEW.drawList(ctx, 'PROGRESS ' + PROG.folderSummary(S.agg, S.progress, S.catalog).percent + '%',
      S.progressRows, S.progressCursor, {
        footer: 'CLICK chart BACK list',
        centreFooter: true,
        decorate: S.decorateRow,
      });
  } else if (view === SETTINGS) {
    VIEW.drawList(ctx, 'SETTINGS', S.settingsRows(), S.settingsCursor, {
      footer: S.settingsEditing ? 'turn change  CLICK ok' : 'CLICK edit SHIFT back',
      editing: S.settingsEditing,
    });
  } else if (view === RESULT_VIEW) {
    if (lastResult.kind === 'exercise') VIEW.drawExerciseResult(ctx, lastResult);
    else VIEW.drawRoundResult(ctx, lastResult);
  } else if (view === PROGRESS_DETAIL) {
    drawProgressDetail();
  } else if (view === INFO_VIEW) {
    infoView();
    VIEW.drawInfo(ctx, {
      title: S.info.title,
      lines: infoLines,
      scroll: infoScroll,
      footer: infoLines.length > L.INFO_ROWS ? 'JOG scroll BACK close' : 'BACK close',
    });
  } else if (view === GUESS_VIEW && S.quizPick) {
    const ear = quiz.kind === GUESS.EAR;
    let ask = 'which pad is lit?';
    if (ear) ask = quiz.solved ? quiz.label : quiz.exercise.question;
    else if (quiz.solved) ask = 'right';
    VIEW.drawPick(ctx, {
      title: ear ? 'HEAR ' + quiz.exercise.short.toUpperCase()
        : (quiz.kind === GUESS.CHORDS ? 'NAME CHORD' : 'NAME NOTE'),
      score: quiz.roundSize > 0
        ? quiz.correct + '/' + quiz.roundSize
        : String(GUESS.quizStats(quiz).correct),
      options: quiz.choices.map((c) => GUESS.optionLabel(quiz, c)),
      /* The legend for the answer pads: their colours, and for a map the
       * short names drawn where the pads sit. Name has no pads to explain. */
      colours: ear ? quiz.choices.map((c, i) => AP.answerColour(i).name) : null,
      short: quiz.choices.map(AP.shortLabel),
      index: quiz.choiceIndex,
      eliminated: quiz.eliminated,
      hint: ask,
      footer: ear
        ? (GUESS.hintsLeft(quiz) ? 'PAD answer  REC help' : 'PAD or JOG  CLICK ok')
        : (GUESS.hintsLeft(quiz) ? 'JOG pick  REC help' : 'JOG pick  CLICK ok'),
    });
  } else if (view === GUESS_VIEW && quiz.read) {
    const st = GUESS.quizStats(quiz);
    const staff = quiz.read === GUESS.READ_STAFF;
    VIEW.drawQuizRow(ctx, {
      queue: quiz.queue.map((e) => ({ pitches: e.pitches, name: GUESS.entryName(quiz, e) })),
      read: quiz.read,
      glide: S.quizGlide(),
      fifths: S.keyFifths(),
      solved: quiz.solved,
      hint: quiz.hint,
      title: (quiz.kind === GUESS.CHORDS ? 'CHORD' : 'NOTE') + (staff ? ' STAFF' : ''),
      score: quiz.roundSize > 0
        ? quiz.correct + '/' + quiz.roundSize
        : st.correct + '/' + st.asked,
      footer: GUESS.hintsLeft(quiz)
        ? 'streak ' + st.streak + '   REC help'
        : 'hint ' + quiz.hint + '/' + GUESS.MAX_HINT + '   streak ' + st.streak,
    });
  } else if (view === GUESS_VIEW) {
    const st = GUESS.quizStats(quiz);
    VIEW.drawGuessView(ctx, {
      prompt: quiz.prompt,
      fifths: S.keyFifths(),
      solved: quiz.solved,
      hidden: S.quizHear && !quiz.solved,
      hint: quiz.hint,
      label: quiz.label,
      title: S.quizHear ? 'HEAR' : (quiz.kind === GUESS.CHORDS ? 'CHORD' : 'NOTE'),
      score: quiz.roundSize > 0
        ? quiz.correct + '/' + quiz.roundSize
        : st.correct + '/' + st.asked,
      footer: GUESS.hintsLeft(quiz)
        ? 'streak ' + st.streak + '   REC help'
        : 'hint ' + quiz.hint + '/' + GUESS.MAX_HINT + '   streak ' + st.streak,
    });
  } else if (view === READY) {
    VIEW.drawReadyView(ctx, {
      chart,
      run: S.run,
      songBeats,
      pxPerBeat: settings.pxPerBeat,
      /*
       * The header's right slot holds one thing. At the top that is where the
       * notes are going — a silent channel mismatch is otherwise
       * indistinguishable from broken, and this is the screen you always pass
       * through. Once you scrub away it becomes the position, because while
       * you are navigating "where am I" is the only question, and the scroll
       * alone cannot answer it in bars.
       */
      outLabel: songBeats > 0 ? '' :
        SET.formatSetting(settings, SET.settingIndex('midiOut')) + ' ' +
        SET.formatSetting(settings, SET.settingIndex('midiCh')),
      /* Which stage is armed, and that the jog changes it. */
      footer: S.armedId ? VIEW.stageFooter(S.stage) : '',
    });
  } else {
    VIEW.drawReadingView(ctx, {
      chart,
      run: S.run,
      songBeats,
      pxPerBeat: settings.pxPerBeat,
      beatFlash: now() - S.beatFlash < 90,
      blocked: S.blocked,
      paused: S.paused,
    });
  }
}

function drawProgressDetail() {
  const d = S.progressDetail(L.PROGRESS_PLOT.w, L.PROGRESS_PLOT.h);
  if (!d) return;
  if (d.kind === 'overview') VIEW.drawOverview(ctx, d);
  else if (d.kind === 'drill') VIEW.drawProgress(ctx, d);
  else VIEW.drawItemProgress(ctx, d);
}

/* ---- Input -------------------------------------------------------------- */
/*
 * Pads pressed as answers rather than as notes: no note went out for them, so
 * no note-off may follow — on the way up they are only forgotten.
 */
const answerPressed = {};

function onPadDown(pad, vel) {
  /* In a multiple-choice drill the bottom of the grid is answer buttons.
   * They sound nothing: a press there is a choice, not a note. */
  if (S.answerBarActive() && AP.inAnswerBar(S.quiz.choices.length, pad)) {
    answerPressed[pad] = 1;
    const res = S.answer(AP.answerAt(S.quiz.choices.length, pad));
    if (res) {
      if (res === GUESS.WRONG) flashPad(pad, PAD.LED_MISS, 200);
      else flashPad(pad, PAD.LED_HIT, 300);
    }
    return;
  }

  heldPads[pad] = 1;
  ledDirty = true;
  const pitch = PAD.padPitch(pad, S.settings.transpose);
  const out = S.play(pitch, vel);
  if (!out) return;
  if (out.kind === 'quiz') {
    if (out.res === GUESS.WRONG) flashPad(pad, PAD.LED_MISS, 200);
    else if (out.res === GUESS.CORRECT) {
      for (const pitchOf of S.quiz.prompt) flashPitch(pitchOf, PAD.LED_HIT);
    }
    return;
  }
  if (out.result === 'stray') {
    flashPad(pad, PAD.LED_MISS, 120);
  } else {
    flashPitch(pitch, out.result === 'late' ? PAD.LED_MISS : PAD.LED_HIT);
  }
}

function onPadUp(pad) {
  if (answerPressed[pad]) {
    delete answerPressed[pad];
    return;
  }
  delete heldPads[pad];
  ledDirty = true;
  S.release(PAD.padPitch(pad, S.settings.transpose));
}

function onJog(delta) {
  if (S.view === INFO_VIEW) {
    infoView();
    infoScroll = clamp(infoScroll + (delta > 0 ? 1 : -1), 0, Math.max(0, infoLines.length - L.INFO_ROWS));
    S.dirty = true;
    return;
  }
  S.moveSelection(delta);
}

/*
 * The knobs mean different things in different places, and only Settings gets
 * to change settings.
 *
 *   in a song      1 scrubs, 8 sets the tempo
 *   in Settings    the visible rows, in order
 *   anywhere else  nothing
 *
 * In Settings they follow the rows that are ON SCREEN rather than fixed
 * setting numbers, so the mapping survives scrolling and a knob can never
 * point at something you cannot see.
 */
const SETTINGS_PER_PAGE = 4;   /* what drawList shows */

function settingsPageTop() {
  const n = SET.SETTINGS_COUNT;
  return Math.max(0, Math.min(S.settingsCursor - (SETTINGS_PER_PAGE >> 1), n - SETTINGS_PER_PAGE));
}

function inSong() {
  return S.view === RUNNING || S.view === READY;
}

function onKnob(index, delta) {
  if (inSong()) {
    if (index === 0) {
      /*
       * Whenever the music is NOT running: paused, or on the ready screen.
       * Seeking under your own feet mid-playback is not something anyone
       * wants; seeking before you start is how you pick a passage to work on.
       *
       * The ready screen used to be excluded because startRun reset to zero
       * and threw the scrub away — that is fixed below rather than avoided.
       */
      if (S.scrubAllowed()) S.scrubBy(delta);
      return;
    }
    if (index === KNOB_COUNT - 1) S.editSetting(SET.settingIndex('bpm'), delta);
    return;
  }
  if (S.view === SETTINGS) {
    const row = settingsPageTop() + index;
    if (index >= SETTINGS_PER_PAGE || row >= SET.SETTINGS_COUNT) return;
    S.selectSetting(row);
    /* Key and octave wrap through a lot of values; one step per event or a
     * flick sends them spinning. */
    const def = SET.SETTINGS_DEF[row];
    const step = def && (def.type === 'wrap' || def.type === 'list' || def.type === 'enum');
    S.editSetting(row, step ? (delta > 0 ? 1 : -1) : delta);
  }
}

/*
 * Knob TOUCH moves the cursor to the row that knob controls.
 *
 * These arrive as notes 0-9 and were being dropped on the floor. Without them
 * the knob-to-row mapping is something you have to know; with them you find it
 * by resting a finger on a knob.
 */
function onKnobTouch(index) {
  if (S.view !== SETTINGS || index >= SETTINGS_PER_PAGE) return;
  const row = settingsPageTop() + index;
  if (row >= SET.SETTINGS_COUNT) return;
  S.selectSetting(row);
  S.dirty = true;
}
/* ---- Lifecycle ---------------------------------------------------------- */
globalThis.init = function init() {
  shiftHeld = false;
  ledPhase = -1;
  lastDrawMs = 0;
  lastLedMs = 0;
  pendingExitAt = 0;
  panicChannelNext = 16;
  infoShown = null;
  for (const k in heldPads) delete heldPads[k];
  for (const k in answerPressed) delete answerPressed[k];
  for (const k in padFlash) delete padFlash[k];

  S.init();
  openPage();
  invalidateLedCache();
  ledDirty = true;
  S.dirty = true;
  announce('Piano Practice. Pick an exercise.');
  draw();
};

globalThis.tick = function tick() {
  if (globalThis.overtakeParked) return;

  /* Closing: everything is already silenced, so do no further work at all —
   * no clock, no reference notes, no LED writes — just let the MIDI ring drain
   * and go. Anything emitted here would be a note nobody can turn off. */
  if (pendingExitAt) {
    flushDsp();
    flushOutbox(true);   /* get the silence out before we stop ticking */
    serviceExit();
    return;
  }

  const t = now();
  if (page) servicePage(t);
  S.tick(t);

  /* Repaint when the pulse flips, so the cached setLED emits one packet per
   * change instead of one per tick — the overtake queue only flushes 16. */
  const phase = CTRL.pulsePhase(t);
  if (phase !== ledPhase) {
    ledPhase = phase;
    ledDirty = true;
  }

  /* A press repaints immediately — not seeing your own pad light up feels
   * broken. Only the time-driven repaint is capped, to the panel's rate: it
   * used to run at the full 500Hz tick to animate a pulse that changes twice a
   * second. */
  if (ledDirty || S.ledDirty || (S.view === RUNNING && t - lastLedMs >= LED_INTERVAL_MS)) {
    lastLedMs = t;
    paintPads();
    ledDirty = false;
    S.ledDirty = false;
  }

  S.flushSettings(false);
  flushDsp();
  flushOutbox(false);
  if (page) page.publish(t, paramWritten);
  paramWritten = false;

  /* ~50Hz: the panel refreshes at about 49Hz, so anything faster is wasted. */
  if (S.dirty && t - lastDrawMs >= DRAW_INTERVAL_MS) {
    lastDrawMs = t;
    S.dirty = false;
    draw();
  }
};

globalThis.onMidiMessageInternal = function onMidiMessageInternal(data) {
  if (!data || data.length < 3) return;
  const status = data[0] & 0xf0;
  const d1 = data[1];
  const d2 = data[2];

  if (status === 0x90 || status === 0x80) {
    if (d1 < 10) {
      /* Knob capacitive touch. Used in Settings to point at the row the knob
       * edits; ignored everywhere else. */
      if (status === 0x90 && d2 > 0) onKnobTouch(d1);
      return;
    }
    if (!PAD.isPad(d1)) return;
    if (status === 0x90 && d2 > 0) onPadDown(d1, d2);
    else onPadUp(d1);
    return;
  }

  if (status !== 0xb0) return;

  if (d1 === CC_SHIFT) {
    shiftHeld = d2 > 0;
    return;
  }
  if (d2 === 0 && d1 !== CC_JOG_TURN && (d1 < CC_KNOB1 || d1 >= CC_KNOB1 + KNOB_COUNT)) return;

  if (d1 === CC_JOG_TURN) {
    const delta = decodeDelta(d2);
    if (delta) onJog(delta > 0 ? 1 : -1);
    return;
  }
  if (d1 >= CC_KNOB1 && d1 < CC_KNOB1 + KNOB_COUNT) {
    const delta = decodeDelta(d2);
    if (delta) onKnob(d1 - CC_KNOB1, delta);
    return;
  }
  if (d1 === CC_JOG_CLICK) {
    S.activate(shiftHeld);
    return;
  }
  if (d1 === CC_PLAY) {
    S.playButton();
    return;
  }
  if (d1 === CC_RECORD) {
    S.recordButton();
    return;
  }
  /* Move's Menu button reached the module and was ignored, so the hardware
   * control most likely to be pressed looking for a menu did nothing. */
  if (d1 === CC_MENU) {
    S.menuButton();
    return;
  }
  if (d1 === CC_BACK) {
    /* Shift+Back leaves immediately from anywhere — the same gesture Schwung
     * uses for a full exit elsewhere. Plain Back is the session's: up a level,
     * and out from the top of the list. */
    if (shiftHeld) {
      exitModule();
      return;
    }
    S.back();
  }
};

/* Nothing to do with external MIDI yet — declared so the host's per-tick
 * encoder flush has a handler to talk to. */
globalThis.onMidiMessageExternal = function onMidiMessageExternal(_data) {};

globalThis.onResume = function onResume() {
  invalidateLedCache();
  ledDirty = true;
  S.dirty = true;
};

globalThis.onUnload = function onUnload() {
  S.silence();
  S.flushSettings(true);
};

/*
 * Closing is a two-step, and it has to be.
 *
 * Note-offs go out through move_midi_inject_to_move, which the shim holds back
 * until two consecutive quiet SPI frames and for three more frames after
 * overtake ends. Calling host_exit_module() on the same tick that queues them
 * therefore races the teardown and the offs can be dropped — which is exactly
 * how notes were left sounding after the module closed.
 *
 * So: silence, then leave a few milliseconds for the ring to drain, then go.
 */
const EXIT_DRAIN_MS = 120;
const PANIC_CH_PER_TICK = 2;   /* the inject ring holds 64 packets; pace it */
let pendingExitAt = 0;
let panicChannelNext = 16;     /* 16 = sweep finished */

function exitModule() {
  if (pendingExitAt) return;
  S.halt();
  /* Sweep every channel, not just ours: if the channel was changed during the
   * session, or something downstream remaps, a note can be sounding on one we
   * are no longer addressing. */
  panicChannelNext = 0;
  pendingExitAt = now() + EXIT_DRAIN_MS;
}

function serviceExit() {
  /* Spread the sweep over successive ticks rather than dumping ~96 packets
   * into a 64-deep ring that drains 31 per audio block. */
  if (panicChannelNext < 16) {
    for (let n = 0; n < PANIC_CH_PER_TICK && panicChannelNext < 16; n++) {
      panicChannel(panicChannelNext++);
    }
    return;
  }
  if (now() < pendingExitAt) return;   /* let the ring finish draining */
  pendingExitAt = 0;
  S.flushSettings(true);
  if (typeof host_exit_module === 'function') host_exit_module();
}
