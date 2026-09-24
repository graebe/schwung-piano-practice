/*
 * Piano Practice — a scrolling sight-reading trainer for Schwung / Ableton Move.
 *
 * A treble clef and five staff lines sit still on the left of the 128x64 OLED.
 * Notes and bar lines scroll in from the right, cross the hit line, and vanish
 * just before the clef. Play the right pad at the right moment and the
 * notehead gets fatter; miss it and it turns into an X.
 *
 * This file is host glue only — lifecycle, MIDI, LEDs, settings, and the state
 * machine. Everything that can be reasoned about without a Move lives in the
 * .mjs modules beside it and is covered by `npm test`.
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
import * as SCORE from './scoring.mjs';
import * as VIEW from './view.mjs';
import * as CTRL from './controls.mjs';
import * as SET from './settings_def.mjs';
import * as GUESS from './guess.mjs';
import * as LEDS from './led_paint.mjs';
import * as STATS from './stats.mjs';
import * as NOTATION from './notation.mjs';
import {
  msToBeats, beatsToMs, chartTotalBeats, beatsPerBar, isBeatEdge, applyWait, xToBeat,
} from './chart.mjs';
import { parseExercise, parseManifest } from './exercise_io.mjs';

/* ---- Host bindings ------------------------------------------------------ */
/* Several documented host_* functions do not exist on device; guard them all. */

const MODULE_DIR = '/data/UserData/schwung/modules/tools/piano-practice';
const SETTINGS_PATH = MODULE_DIR + '/settings.json';
const STATS_PATH = MODULE_DIR + '/stats.json';

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
const pitchRefcount = {};

/*
 * Two genuinely different destinations, and which one carries your piano
 * depends on how the Move is wired:
 *
 *   track  move_midi_inject_to_move on cable 2 — Move's own track instrument.
 *          If that track also has MIDI Out enabled, Move forwards it on to a
 *          computer, which is one way a DAW ends up playing the notes.
 *   usb    move_midi_external_send — the USB-A port, straight to whatever is
 *          plugged into it.
 *
 * Defaulting to both because silence is a worse failure than a doubled note,
 * and narrowing it is one turn of the jog.
 */
export const OUT_TRACK = 1;
export const OUT_USB = 2;
/*
 * The module's own piano, rendered by dsp/piano.c in the overtake generator
 * slot and mixed into Move's audio. The only route that does not depend on a
 * track existing, an instrument being loaded on it, or its MIDI channel
 * matching — none of which a module can read or change.
 */
export const OUT_INTERNAL = 4;

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
  if (settings.midiCh === 0) {
    for (let ch = 0; ch < 16; ch++) fn(ch);
  } else {
    fn(midiChannel);
  }
}

/* Everything goes out channel-aware; the status byte's nibble is filled here. */
function midiOutCh(kind, d1, d2) {
  eachChannel((ch) => queue(settings.midiOut, kind | ch, d1, d2));
}

/*
 * Notes for the built-in piano, batched into one parameter write per tick.
 * The overtake parameter channel is a single-slot mailbox, so one call per
 * note would have a chord overwrite itself and only the last note would sound.
 */
const dspNotes = [];

function dspNote(pitch, vel) {
  dspNotes.push(pitch + ':' + vel);
}

function dspSet(key, val) {
  if (typeof host_module_set_param !== 'function') return;
  try {
    host_module_set_param(key, val);
  } catch (e) {
    /* the slot may not be loaded; silence is the right failure here */
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

function noteOn(pitch, vel) {
  if (pitch < 0 || pitch > 127) return;
  const prev = pitchRefcount[pitch] || 0;
  pitchRefcount[pitch] = prev + 1;
  if (prev === 0) {
    if (settings.midiOut & OUT_INTERNAL) dspNote(pitch, vel || 100);
    if (settings.midiOut & (OUT_TRACK | OUT_USB)) midiOutCh(0x90, pitch, vel || 100);
  }
}

function noteOff(pitch) {
  if (pitch < 0 || pitch > 127) return;
  const prev = pitchRefcount[pitch] || 0;
  if (prev <= 1) {
    delete pitchRefcount[pitch];
    if (settings.midiOut & OUT_INTERNAL) dspNote(pitch, 0);
    if (settings.midiOut & (OUT_TRACK | OUT_USB)) midiOutCh(0x80, pitch, 0);
  } else {
    pitchRefcount[pitch] = prev - 1;
  }
}

function allNotesOff() {
  guessOff.length = 0;
  dspNotes.length = 0;
  dspSet('panic', '1');
  /* Drop anything still scheduled first, or serviceNoteOffs would try to
   * release notes we have just silenced and drive the refcount negative. */
  listenOff.length = 0;
  for (const key in pitchRefcount) {
    /* Explicit note-off on both routes: the setting may have changed since the
     * note-on, and a note is only ever released by the path that started it. */
    for (let ch = 0; ch < 16; ch++) {
      sendTrack(0x80 | ch, +key, 0);
      sendUsb(0x80 | ch, +key, 0);
    }
    delete pitchRefcount[key];
  }
  panicChannel(midiChannel);
}

/* ---- Settings ----------------------------------------------------------- */
/*
 * Bumped when a default changes in a way a stored file would otherwise mask.
 * A saved settings.json always wins over a default, so changing one silently
 * does nothing for anybody who has already used the module.
 */
const SETTINGS_VERSION = 4;

const settings = {
  version: SETTINGS_VERSION,
  bpm: 80,
  pxPerBeat: L.PX_PER_BEAT_DEFAULT,
  rootPc: 0,
  mode: 'major',
  transpose: PAD.DEFAULT_TRANSPOSE,
  guidance: false, /* sight-reading first — the user's call */
  anyOctave: false,
  halfTones: true,   /* the guesser asks about black notes too */
  roundSize: 20,     /* prompts per round; 0 = endless practice, unrecorded */
  chordSet: 'triads',
  click: true,
  reference: true,   /* hear the line you are meant to be playing */
  midiOut: OUT_INTERNAL, /* our own piano: always works, needs no setup */
  waitForNote: true, /* stop at a note until it is played */
  graceBeats: 1 / 3, /* how late is still in time, as a fraction of a beat */
  refVel: 70,
  midiCh: 0,         /* 0 = every channel, so a track mismatch cannot silence us */
  countIn: 4,
};

function loadSettings() {
  const raw = readFile(SETTINGS_PATH);
  if (!raw) return;
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    return;
  }
  if (!obj || typeof obj !== 'object') return;

  /* Everything the table knows about, bounded by the table. One pass, before
   * any migration runs — the previous hand-written loader interleaved the two
   * and v3 was overwritten by the value it was meant to replace. */
  SET.coerceInto(settings, obj);

  const storedVersion = typeof obj.version === 'number' ? obj.version : 1;
  let migrated = false;

  /* v2 moved the default off "both" and onto the Move's own instrument:
   * sending to USB as well meant a DAW on a connected computer picked the
   * notes up and played them there. Anyone carrying the old default is moved
   * over; a deliberate USB choice is left alone. */
  if (storedVersion < 2 && settings.midiOut === (OUT_TRACK | OUT_USB)) {
    settings.midiOut = OUT_TRACK;
    migrated = true;
  }
  /* v3: a fixed channel only sounds if a Move track happens to be listening on
   * exactly it, and a mismatch is silent with nothing on screen to explain it.
   * Broadcasting removes the question. */
  if (storedVersion < 3 && settings.midiCh !== 0) {
    settings.midiCh = 0;
    migrated = true;
  }
  /* v4: the module carries its own piano, so nothing outside it has to be set
   * up for a note to be heard. */
  if (storedVersion < 4 && settings.midiOut !== OUT_INTERNAL) {
    settings.midiOut = OUT_INTERNAL;
    migrated = true;
  }
  if (storedVersion !== SETTINGS_VERSION) {
    settings.version = SETTINGS_VERSION;
    migrated = true;
  }
  /* Only write when something actually changed: opening the module used to
   * cost a flash write every time. */
  if (migrated) saveSettings();

  midiChannel = settings.midiCh > 0 ? settings.midiCh - 1 : 0;
}

/*
 * Settings are saved lazily. editSetting() runs once per encoder step and the
 * host batches those one-per-tick at up to 500Hz, so writing the file inline
 * would put a blocking eMMC write in the frame path and chew through flash for
 * one spin of a knob. Mark dirty, flush at most once a second, and always flush
 * on the way out.
 */
let settingsDirty = false;
let lastSaveMs = 0;
const SAVE_INTERVAL_MS = 1000;

function saveSettings() {
  settingsDirty = true;
}

function loadStats() {
  stats = STATS.parseStats(readFile(STATS_PATH));
}

/* One write per finished round — small, and rare enough not to need pacing. */
function saveStats() {
  writeFile(STATS_PATH, STATS.serialiseStats(stats));
}

function flushSettings(force) {
  if (!settingsDirty) return;
  const t = now();
  if (!force && t - lastSaveMs < SAVE_INTERVAL_MS) return;
  lastSaveMs = t;
  settingsDirty = false;
  writeFile(SETTINGS_PATH, JSON.stringify(settings));
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/* ---- State machine ------------------------------------------------------ */
const MENU = 'menu';
const READY = 'ready';
const RUNNING = 'running';
const SUMMARY = 'summary';
const SETTINGS = 'settings';
const GUESS_VIEW = 'guess';
const RESULT_VIEW = 'result';
const PROGRESS_VIEW = 'progress';

let view = MENU;
let chart = null;
let run = null;
let songBeats = 0;
let prevBeats = 0;
let runStartMs = 0;
let countInBeats = 0;
let waitedBeats = 0;   /* time absorbed while the scroll was frozen */
let blocked = false;   /* frozen right now, waiting for a note */
let listening = false;      /* Record = hear the exercise instead of playing it */
let listenIndex = 0;
let listenOff = [];         /* [{ pitch, atBeats }] */
let shiftHeld = false;
let dirty = true;
let beatFlash = 0;          /* ms timestamp the current beat marker started */
let lastDrawMs = 0;
const DRAW_INTERVAL_MS = 20; /* ~50Hz; the panel cannot show more */
const LED_INTERVAL_MS = 20;
let lastLedMs = 0;

let stats = STATS.emptyStats();
let lastResult = null;       /* the round just finished, for the result screen */
let progressDrills = [];     /* drills with history, most recent first */
let progressIndex = 0;
let quiz = null;
let quizHear = false;        /* ear training: the prompt is played, not shown */
let quizPick = false;        /* multiple choice: the pad is lit, you name it */
let quizSolvedAt = 0;        /* brief confirmation before the next prompt */
const guessOff = [];         /* ms-scheduled note-offs; the quiz has no clock */
const GUESS_ADVANCE_MS = 450;

let menuRows = [];
let menuCursor = 0;
let selectedIndex = -1;   /* the armed exercise, which the cursor may have left */
let fileExercises = [];
let ledPhase = -1;        /* Play-button pulse, so we only write on a change */

let settingsCursor = 0;
let settingsEditing = false;

/* Pad feedback: pad -> { color, untilMs } */
const padFlash = {};
const heldPads = {};
let ledDirty = true;

/* ---- Exercises ---------------------------------------------------------- */
function generatorOptions() {
  return {
    rootPc: settings.rootPc,
    mode: settings.mode,
    bpm: settings.bpm,
    transpose: settings.transpose,
    seed: 1,
  };
}

function loadFileExercises() {
  fileExercises = [];
  const manifestText = readFile(MODULE_DIR + '/exercises/index.json');
  if (!manifestText) return;
  const rows = parseManifest(manifestText);
  for (let i = 0; i < rows.length; i++) {
    const text = readFile(MODULE_DIR + '/exercises/' + rows[i].file);
    if (!text) continue;
    const { chart: parsed } = parseExercise(text, rows[i].id);
    if (parsed) fileExercises.push(parsed);
  }
}

function rebuildMenu() {
  /* The guesser is a mode, not an exercise, but putting it in the one list you
   * already open means no new screen and no new gesture — and which entry you
   * pick is also how you choose notes or chords. */
  menuRows = [
    { label: 'Progress', progress: true, value: '~' },
    { label: 'Guess: notes', guess: GUESS.NOTES, value: '?' },
    { label: 'Guess: chords', guess: GUESS.CHORDS, value: '?' },
    { label: 'Hear: notes', guess: GUESS.NOTES, hear: true, value: '♪' },
    { label: 'Hear: chords', guess: GUESS.CHORDS, hear: true, value: '♪' },
    { label: 'Pick: notes', guess: GUESS.NOTES, pick: true, value: '3' },
    { label: 'Pick: chords', guess: GUESS.CHORDS, pick: true, value: '3' },
  ];
  const gen = GEN.builtins(generatorOptions());
  for (const g of gen) menuRows.push({ label: g.label, build: g.build, value: '' });
  for (let i = 0; i < fileExercises.length; i++) {
    const c = fileExercises[i];
    menuRows.push({ label: c.name, build: () => c, value: 'f' });
  }
  if (menuCursor >= menuRows.length) menuCursor = Math.max(0, menuRows.length - 1);
}

function currentDrill() {
  return STATS.drillId({
    hear: quizHear,
    pick: quizPick,
    kind: quiz ? quiz.kind : GUESS.NOTES,
    chordSet: settings.chordSet,
    halfTones: settings.halfTones,
  });
}

function openProgress() {
  progressDrills = STATS.drillsWithHistory(stats);
  progressIndex = 0;
  view = PROGRESS_VIEW;
  dirty = true;
  ledDirty = true;
  announce('Progress.');
}

/*
 * A round is over. Record it, then show the result — the rate on its own says
 * nothing, so the screen also says whether it beat the drill's best.
 */
function finishRound() {
  const drill = currentDrill();
  const ms = GUESS.roundElapsed(quiz, now());
  const rec = STATS.makeRecord({
    drill, n: quiz.correct, ms, wrong: quiz.wrong, hints: quiz.hintsUsed, at: Date.now(),
  });
  const best = STATS.summarise(STATS.forDrill(stats, drill)).best;
  lastResult = {
    drill,
    rate: STATS.recordRate(rec),
    ms,
    n: quiz.correct,
    wrong: quiz.wrong,
    hints: quiz.hintsUsed,
    bestStreak: quiz.bestStreak,
    isBest: STATS.isPersonalBest(stats, rec),
    best,
  };
  STATS.addRecord(stats, rec);
  /* After the append, so the chart's last point is the round you just played.
   * `best` above is deliberately taken before it — that is the number you were
   * trying to beat, not the one you have just set. */
  lastResult.records = STATS.forDrill(stats, drill);
  saveStats();
  allNotesOff();
  view = RESULT_VIEW;
  dirty = true;
  ledDirty = true;
  announce('Round done. ' + Math.round(lastResult.rate) + ' per minute.'
    + (lastResult.isBest ? ' Best yet.' : ''));
}

function startQuiz(kind, hear, pick) {
  allNotesOff();
  quizHear = Boolean(hear);
  quizPick = Boolean(pick);
  quiz = GUESS.createQuiz({
    kind,
    rootPc: settings.rootPc,
    mode: settings.mode,
    transpose: settings.transpose,
    halfTones: settings.halfTones,
    chordSet: settings.chordSet,
    pick: quizPick,
    roundSize: settings.roundSize,
    fifths: keyFifths(),
    seed: (Date.now() & 0x7fffffff) || 1,
  });
  quizSolvedAt = 0;
  view = GUESS_VIEW;
  dirty = true;
  ledDirty = true;
  if (quizPick) {
    announce('Name the lit pad. Jog to choose, click to answer.');
  } else if (quizHear) {
    hearPrompt();
    announce('Ear training. Listen, then play what you hear.');
  } else {
    announce('Note guesser. Play ' + promptName() + '.');
  }
}

/* What the prompt is called: its chord symbol if it has one, else its notes. */
function promptName() {
  if (!quiz) return '';
  return quiz.label || NOTATION.chordLabel(quiz.prompt, keyFifths());
}

function keyFifths() {
  return NOTATION.majorKeyFifths(settings.rootPc);
}

function selectExercise(index) {
  const row = menuRows[index];
  if (!row) return;
  selectedIndex = index;
  menuCursor = index;
  if (row.progress) {
    openProgress();
    return;
  }
  if (row.guess) {
    startQuiz(row.guess, row.hear, row.pick);
    return;
  }
  chart = row.build();
  if (chart.source !== 'file') chart.bpm = settings.bpm;
  armRun();
  view = READY;
  announce(chart.name + '. Press play to start.');
  dirty = true;
  ledDirty = true;
}

function armRun() {
  run = SCORE.createRun(chart, {
    bpm: chart.bpm,
    anyOctave: settings.anyOctave,
  });
  songBeats = -settings.countIn;
  prevBeats = songBeats;
  countInBeats = settings.countIn;
  waitedBeats = 0;
  blocked = false;
  lastClickBeat = null;
  listenIndex = 0;
  listenOff = [];
}

function startRun(listen) {
  armRun();
  listening = Boolean(listen);
  runStartMs = now();
  view = RUNNING;
  dirty = true;
  ledDirty = true;
  announce(listen ? 'Listening.' : 'Go.');
}

function stopRun() {
  allNotesOff();
  listening = false;
  view = chart ? READY : MENU;
  dirty = true;
  ledDirty = true;
}

/* ---- LEDs --------------------------------------------------------------- */
function targetPadsNow() {
  /* The next unresolved entry, if guidance is on. */
  if (!settings.guidance || !run || view !== RUNNING) return null;
  const entry = run.entries[run.cursor];
  if (!entry) return null;
  const lead = entry.beat - songBeats;
  if (lead < -0.5 || lead > 2) return null;
  const near = lead < 0.75;
  const pads = [];
  for (let i = 0; i < entry.notes.length; i++) {
    if (entry.notes[i].state !== SCORE.PENDING) continue;
    const forPitch = PAD.padsForPitch(entry.notes[i].pitch, settings.transpose);
    for (let p = 0; p < forPitch.length; p++) pads.push(forPitch[p]);
  }
  return { pads, color: near ? PAD.LED_TARGET_NEAR : PAD.LED_TARGET_FAR };
}

/*
 * Which pitches want lighting, as three small reused arrays. led_paint turns
 * pitches into pads; this only decides which ones qualify.
 */
const targetBuf = [];
const stuckBuf = [];
const soundingBuf = [];

/* Guidance ahead of time: the next unresolved entry, if Guide pads is on. */
function collectTarget() {
  targetBuf.length = 0;
  if (!settings.guidance || !run || view !== RUNNING) return false;
  const entry = run.entries[run.cursor];
  if (!entry) return false;
  const lead = entry.beat - songBeats;
  if (lead < -0.5 || lead > 2) return false;
  for (let i = 0; i < entry.notes.length; i++) {
    if (entry.notes[i].state === SCORE.PENDING) targetBuf.push(entry.notes[i].pitch);
  }
  return lead < 0.75;
}

/*
 * The note the scroll is stuck on.
 *
 * Keyed off the WAIT pointer, not the scoring cursor: the instant a note is
 * missed, advanceCursor moves the scoring cursor past it and its state stops
 * being PENDING, so collectTarget above can never light a missed note — which
 * is exactly the note you need shown. "Only if missed" comes for free, because
 * an entry only starts blocking once its window has closed.
 */
function collectStuck() {
  stuckBuf.length = 0;
  if (!settings.guidance || !run || view !== RUNNING || !blocked) return;
  const stuck = SCORE.blockingNotes(run);
  for (let i = 0; i < stuck.length; i++) stuckBuf.push(stuck[i].pitch);
}

/*
 * Whatever is sounding right now, for Listen — watching the notes light up is
 * the whole point of that mode, so unlike the guidance hint it is never gated
 * on a setting. Read from pitchRefcount, which is exactly what is down; the
 * metronome click lives there too but its pitches sit outside the grid.
 *
 * Nothing lights the answer in the guessing and hearing modes. Guide pads is a
 * playing aid; in a quiz the hint IS the answer.
 */
/* The lit pad IS the question in the multiple-choice drill. */
const promptBuf = [];

function collectPrompt() {
  promptBuf.length = 0;
  if (!quiz || view !== GUESS_VIEW) return;
  /* Lit always in the picking drill, where the pad IS the question; and in the
   * others only once you have climbed to the top of the help ladder. */
  if (!quizPick && quiz.hint < GUESS.MAX_HINT) return;
  for (let i = 0; i < quiz.prompt.length; i++) promptBuf.push(quiz.prompt[i]);
}

function collectSounding() {
  soundingBuf.length = 0;
  if (!listening || view !== RUNNING) return;
  for (const key in pitchRefcount) soundingBuf.push(+key);
}

/* One reused descriptor and one reused output array: this runs in the frame
 * path and must not produce garbage. */
const ledState = {
  transpose: 0, rootPc: 0, intervals: null, phase: 0, now: 0,
  heldPads: null, flashes: null,
  soundingPitches: null, stuckPitches: null, targetPitches: null, targetNear: false,
  promptPitches: null,
};
/*
 * Momentary pad feedback: a judgement that just landed. Outranks everything
 * else in led_paint, including a held pad, for as long as it lasts.
 */
function flashPad(pad, color, ms) {
  padFlash[pad] = { color, untilMs: now() + (ms || 150) };
  ledDirty = true;
}

/* Every pad that sounds this pitch — the grid has twins. */
function flashPitch(pitch, color) {
  const pads = PAD.padsForPitch(pitch, settings.transpose);
  for (let i = 0; i < pads.length; i++) flashPad(pads[i], color);
}

const ledWorkspace = LEDS.createLedState();
const padColorBuf = new Array(PAD.PAD_COUNT);

function paintPads() {
  const near = collectTarget();
  collectStuck();
  collectSounding();
  collectPrompt();

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
  const ledView = view === GUESS_VIEW ? CTRL.GUESS : view;
  setButtonLED(CC_PLAY, CTRL.playLedColor(ledView, ledPhase, listening));
  setButtonLED(CC_RECORD, CTRL.recordLedColor(ledView, listening, ledPhase,
    Boolean(quiz && GUESS.hintsLeft(quiz) === 0)));
}

/* ---- Metronome and listen playback -------------------------------------- */
let lastClickBeat = null;

function serviceClick() {
  const beat = Math.floor(songBeats);
  if (beat === lastClickBeat) return;
  lastClickBeat = beat;
  beatFlash = now();
  if (!settings.click) return;
  const perBar = beatsPerBar(chart);
  const downbeat = ((beat % perBar) + perBar) % perBar === 0;
  /* Short, high, and out of the way of anything the exercise plays.
   * Goes through noteOn, not a raw midiOut: allNotesOff can only silence what
   * pitchRefcount knows about, and a click sent behind its back was left
   * ringing when the module closed between the note-on and its scheduled off. */
  const pitch = downbeat ? 96 : 91;
  noteOn(pitch, downbeat ? 90 : 55);
  listenOff.push({ pitch, atBeats: songBeats + 0.1 });
}

/*
 * Sound the exercise itself as it crosses the hit line, so you hear the line
 * you are meant to be playing and can play along with it rather than reading
 * in silence. On by default; off in settings for unaided reading.
 *
 * Listen mode is the same mechanism at full velocity — it is this with the
 * playing taken away — so both go through here.
 *
 * Softer than your own pads (refVel vs. real pad velocity) so the two are
 * distinguishable: when you are in time you hear one note, when you are not
 * you hear a flam.
 */
function serviceReference() {
  if (songBeats < 0) return;  /* nothing to sound during the count-in */
  const vel = CTRL.referenceVelocity(listening, settings.reference, settings.refVel);
  const silent = vel <= 0;
  while (listenIndex < chart.events.length && chart.events[listenIndex].beat <= songBeats) {
    const e = chart.events[listenIndex++];
    /* The cursor advances either way, so switching reference on mid-run starts
     * from the note under the playhead rather than dumping the whole backlog. */
    if (silent) continue;
    for (let i = 0; i < e.pitches.length; i++) {
      noteOn(e.pitches[i], vel);
      listenOff.push({ pitch: e.pitches[i], atBeats: e.beat + (e.durBeats || 1) * 0.9 });
    }
  }
}

/* Play the prompt so you can hear what you are hunting for. */
/*
 * Help, a rung at a time. What each rung does depends on what the drill is
 * withholding — see takeHint in guess.mjs. The count is kept and shown; a hint
 * you are afraid to use is a hint that does not help you learn.
 */
function takeHint() {
  if (!quiz || quiz.solved) return;
  const before = quiz.hint;
  const level = GUESS.takeHint(quiz, quiz.rand);
  if (level === before) return;         /* ladder already used up */

  /* Reading: rung one sounds it. Hearing withholds the name, so rung one is
   * purely what the screen now shows. Picking strikes an option, done above. */
  if (level === 1 && !quizHear && !quizPick) hearPrompt();

  dirty = true;
  ledDirty = true;
}

function hearPrompt() {
  if (!quiz || !quiz.prompt.length) return;
  const until = now() + 900;
  for (let i = 0; i < quiz.prompt.length; i++) {
    noteOn(quiz.prompt[i], 90);
    guessOff.push({ pitch: quiz.prompt[i], atMs: until });
  }
}

/* The guesser has no musical clock, so its note-offs run on wall time. */
function serviceGuess() {
  const t = now();
  for (let i = guessOff.length - 1; i >= 0; i--) {
    if (guessOff[i].atMs > t) continue;
    noteOff(guessOff[i].pitch);
    guessOff.splice(i, 1);
  }
  if (quizSolvedAt && t - quizSolvedAt >= GUESS_ADVANCE_MS) {
    quizSolvedAt = 0;
    if (GUESS.roundComplete(quiz)) {
      finishRound();
      return;
    }
    GUESS.nextPrompt(quiz);
    dirty = true;
    ledDirty = true;
    if (quizHear) {
      hearPrompt();
      announce('Listen.');
    } else {
      announce(promptName());
    }
  }
}

function serviceNoteOffs() {
  for (let i = listenOff.length - 1; i >= 0; i--) {
    if (listenOff[i].atBeats > songBeats) continue;
    noteOff(listenOff[i].pitch);
    listenOff.splice(i, 1);
  }
}

/* ---- Drawing ------------------------------------------------------------ */
function draw() {
  if (view === MENU) {
    VIEW.drawList(ctx, 'EXERCISE', menuRows, menuCursor, {
      footer: VIEW.SETTINGS_HINT,
      centreFooter: true,
    });
  } else if (view === SETTINGS) {
    VIEW.drawList(ctx, 'SETTINGS', settingsRows(), settingsCursor, {
      footer: settingsEditing ? 'turn change  CLICK ok' : 'CLICK edit SHIFT back',
      editing: settingsEditing,
    });
  } else if (view === RESULT_VIEW) {
    VIEW.drawRoundResult(ctx, lastResult);
  } else if (view === PROGRESS_VIEW) {
    const drill = progressDrills[progressIndex] || null;
    VIEW.drawProgress(ctx, {
      drill,
      records: drill ? STATS.forDrill(stats, drill) : [],
      drillIndex: progressIndex,
      drillCount: progressDrills.length,
    });
  } else if (view === GUESS_VIEW && quizPick) {
    VIEW.drawPick(ctx, {
      title: quiz.kind === GUESS.CHORDS ? 'NAME CHORD' : 'NAME NOTE',
      score: quiz.roundSize > 0
        ? quiz.correct + '/' + quiz.roundSize
        : String(GUESS.quizStats(quiz).correct),
      options: quiz.choices.map((c) => GUESS.optionLabel(quiz, c)),
      index: quiz.choiceIndex,
      eliminated: quiz.eliminated,
      hint: quiz.solved ? 'right' : 'which pad is lit?',
      footer: GUESS.hintsLeft(quiz)
        ? 'JOG pick  REC help'
        : 'JOG pick  CLICK ok',
    });
  } else if (view === GUESS_VIEW) {
    const st = GUESS.quizStats(quiz);
    VIEW.drawGuessView(ctx, {
      prompt: quiz.prompt,
      fifths: keyFifths(),
      solved: quiz.solved,
      hidden: quizHear && !quiz.solved,
      hint: quiz.hint,
      label: quiz.label,
      title: quizHear ? 'HEAR' : (quiz.kind === GUESS.CHORDS ? 'CHORD' : 'NOTE'),
      score: quiz.roundSize > 0
        ? quiz.correct + '/' + quiz.roundSize
        : st.correct + '/' + st.asked,
      footer: GUESS.hintsLeft(quiz)
        ? 'streak ' + st.streak + '   REC help'
        : 'hint ' + quiz.hint + '/' + GUESS.MAX_HINT + '   streak ' + st.streak,
    });
  } else if (view === SUMMARY) {
    VIEW.drawSummary(ctx, chart, run);
  } else if (view === READY) {
    VIEW.drawReadyView(ctx, {
      chart,
      run,
      songBeats: 0,
      pxPerBeat: settings.pxPerBeat,
      outLabel: SET.formatSetting(settings, SET.settingIndex('midiOut')) + ' ' +
                SET.formatSetting(settings, SET.settingIndex('midiCh')),
    });
  } else {
    VIEW.drawReadingView(ctx, {
      chart,
      run,
      songBeats,
      pxPerBeat: settings.pxPerBeat,
      beatFlash: now() - beatFlash < 90,
      blocked,
    });
  }
}

function settingsRows() {
  return SET.settingsRows(settings);
}

function editSetting(index, delta) {
  const wasWaiting = settings.waitForNote;
  const res = SET.applySetting(settings, index, delta);
  if (!res.changed) return;

  if (res.key === 'midiOut') allNotesOff();
  if (res.key === 'midiCh') {
    /* Anything sounding is sounding on the old channel, and nothing we send
     * afterwards would reach it. */
    allNotesOff();
    midiChannel = settings.midiCh > 0 ? settings.midiCh - 1 : 0;
  }
  if (res.key === 'rootPc' || res.key === 'mode' || res.key === 'transpose') rebuildMenu();

  /* Switching wait on mid-run would otherwise park the clock on a note from
   * before the setting existed, i.e. drag songBeats backwards. */
  if (res.key === 'waitForNote' && settings.waitForNote && !wasWaiting && run) {
    SCORE.resyncWait(run, songBeats);
  }

  saveSettings();

  /* A quiz draws its questions from the key, scale and octave, so those have to
   * rebuild it. Its menu row has no `build` — it is a mode, not an exercise —
   * and calling one here used to throw the moment you turned the key knob with
   * a quiz open. */
  if ((res.rebuild || res.key === 'halfTones' || res.key === 'chordSet') &&
      view === GUESS_VIEW && quiz) {
    startQuiz(quiz.kind, quizHear);
  } else if (res.rebuild && CTRL.shouldRebuildChart(view, chart && chart.source)) {
    const row = menuRows[selectedIndex];
    if (row && row.build) {
      chart = row.build();
      if (chart.source !== 'file') chart.bpm = settings.bpm;
      armRun();
      if (view === SUMMARY) view = READY;
    }
  }
  ledDirty = true;
  dirty = true;
}

/* ---- Input -------------------------------------------------------------- */
function onPadDown(pad, vel) {
  heldPads[pad] = 1;
  ledDirty = true;
  const pitch = PAD.padPitch(pad, settings.transpose);
  noteOn(pitch, vel);

  if (view === GUESS_VIEW && quizPick) {
    /* The pads are the question here; pressing one just sounds it. */
    return;
  }
  if (view === GUESS_VIEW) {
    const res = GUESS.pressPitch(quiz, pitch, now());
    if (res === GUESS.WRONG) flashPad(pad, PAD.LED_MISS, 200);
    else if (res === GUESS.CORRECT) {
      quizSolvedAt = now();
      for (const pitchOf of quiz.prompt) flashPitch(pitchOf, PAD.LED_HIT);
    }
    dirty = true;
    return;
  }
  if (view !== RUNNING || listening) return;
  /* Every press leaves a mark at the exact moment it happened, right or wrong —
   * seeing what you actually played, and when, is the point. */
  SCORE.addMarker(run, pitch, songBeats);
  const j = SCORE.judgeNoteOn(run, pitch, songBeats);
  if (j.result === 'stray') {
    flashPad(pad, PAD.LED_MISS, 120);
  } else {
    flashPitch(pitch, j.result === 'late' ? PAD.LED_MISS : PAD.LED_HIT);
  }
  dirty = true;
}

function onPadUp(pad) {
  delete heldPads[pad];
  ledDirty = true;
  const pitch = PAD.padPitch(pad, settings.transpose);
  if (view === GUESS_VIEW && quiz) GUESS.releasePitch(quiz, pitch);
  noteOff(pitch);
}

function onJog(delta) {
  /* The one view where the jog is the answer rather than navigation. */
  if (view === GUESS_VIEW && quizPick && quiz && !quiz.solved) {
    GUESS.moveChoice(quiz, delta, now());
    dirty = true;
    return;
  }
  if (view === PROGRESS_VIEW) {
    if (progressDrills.length > 1) {
      progressIndex = (progressIndex + (delta > 0 ? 1 : -1) + progressDrills.length)
        % progressDrills.length;
      dirty = true;
    }
    return;
  }
  if (view === SETTINGS) {
    if (settingsEditing) editSetting(settingsCursor, delta);
    else settingsCursor = clamp(settingsCursor + delta, 0, settingsRows().length - 1);
    dirty = true;
    return;
  }
  /* A nudge mid-exercise used to drop straight back to the menu and abandon the
   * run. jogAction ignores it while RUNNING and steps to the neighbouring
   * exercise from READY, rather than leaving. */
  const next = CTRL.jogAction(view, delta, menuCursor, menuRows.length);
  if (next.action !== 'cursor') return;
  menuCursor = next.index;
  dirty = true;
}

function onJogClick() {
  if (view === GUESS_VIEW && quizPick && quiz && !shiftHeld) {
    if (quiz.solved) return;
    const res = GUESS.pickChoice(quiz, now());
    if (res === GUESS.CORRECT) quizSolvedAt = now();
    dirty = true;
    ledDirty = true;
    return;
  }
  switch (CTRL.jogClickAction(view, shiftHeld, Boolean(chart))) {
    case 'settings':
      view = SETTINGS;
      settingsEditing = false;
      break;
    case 'ready':
      view = READY;
      settingsEditing = false;
      break;
    case 'toggle-edit':
      settingsEditing = !settingsEditing;
      break;
    case 'open':
      selectExercise(menuCursor);
      break;
    default:
      view = MENU;
      break;
  }
  dirty = true;
}

function onKnob(index, delta) {
  if (index === 0) editSetting(0, delta);
  else if (index === 1) editSetting(1, delta);
  else if (index === 2) editSetting(2, delta > 0 ? 1 : -1);
  else if (index === 3) editSetting(3, delta > 0 ? 1 : -1);
}

/* ---- Lifecycle ---------------------------------------------------------- */
globalThis.init = function init() {
  view = MENU;
  chart = null;
  run = null;
  songBeats = 0;
  prevBeats = 0;
  listening = false;
  shiftHeld = false;
  menuCursor = 0;
  selectedIndex = -1;
  settingsCursor = 0;
  settingsEditing = false;
  quiz = null;
  quizHear = false;
  quizPick = false;
  lastResult = null;
  progressDrills = [];
  progressIndex = 0;
  quizSolvedAt = 0;
  guessOff.length = 0;
  ledPhase = -1;
  lastClickBeat = null;
  lastDrawMs = 0;
  lastLedMs = 0;
  settingsDirty = false;
  lastSaveMs = 0;
  pendingExitAt = 0;
  panicChannelNext = 16;
  for (const k in heldPads) delete heldPads[k];
  for (const k in padFlash) delete padFlash[k];
  for (const k in pitchRefcount) delete pitchRefcount[k];

  loadSettings();
  loadStats();
  loadFileExercises();
  rebuildMenu();
  invalidateLedCache();
  ledDirty = true;
  dirty = true;
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

  if (view === RUNNING) {
    prevBeats = songBeats;
    const raw = msToBeats(t - runStartMs, chart.bpm) - countInBeats;

    /* Resolve first, then decide where the clock may be. A note only blocks
     * once its own window has closed, and expireMissed is what closes it — the
     * other order would freeze the clock a frame before the note was scored,
     * leaving nothing able to release it. */
    const waiting = settings.waitForNote && !listening;
    const provisional = raw - waitedBeats;
    if (!listening && provisional >= 0) SCORE.expireMissed(run, provisional, waiting);

    const block = waiting ? SCORE.blockingBeat(run, settings.graceBeats) : null;
    const clock = applyWait(raw, waitedBeats, block);
    songBeats = clock.songBeats;
    waitedBeats = clock.waitedBeats;
    blocked = clock.blocked;

    if (isBeatEdge(prevBeats, songBeats)) serviceClick();
    serviceReference();
    serviceNoteOffs();
    SCORE.pruneMarkers(run, xToBeat(L.DESPAWN_X, songBeats, settings.pxPerBeat));
    if (SCORE.runFinished(run, songBeats, blocked) ||
        (listening && songBeats > chartTotalBeats(chart))) {
      allNotesOff();
      listening = false;
      view = SUMMARY;
      const s = SCORE.runStats(run);
      announce('Done. ' + s.hits + ' of ' + s.total + ', ' + Math.round(s.accuracy * 100) + ' percent.');
    }
    dirty = true;
  }

  /* Repaint when the pulse flips, so the cached setLED emits one packet per
   * change instead of one per tick — the overtake queue only flushes 16. */
  const phase = CTRL.pulsePhase(t);
  if (phase !== ledPhase) {
    ledPhase = phase;
    ledDirty = true;
  }

  if (view === GUESS_VIEW) serviceGuess();
  if (blocked) dirty = true;   /* keep the callout and the pulse alive */
  /* A press repaints immediately — not seeing your own pad light up feels
   * broken. Only the time-driven repaint is capped, to the panel's rate: it
   * used to run at the full 500Hz tick to animate a pulse that changes twice a
   * second. */
  if (ledDirty || (view === RUNNING && t - lastLedMs >= LED_INTERVAL_MS)) {
    lastLedMs = t;
    paintPads();
    ledDirty = false;
  }

  flushSettings(false);
  flushDsp();
  flushOutbox(false);

  /* ~50Hz: the panel refreshes at about 49Hz, so anything faster is wasted. */
  if (dirty && t - lastDrawMs >= DRAW_INTERVAL_MS) {
    lastDrawMs = t;
    dirty = false;
    draw();
  }
};

globalThis.onMidiMessageInternal = function onMidiMessageInternal(data) {
  if (!data || data.length < 3) return;
  const status = data[0] & 0xf0;
  const d1 = data[1];
  const d2 = data[2];

  if (status === 0x90 || status === 0x80) {
    if (d1 < 10) return; /* knob capacitive touch */
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
    onJogClick();
    return;
  }
  /* Play listens, Record practises: at an instrument "play" means play it to
   * me, and "record" means capture what I do. Pressing the running mode's own
   * button stops it; pressing the other switches, so no press is ever a no-op. */
  if (d1 === CC_PLAY) {
    if (view === RESULT_VIEW) {
      startQuiz(quiz.kind, quizHear, quizPick);
      return;
    }
    if (view === GUESS_VIEW) {
      hearPrompt();
      return;
    }
    if (view === RUNNING && listening) stopRun();
    else if (chart) startRun(true);
    else selectExercise(menuCursor);
    return;
  }
  if (d1 === CC_RECORD) {
    if (view === RESULT_VIEW) {
      startQuiz(quiz.kind, quizHear, quizPick);
      return;
    }
    if (view === GUESS_VIEW) {
      takeHint();
      return;
    }
    if (view === RUNNING && !listening) stopRun();
    else if (chart) startRun(false);
    else selectExercise(menuCursor);
    return;
  }
  /* Move's Menu button reached the module and was ignored, so the hardware
   * control most likely to be pressed looking for a menu did nothing. */
  if (d1 === CC_MENU) {
    view = MENU;
    settingsEditing = false;
    dirty = true;
    return;
  }
  if (d1 === CC_BACK) {
    /* Plain Back steps up one level, which from a running exercise is three
     * presses to get out. Shift+Back leaves immediately from anywhere — the
     * same gesture Schwung uses for a full exit elsewhere. */
    if (shiftHeld) {
      exitModule();
      return;
    }
    if (view === SETTINGS || view === SUMMARY) {
      view = chart ? READY : MENU;
      dirty = true;
      return;
    }
    if (view === RUNNING) {
      stopRun();
      return;
    }
    if (view === RESULT_VIEW || view === PROGRESS_VIEW) {
      view = MENU;
      dirty = true;
      ledDirty = true;
      return;
    }
    if (view === READY || view === GUESS_VIEW) {
      allNotesOff();
      view = MENU;
      dirty = true;
      ledDirty = true;
      return;
    }
    exitModule();
  }
};

/* Nothing to do with external MIDI yet — declared so the host's per-tick
 * encoder flush has a handler to talk to. */
globalThis.onMidiMessageExternal = function onMidiMessageExternal(_data) {};

globalThis.onResume = function onResume() {
  invalidateLedCache();
  ledDirty = true;
  dirty = true;
};

globalThis.onUnload = function onUnload() {
  allNotesOff();
  flushSettings(true);
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
  allNotesOff();
  listening = false;
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
  flushSettings(true);
  if (typeof host_exit_module === 'function') host_exit_module();
}
