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
import * as PROG from './progress.mjs';
import * as PLAN from './program.mjs';
import * as AP from './answer_pads.mjs';
import * as NOTATION from './notation.mjs';
import {
  msToBeats, beatsToMs, chartTotalBeats, beatsPerBar, isBeatEdge, applyWait, xToBeat,
} from './chart.mjs';
import { parseExercise, parseManifest, parseCategories } from './exercise_io.mjs';
import * as CAT from './catalog.mjs';

/* ---- Host bindings ------------------------------------------------------ */
/* Several documented host_* functions do not exist on device; guard them all. */

const MODULE_DIR = '/data/UserData/schwung/modules/tools/piano-practice';
const SETTINGS_PATH = MODULE_DIR + '/settings.json';
const STATS_PATH = MODULE_DIR + '/stats.json';
const PROGRESS_PATH = MODULE_DIR + '/progress.json';

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

/*
 * ALWAYS STRIKE. The refcount decides when a note STOPS, never whether it
 * starts.
 *
 * It used to gate both, and that swallowed notes whenever two sources wanted
 * one pitch — which is the normal case in Listen, where the reference melody
 * and your own hands are playing the same tune. Whichever asked second got
 * silence: hold a note the reference is about to play and the reference note
 * vanishes; press a note it is already holding and your press makes no sound.
 * The same pitch also sits on two pads of an isomorphic grid, so two fingers
 * on the same note did it too.
 *
 * A piano re-strikes, so re-striking is also the musically right answer, and
 * the DSP is built for it: pick_voice reuses the voice already on that pitch
 * rather than stacking a second one. Downstream MIDI sees two note-ons and
 * one note-off, which is what any keyboard sends when you repeat a held note.
 */
function noteOn(pitch, vel) {
  if (pitch < 0 || pitch > 127) return;
  pitchRefcount[pitch] = (pitchRefcount[pitch] || 0) + 1;
  if (settings.midiOut & OUT_INTERNAL) dspNote(pitch, vel || 100);
  if (settings.midiOut & (OUT_TRACK | OUT_USB)) midiOutCh(0x90, pitch, vel || 100);
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
  guessOn.length = 0;
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
const SETTINGS_VERSION = 7;

const settings = {
  version: SETTINGS_VERSION,
  bpm: 80,
  pxPerBeat: L.PX_PER_BEAT_DEFAULT,
  rootPc: 0,
  mode: 'major',
  transpose: PAD.DEFAULT_TRANSPOSE,
  anyOctave: false,
  halfTones: true,   /* the guesser asks about black notes too */
  roundSize: 20,     /* prompts per round; 0 = endless practice, unrecorded */
  chordSet: 'triads',
  click: true,
  reference: true,   /* hear the line you are meant to be playing */
  midiOut: OUT_INTERNAL, /* our own piano: always works, needs no setup */
  waitForNote: true, /* stop at a note until it is played */
  graceBeats: 1,     /* beats you may be late before the scroll waits for you */
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
  /* v5: a third of a beat is 250ms at 80bpm, and the music stopped while the
   * hand was still moving. A beat is long enough to find the key. Anyone who
   * chose a grace deliberately keeps it; only the old default is moved. */
  if (storedVersion < 5 && settings.graceBeats === 1 / 3) {
    settings.graceBeats = 1;
    migrated = true;
  }
  /* v6: the scale list became Move's own twenty-two, and `pentatonic` is
   * `majorPent` in it. coerceInto drops a stored value that is no longer in
   * the list, so without this anyone who had chosen it would silently be
   * playing in major. */
  if (storedVersion < 6 && settings.mode === 'pentatonic') {
    settings.mode = 'majorPent';
    migrated = true;
  }
  /* v7: Guide pads became each exercise's stage — stage 1 lights the pads,
   * stage 2 does not — so the stored setting is simply no longer read, and
   * writing the file drops it. */
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

function loadProgress() {
  progress = PROG.parseProgress(readFile(PROGRESS_PATH));
}

/* One write per finished attempt or skip, like the stats. */
function saveProgress() {
  writeFile(PROGRESS_PATH, PROG.serialiseProgress(progress));
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
const SETTINGS = 'settings';
const GUESS_VIEW = 'guess';
/* controls.mjs's name for it, so Play and Record pulse here as they do on the
 * ready screen: both start the next attempt. */
const RESULT_VIEW = CTRL.SUMMARY;
const PROGRESS_VIEW = 'progress';
const PROGRESS_DETAIL = 'progress-detail';

let view = MENU;
let chart = null;
let run = null;
let songBeats = 0;
let prevBeats = 0;
let runStartMs = 0;
let countInBeats = 0;
let waitedBeats = 0;   /* time absorbed while the scroll was frozen */
/* `waitedBeats` as it was when the current freeze began, or null when nothing
 * is frozen. It is what lets the judge keep real time while the scroll sits
 * on the note — see applyWait. */
let frozenAt = null;
/* The honest clock: equal to songBeats except while frozen, when it runs on.
 * Everything that SCORES reads this; everything that DRAWS reads songBeats. */
let scoreBeats = 0;
let blocked = false;   /* frozen right now, waiting for a note */
let listening = false;      /* Record = hear the exercise instead of playing it */
let listenIndex = 0;
/* Transport. `paused` holds the playhead where it is instead of throwing the
 * position away, so you can scrub and carry on from wherever you land. */
let paused = false;
let pausedAtMs = 0;
/* The playhead was moved by the scrub knob since the music last ran, so the
 * pads show the note it has landed on. A fresh ready screen leaves them dark. */
let scrubCue = false;
/*
 * Scrub sensitivity: this many knob units to a bar, applied continuously.
 * Roughly a turn and a half — three times slower than the first attempt, which
 * was too quick to land on a spot by hand.
 */
const SCRUB_UNITS_PER_BAR = 36;
let listenOff = [];         /* [{ pitch, atBeats }] */
let shiftHeld = false;
let dirty = true;
let beatFlash = 0;          /* ms timestamp the current beat marker started */
let lastDrawMs = 0;
const DRAW_INTERVAL_MS = 20; /* ~50Hz; the panel cannot show more */
const LED_INTERVAL_MS = 20;
let lastLedMs = 0;

let stats = STATS.emptyStats();
let lastResult = null;       /* the attempt just finished, for the result screen */
let progress = PROG.emptyProgress();
const agg = PROG.createAggregator();
let tracks = [];             /* the Learning Program (program.mjs) */
let progressRows = [];       /* the Progress list: overview, tracks, recent items */
let progressCursor = 0;
let quiz = null;
let quizHear = false;        /* ear training: the prompt is played, not shown */
let quizPick = false;        /* multiple choice: the pad is lit, you name it */
/* What the open quiz asks: { kind, hear, pick, halfTones, chordSet, pinned }.
 * A program step pins its options; a row of the Quiz folder follows the
 * settings. */
let quizSpec = null;
let quizSolvedAt = 0;        /* brief confirmation before the next prompt */
const guessOff = [];         /* ms-scheduled note-offs; the quiz has no clock */
const guessOn = [];          /* ms-scheduled note-ons: a hearing prompt is a line */
const GUESS_ADVANCE_MS = 450;
/* Long enough to read what it was while the pads still flash it. */
const EAR_ADVANCE_MS = 1400;

/* The lesson tree, and the folders open in it (catalog.mjs). */
let catalog = null;
let nav = [];
/* The armed exercise's id, which is also where its progress is filed — and
 * how it is found again in a tree rebuilt for a new key. */
let armedId = null;
/* The track it was opened from, so Next carries on along that track. */
let armedTrack = null;
/* 1: the target pads light as the notes arrive. 2: they do not. */
let stage = 1;
/* Only a run started from the top is a whole attempt; one started from a
 * scrubbed bar is practice on a passage, and is not recorded. */
let runFromTop = false;
let fileSongs = [];       /* [{ chart, category }] in manifest order */
let fileCategories = [];
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
    /* Basics › Random draws a new set each time a row is opened. */
    newSeed: () => (Date.now() & 0x7fffffff) || 1,
  };
}

function loadFileExercises() {
  fileSongs = [];
  fileCategories = [];
  const manifestText = readFile(MODULE_DIR + '/exercises/index.json');
  if (!manifestText) return;
  fileCategories = parseCategories(manifestText);
  const rows = parseManifest(manifestText);
  for (let i = 0; i < rows.length; i++) {
    const text = readFile(MODULE_DIR + '/exercises/' + rows[i].file);
    if (!text) continue;
    const { chart: parsed } = parseExercise(text, rows[i].id);
    if (parsed) fileSongs.push({ chart: parsed, category: rows[i].category });
  }
}

/* The program's song track is made from the files, so it follows them. */
function buildTracks() {
  tracks = PLAN.buildProgram({ songs: fileSongs });
}

/*
 * The tree, built again whenever a setting that shapes the generated lessons
 * changes. The open folders are carried across by path, so turning the key
 * with Basics › Progressions open leaves you in Basics › Progressions.
 */
/*
 * The Quiz folder: three ways of asking, one folder each.
 *
 *   Hear   something is played; you name it or play it back
 *   Play   a note or chord is shown; you find it on the pads
 *   Name   a pad is lit; you name it
 *
 * Play and Name follow the Half tones and Chords settings, and their ids do
 * too, so a chromatic round and an in-key round are filed apart.
 */
const QUIZ_PLAY = [
  { label: 'Notes', guess: GUESS.NOTES },
  { label: 'Chords', guess: GUESS.CHORDS },
];
const QUIZ_NAME = [
  { label: 'Notes', guess: GUESS.NOTES, pick: true },
  { label: 'Chords', guess: GUESS.CHORDS, pick: true },
];

function settingsQuiz(row) {
  return {
    kind: row.guess, hear: Boolean(row.hear), pick: Boolean(row.pick),
    halfTones: settings.halfTones, chordSet: settings.chordSet, pinned: false,
  };
}

function quizId(spec) {
  return 'quiz:' + STATS.drillId(spec);
}

/* Quiz › Hear: the Hearing track's exercises, each a folder of its levels.
 * The rows are the track's own steps, so a level played here is the same item
 * as in the Learning Program — and playing back notes and chords is two of
 * its units, so they are not listed a second time. */
function hearFolder() {
  const hearing = tracks.find((t) => t.key === 'hearing');
  const units = hearing ? hearing.units : [];
  return CAT.folder('Hear', units.map((u) =>
    CAT.folder(u.name, u.steps.map(PLAN.stepRow))), 'hear');
}

function quizRows(rows) {
  return rows.map((r) => ({ ...r, value: '', key: quizId(settingsQuiz(r)), absolute: true }));
}

function rebuildMenu() {
  /* The guesser is a mode, not an exercise, but putting it in the one list you
   * already open means no new screen and no new gesture — and which entry you
   * pick is also how you choose notes or chords. */
  const quizFolders = [
    hearFolder(),
    CAT.folder('Play', quizRows(QUIZ_PLAY), 'play'),
    CAT.folder('Name', quizRows(QUIZ_NAME), 'name'),
  ];
  catalog = CAT.buildCatalog({
    songs: fileSongs,
    categories: fileCategories,
    gen: generatorOptions(),
    /* The guided way in leads; the quiz sits straight after Basics. */
    lead: [PLAN.programFolder(tracks, repetitionRows)],
    after: [CAT.folder('Quiz', quizFolders, 'quiz')],
    tail: [{ label: 'Progress', progress: true, value: '~' }],
  });
  nav = nav.length ? CAT.navRestore(catalog, CAT.navPath(nav)) : CAT.navStart(catalog);
}

/* A row by id, wherever it sits in the tree. */
function findLeaf(id) {
  const hit = CAT.findById(catalog, id);
  return hit ? hit.node : null;
}

/* What an item is called on its own, outside the folder it sits in. */
function itemTitle(id) {
  if (id.indexOf('quiz:') === 0) return STATS.drillLabel(id.slice(5));
  const step = PLAN.findStep(tracks, id);
  if (step) return PLAN.stepTitle(step);
  const hit = CAT.findById(catalog, id);
  return hit ? hit.title : id;
}

/*
 * Today's repetitions, as rows. Made when the Repetition folder is looked at,
 * and kept until the progress or the day changes — the list must not reshuffle
 * under the cursor while you walk it.
 */
let repCache = { rev: -1, day: -1, rows: [] };

function repetitionRows() {
  const day = Math.floor(Date.now() / 86400000);
  if (repCache.rev === progress.rev && repCache.day === day) return repCache.rows;
  const rows = PROG.repetitionSession(progress, Date.now()).map((r) => ({
    label: itemTitle(r.id), value: '', repId: r.id, done: r.done,
  }));
  repCache = { rev: progress.rev, day, rows };
  return rows;
}

function currentDrill() {
  return STATS.drillId(quizSpec || { kind: GUESS.NOTES, halfTones: settings.halfTones });
}

/*
 * A round is over. Record it, then show the result — the rate on its own says
 * nothing, so the screen also says whether it beat the drill's best, and the
 * round counts toward the drill's progress like any played exercise.
 */
function finishRound() {
  const drill = currentDrill();
  const ms = GUESS.roundElapsed(quiz, now());
  const rec = STATS.makeRecord({
    drill, n: quiz.correct, ms, wrong: quiz.wrong, hints: quiz.hintsUsed, at: Date.now(),
  });
  const best = STATS.summarise(STATS.forDrill(stats, drill)).best;
  lastResult = {
    kind: 'quiz',
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

  const res = PROG.recordAttempt(progress, quizId(quizSpec), {
    stage: PROG.quizStage(quiz.hintsUsed),
    score: PROG.quizScore(quiz.correct, quiz.wrong),
    at: Date.now(),
  });
  saveProgress();
  lastResult.passed = res.passed;
  lastResult.footer = resultFooter();

  allNotesOff();
  view = RESULT_VIEW;
  dirty = true;
  ledDirty = true;
  announce('Round done. ' + Math.round(lastResult.rate) + ' per minute.'
    + (lastResult.isBest ? ' Best yet.' : '') + passedWords(res.passed));
}

function passedWords(passed) {
  if (passed === 2) return ' Finished.';
  if (passed === 1) return ' Stage one done.';
  return '';
}

/* The id of whatever was just played: the armed exercise, or the quiz. */
function currentItemId() {
  if (lastResult && lastResult.kind === 'quiz') return quizSpec ? quizId(quizSpec) : null;
  return armedId;
}

/*
 * What a click does on a result. If you have just passed stage 1 and not
 * stage 2, the next thing is stage 2 of the same piece; Shift moves on with
 * stage 1 counted as enough. Otherwise it is the program's next step.
 */
function resultFooter() {
  const it = PROG.item(progress, currentItemId());
  const twoNext = it && PROG.stagePassed(it, 1) && !PROG.isFinished(it);
  if (twoNext) return 'CLICK S2  SHIFT next';
  return lastResult.kind === 'quiz' ? 'PLAY again CLICK next' : 'REC again  CLICK next';
}

function startQuiz(spec) {
  allNotesOff();
  quizSpec = spec;
  quizHear = Boolean(spec.hear);
  quizPick = Boolean(spec.pick);
  quiz = GUESS.createQuiz({
    kind: spec.kind,
    rootPc: settings.rootPc,
    mode: settings.mode,
    transpose: settings.transpose,
    halfTones: spec.halfTones,
    chordSet: spec.chordSet,
    pick: quizPick,
    exercise: spec.exercise,
    level: spec.level,
    roundSize: settings.roundSize,
    fifths: keyFifths(),
    seed: (Date.now() & 0x7fffffff) || 1,
  });
  quizSolvedAt = 0;
  view = GUESS_VIEW;
  dirty = true;
  ledDirty = true;
  if (quiz.kind === GUESS.EAR) {
    hearPrompt();
    announce(quiz.exercise.name + '. Listen, then jog to the answer and click.');
  } else if (quizPick) {
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

/*
 * Open the highlighted row: into a folder, or arm what the row holds.
 *
 * A song's ladder is a folder like any other. It is a list rather than a
 * setting because the level is a property of what you are about to play and
 * not of the module — you want the right hand of one piece and both hands of
 * another in the same sitting.
 */
function openRow() {
  const row = CAT.navCurrent(nav);
  if (!row) return;
  if (CAT.navPush(nav)) {
    view = MENU;
    dirty = true;
    ledDirty = true;
    announce(row.label + '.');
    return;
  }
  if (row.progress) {
    openProgress();
    return;
  }
  if (row.continueRow) {
    const next = PLAN.continueStep(progress, tracks);
    if (next) openStep(next.step, next.track);
    return;
  }
  if (row.skipRow) {
    skipContinue();
    return;
  }
  if (row.step) {
    openStep(row.step, openTrack());
    return;
  }
  if (row.repId) {
    armedTrack = null;
    openItem(row.repId);
    return;
  }
  if (row.guess) {
    armedTrack = null;
    startQuiz(settingsQuiz(row));
    return;
  }
  armedTrack = null;
  armLeaf(row);
}

/* The track whose folder the list is in, if it is in one. */
function openTrack() {
  for (let i = nav.length - 1; i >= 0; i--) if (nav[i].node.track) return nav[i].node.track;
  return null;
}

/* A program step: a pointer at a row, or a quiz with its options pinned. */
function openStep(step, track) {
  armedTrack = track || PLAN.trackOf(tracks, step.id);
  if (step.quiz) {
    startQuiz({ ...step.quiz, pinned: true });
    return;
  }
  const node = findLeaf(step.id);
  if (node) armLeaf(node);
}

/* Anything by its id: a repetition, or what Next lands on. */
function openItem(id) {
  if (id.indexOf('quiz:') === 0) {
    const spec = PLAN.quizFromId(id);
    if (spec) startQuiz({ ...spec, pinned: true });
    return;
  }
  const node = findLeaf(id);
  if (node) armLeaf(node);
}

/* Arm a playable row on the first stage you have not yet passed. */
function armLeaf(node) {
  const built = node.build ? node.build() : null;
  if (!built) return;
  armedId = node.id || null;
  chart = built;
  if (chart.source !== 'file') chart.bpm = settings.bpm;
  stage = PROG.recommendedStage(PROG.item(progress, armedId));
  armRun();
  view = READY;
  announce(chart.name + '. Stage ' + stage + '. Press play to start.');
  dirty = true;
  ledDirty = true;
}

/*
 * Past Continue's step without playing it. A step whose stage 1 is passed is
 * moved on from — counted finished at stage 1 — rather than skipped.
 */
function skipContinue() {
  const next = PLAN.continueStep(progress, tracks);
  if (!next) return;
  passOver(next.step.id);
  announce('Skipped. Next: ' + itemTitle((PLAN.continueStep(progress, tracks) || next).step.id) + '.');
  dirty = true;
}

function passOver(id) {
  if (!PROG.moveOn(progress, id, Date.now())) PROG.skipItem(progress, id, Date.now());
  saveProgress();
}

/*
 * Next, from a result: stage 2 of the same piece if stage 1 has just been
 * passed, otherwise the next step of the track you came from — or, outside
 * the program, wherever Continue would send you.
 */
function goNext() {
  const id = currentItemId();
  const it = PROG.item(progress, id);
  if (it && PROG.stagePassed(it, 1) && !PROG.isFinished(it)) {
    if (lastResult && lastResult.kind === 'quiz') {
      startQuiz(quizSpec);
    } else {
      stage = 2;
      armRun();
      view = READY;
      announce('Stage two. The pads stay dark.');
    }
    dirty = true;
    ledDirty = true;
    return;
  }
  const track = armedTrack || PLAN.trackOf(tracks, id);
  const step = track ? PLAN.nextStep(progress, track) : null;
  const next = step ? { step, track } : PLAN.continueStep(progress, tracks);
  if (next) {
    openStep(next.step, next.track);
    return;
  }
  view = MENU;
  dirty = true;
  ledDirty = true;
}

/* Shift on a result: past this one, then on to the next. */
function skipFromResult() {
  const id = currentItemId();
  if (id) passOver(id);
  goNext();
}

/* Back from a result: to the start of the same thing, to try it again. */
function retryFromResult() {
  if (lastResult && lastResult.kind === 'quiz') {
    startQuiz(quizSpec);
    return;
  }
  stage = PROG.recommendedStage(PROG.item(progress, armedId));
  armRun();
  view = READY;
  dirty = true;
  ledDirty = true;
  announce('Back to the start. Stage ' + stage + '.');
}

function armRun() {
  run = SCORE.createRun(chart, {
    bpm: chart.bpm,
    anyOctave: settings.anyOctave,
    /* Grace is the scoring window now, not the halt point. */
    graceBeats: settings.graceBeats,
  });
  songBeats = -settings.countIn;
  prevBeats = songBeats;
  countInBeats = settings.countIn;
  waitedBeats = 0;
  frozenAt = null;
  scoreBeats = songBeats;
  blocked = false;
  paused = false;
  scrubCue = false;
  lastClickBeat = null;
  listenIndex = 0;
  listenOff = [];
}

function startRun(listen) {
  /*
   * Start where the playhead is, not always at the top: scrubbing the ready
   * screen is how you pick a passage, and resetting would make that pointless.
   * Read before armRun, which is what does the resetting.
   */
  const from = view === READY && songBeats > 0 ? songBeats : 0;
  armRun();
  listening = Boolean(listen);
  runFromTop = from === 0;
  runStartMs = now();
  view = RUNNING;
  /*
   * seekTo settles the bars behind the start point rather than counting them
   * as missed, and moves the reference's cursor so it does not open with a
   * backlog. No count-in from here: it exists to orient you at the top, you
   * have just been looking at the bar you chose, and with Wait on the scroll
   * halts on the first note anyway.
   */
  if (from > 0) seekTo(from);
  dirty = true;
  ledDirty = true;
  announce(listen ? 'Listening.' : 'Go.');
}

/*
 * Put the playhead at `beat`, and everything that follows from it.
 *
 * The clock is the easy half. A seek that moves it and forgets the rest leaves
 * a run that looks right and behaves wrongly: the reference dumps a bar of
 * backlog, the bar you scrubbed to cannot be played because its notes are
 * already settled, and markers from the previous attempt hang in the air.
 */
function seekTo(beat) {
  if (!chart || !run) return;
  const target = Math.max(0, Math.min(beat, chartTotalBeats(chart)));
  /*
   * Only when something is actually sounding. allNotesOff is ~7 host MIDI
   * writes — all-sound-off, all-notes-off and sustain down both routes, plus a
   * DSP panic — and a continuous scrub calls this several times a frame, which
   * would flood an inject ring that holds 64 packets and drains 31 per audio
   * block. Pausing already silenced everything, so during a paused scrub this
   * costs nothing at all.
   */
  let sounding = listenOff.length > 0;
  if (!sounding) { for (const k in pitchRefcount) { sounding = true; break; } }
  if (sounding) allNotesOff();
  else listenOff.length = 0;

  /* Notes behind the playhead are done with; notes at or after it go back so
   * the bar can be attempted again. */
  SCORE.resyncWait(run, target);
  SCORE.rearmFrom(run, target);
  SCORE.dropMarkersFrom(run, target);

  /* The reference plays from here, not from its backlog. */
  listenIndex = 0;
  while (listenIndex < chart.events.length && chart.events[listenIndex].beat < target) listenIndex++;

  /* Solve runStartMs for the position rather than tracking a separate offset:
   * songBeats is derived from it every frame, so it is the one place a seek
   * has to land. */
  waitedBeats = 0;
  frozenAt = null;
  blocked = false;
  songBeats = target;
  prevBeats = target;
  scoreBeats = target;
  lastClickBeat = null;
  const at = paused ? pausedAtMs : now();
  runStartMs = at - beatsToMs(target + countInBeats, chart.bpm);
  dirty = true;
  ledDirty = true;
}

/*
 * Scrub by a knob delta: continuous, so the playhead follows your hand rather
 * than teleporting between bar lines. SCRUB_UNITS_PER_BAR is the sensitivity —
 * about a turn and a half per bar — a rate now rather than a step size.
 */
function scrubBy(delta) {
  if (!chart) return;
  const perBar = beatsPerBar(chart);
  const before = Math.floor(songBeats / perBar);
  /*
   * COUNT IN UNITS, NOT IN BEATS. Adding perBar/36 per click accumulates
   * binary error: 72 clicks of 4/36 lands on 7.999999999999998, so two full
   * bars of turning showed bar 2 beat 4 and the counter sat one epsilon
   * behind the hand for the rest of the song. Multiplying once is exact.
   *
   * The round also snaps a playhead paused off-grid onto it, by at most half
   * a unit — a fraction of what the click you just turned is worth.
   */
  /* From the count-in, which sits at -countInBeats until the run starts, the
   * first click would otherwise be spent climbing back to zero. */
  const base = Math.max(0, songBeats);
  const units = Math.round((base * SCRUB_UNITS_PER_BAR) / perBar) + delta;
  scrubCue = true;
  /* A run that has been scrubbed is passage practice, not a whole attempt. */
  if (view === RUNNING) runFromTop = false;
  seekTo((units * perBar) / SCRUB_UNITS_PER_BAR);
  /* Only on a bar change: this runs several times a frame while the knob is
   * turning, and the screen reader does not want a new position each time. */
  const after = Math.floor(songBeats / perBar);
  if (after !== before) announce('Bar ' + (after + 1) + '.');
}

/*
 * Play and Record toggle their own mode rather than resetting it. Pausing
 * shifts runStartMs by the time spent stopped, the same trick waitedBeats uses
 * to resume in tempo instead of lurching forward to catch up.
 */
function togglePause() {
  if (view !== RUNNING) return;
  if (paused) {
    runStartMs += now() - pausedAtMs;
    paused = false;
    scrubCue = false;
    announce('Playing.');
  } else {
    paused = true;
    pausedAtMs = now();
    allNotesOff();
    announce('Paused.');
  }
  dirty = true;
  ledDirty = true;
}

function stopRun() {
  allNotesOff();
  listening = false;
  view = chart ? READY : MENU;
  dirty = true;
  ledDirty = true;
}

/*
 * A whole attempt is over: score it, file it under the exercise, and show it
 * against every attempt before it. The run is re-armed underneath, so Back or
 * Record from the result starts again from the top.
 */
function finishExercise(s) {
  const score = PROG.exerciseScore(s);
  const before = PROG.item(progress, armedId);
  const played = PROG.stagePlayed(before, stage);
  const prevBest = before ? before.stages[stage - 1].best : 0;
  const res = PROG.recordAttempt(progress, armedId, {
    stage, score, at: Date.now(), bpm: chart.bpm,
  });
  saveProgress();
  lastResult = {
    kind: 'exercise',
    name: chart.name,
    percent: score * 100,
    hits: s.hits,
    total: s.total,
    wrong: s.strays,
    stage,
    passed: res.passed,
    isBest: played && score > prevBest,
    history: PROG.item(progress, armedId).h,
  };
  lastResult.footer = resultFooter();
  armRun();
  view = RESULT_VIEW;
  dirty = true;
  ledDirty = true;
  announce('Done. ' + Math.round(score * 100) + ' percent.' + passedWords(res.passed));
}

/* ---- LEDs --------------------------------------------------------------- */
function targetPadsNow() {
  /* The next unresolved entry, if guidance is on. */
  if (stage !== 1 || !run || view !== RUNNING) return null;
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

/*
 * Guidance ahead of time: the next unresolved entry, at stage 1.
 *
 * And, at either stage, the note a scrub has landed on. Scrubbing is
 * finding your place, and on an isomorphic grid "where am I" is a question
 * about the pads as much as the staff. Only while the music is parked: the
 * moment it runs, the reading-first rule is back.
 */
function collectTarget() {
  targetBuf.length = 0;
  if (scrubCue && run && (view === READY || (view === RUNNING && paused))) {
    const next = run.entries[SCORE.nextEntryIndex(run, songBeats)];
    if (!next) return false;
    for (let i = 0; i < next.notes.length; i++) targetBuf.push(next.notes[i].pitch);
    return true;
  }
  if (stage !== 1 || !run || view !== RUNNING) return false;
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
  if (stage !== 1 || !run || view !== RUNNING || !blocked) return;
  const stuck = SCORE.blockingNotes(run);
  for (let i = 0; i < stuck.length; i++) stuckBuf.push(stuck[i].pitch);
}

/*
 * Whatever is sounding right now, for Listen — watching the notes light up is
 * the whole point of that mode, so unlike the guidance hint it is never gated
 * on a setting. Read from pitchRefcount, which is exactly what is down; the
 * metronome click lives there too but its pitches sit outside the grid.
 *
 * Nothing lights the answer in the guessing and hearing modes. Stage 1 is a
 * playing aid; in a quiz the hint IS the answer.
 */
/* The lit pad IS the question in the multiple-choice drill. */
const promptBuf = [];

function collectPrompt() {
  promptBuf.length = 0;
  if (!quiz || view !== GUESS_VIEW) return;
  /* Hearing never lights the answer, not even at the top of the ladder:
   * a right answer flashes it instead. */
  if (quiz.kind === GUESS.EAR) return;
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
  answerRows: 0, answerPads: null, answerColours: null,
};

/*
 * The answer bar: the Hear drills' answers as coloured pads. Only there —
 * in Name the lit pads ARE the question, and a bar across the bottom row
 * covered the very pads you were being asked about, so Name answers with the
 * jog. Everywhere else the bar does not exist and the bottom row is keys.
 */
function answerBarActive() {
  return view === GUESS_VIEW && Boolean(quiz) && quiz.kind === GUESS.EAR;
}

const answerColourBuf = [];
const answerStruck = (i) => GUESS.isEliminated(quiz, i);

function collectAnswers() {
  if (!answerBarActive()) {
    ledState.answerRows = 0;
    ledState.answerPads = null;
    return;
  }
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
  const pads = PAD.padsForPitch(pitch, settings.transpose);
  for (let i = 0; i < pads.length; i++) flashPad(pads[i], color, ms);
}

const ledWorkspace = LEDS.createLedState();
const padColorBuf = new Array(PAD.PAD_COUNT);

function paintPads() {
  const near = collectTarget();
  collectStuck();
  collectSounding();
  collectPrompt();
  collectAnswers();

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
  setButtonLED(CC_PLAY, CTRL.playLedColor(ledView, ledPhase, listening, paused));
  setButtonLED(CC_RECORD, CTRL.recordLedColor(ledView, listening, ledPhase,
    Boolean(quiz && GUESS.hintsLeft(quiz) === 0), paused));
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
  /* Hearing: rung one is the prompt again, slower — promptEvents reads the
   * rung. */
  if (level === 1 && quiz.kind === GUESS.EAR) hearPrompt();

  dirty = true;
  ledDirty = true;
}

function hearPrompt() {
  if (!quiz || !quiz.prompt.length) return;
  const events = GUESS.promptEvents(quiz);
  if (events) {
    /* A replay starts over: anything still queued or sounding from the last
     * one would blur into it. */
    stopPrompt();
    const t = now();
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      guessOn.push({ pitch: e.pitch, atMs: t + e.at, offMs: t + e.at + e.dur });
    }
    return;
  }
  const until = now() + 900;
  for (let i = 0; i < quiz.prompt.length; i++) {
    noteOn(quiz.prompt[i], 90);
    guessOff.push({ pitch: quiz.prompt[i], atMs: until });
  }
}

function stopPrompt() {
  guessOn.length = 0;
  for (let i = 0; i < guessOff.length; i++) noteOff(guessOff[i].pitch);
  guessOff.length = 0;
}

/*
 * The guesser has no musical clock, so its notes run on wall time. Offs
 * before ons: a note repeated straight after itself is released first and
 * struck again, rather than struck twice and released once.
 */
function serviceGuess() {
  const t = now();
  for (let i = guessOff.length - 1; i >= 0; i--) {
    if (guessOff[i].atMs > t) continue;
    noteOff(guessOff[i].pitch);
    guessOff.splice(i, 1);
  }
  for (let i = 0; i < guessOn.length;) {
    if (guessOn[i].atMs > t) { i++; continue; }
    noteOn(guessOn[i].pitch, 90);
    guessOff.push({ pitch: guessOn[i].pitch, atMs: guessOn[i].offMs });
    guessOn.splice(i, 1);
  }
  const advanceMs = quiz && quiz.kind === GUESS.EAR ? EAR_ADVANCE_MS : GUESS_ADVANCE_MS;
  if (quizSolvedAt && t - quizSolvedAt >= advanceMs) {
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
    const top = CAT.navTop(nav);
    VIEW.drawList(ctx, top.node.label.toUpperCase(), top.node.children, top.cursor, {
      footer: nav.length > 1 ? VIEW.FOLDER_HINT : VIEW.SETTINGS_HINT,
      centreFooter: true,
      decorate: decorateRow,
    });
  } else if (view === PROGRESS_VIEW) {
    VIEW.drawList(ctx, 'PROGRESS ' + PROG.folderSummary(agg, progress, catalog).percent + '%',
      progressRows, progressCursor, {
        footer: 'CLICK chart BACK list',
        centreFooter: true,
        decorate: decorateRow,
      });
  } else if (view === SETTINGS) {
    VIEW.drawList(ctx, 'SETTINGS', settingsRows(), settingsCursor, {
      footer: settingsEditing ? 'turn change  CLICK ok' : 'CLICK edit SHIFT back',
      editing: settingsEditing,
    });
  } else if (view === RESULT_VIEW) {
    if (lastResult.kind === 'exercise') VIEW.drawExerciseResult(ctx, lastResult);
    else VIEW.drawRoundResult(ctx, lastResult);
  } else if (view === PROGRESS_DETAIL) {
    drawProgressDetail();
  } else if (view === GUESS_VIEW && quizPick) {
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
  } else if (view === READY) {
    VIEW.drawReadyView(ctx, {
      chart,
      run,
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
      footer: armedId ? VIEW.stageFooter(stage) : '',
    });
  } else {
    VIEW.drawReadingView(ctx, {
      chart,
      run,
      songBeats,
      pxPerBeat: settings.pxPerBeat,
      beatFlash: now() - beatFlash < 90,
      blocked,
      paused,
    });
  }
}

/*
 * What a row of the list says about your progress: a percentage, and a mark
 * for a stage passed, a skip, or the program's next step. Worked out as the
 * row is drawn, from the store, so the tree never has to be rebuilt when you
 * get better at something.
 */
function decorateRow(row) {
  if (row.continueRow) {
    const next = PLAN.continueStep(progress, tracks);
    if (!next) return { label: 'Continue: all done', value: '', mark: PROG.MARK_DONE };
    return {
      label: 'Next: ' + PLAN.stepTitle(next.step),
      value: 'S' + PROG.recommendedStage(PROG.item(progress, next.step.id)),
      mark: 'next',
    };
  }
  if (row.skipRow) {
    const next = PLAN.continueStep(progress, tracks);
    if (!next) return { label: 'Skip: nothing left', value: '' };
    const it = PROG.item(progress, next.step.id);
    return { label: (PROG.stagePassed(it, 1) ? 'Move on: ' : 'Skip: ') + PLAN.stepTitle(next.step), value: '' };
  }
  if (row.key === 'repetition') {
    const due = PROG.dueCount(repetitionRows().map((r) => ({ done: r.done })));
    return { value: due ? due + ' due' : '>' };
  }
  if (row.repId) return row.done ? { value: 'today', mark: PROG.MARK_DONE } : { value: 'due' };
  if (row.progress) return { value: PROG.folderSummary(agg, progress, catalog).percent + '%' };
  if (row.overview) {
    const sum = row.overview === 'all'
      ? PROG.folderSummary(agg, progress, catalog)
      : PROG.summariseIds(progress, PLAN.trackSteps(row.track).map((st) => st.id));
    return { value: sum.percent + '%' };
  }
  if ('children' in row) {
    if (row.untracked) return null;
    const sum = PROG.folderSummary(agg, progress, row);
    return { value: sum.percent > 0 ? sum.percent + '% >' : '>' };
  }
  const id = row.itemId || (PROG.isTracked(row) ? row.id : null);
  if (!id) return null;
  const it = PROG.item(progress, id);
  let mark = PROG.itemMark(it);
  if (!mark && row.step) {
    const track = openTrack();
    const next = track ? PLAN.nextStep(progress, track) : null;
    if (next && next.id === id) mark = 'next';
  }
  return { value: it && it.plays ? PROG.itemPercent(it) + '%' : '', mark };
}

/* ---- Progress --------------------------------------------------------------- */
/*
 * The overview first, then each track, then everything you have played, most
 * recent first. Clicking a row draws its chart; the jog walks the charts.
 */
const PROGRESS_RECENT = 40;

function openProgress() {
  const rows = [{ label: 'Overall', overview: 'all' }];
  for (let i = 0; i < tracks.length; i++) {
    rows.push({ label: tracks[i].name + ' track', overview: tracks[i].key, track: tracks[i] });
  }
  const recent = PROG.recentIds(progress).slice(0, PROGRESS_RECENT);
  for (let i = 0; i < recent.length; i++) rows.push({ label: itemTitle(recent[i]), itemId: recent[i] });
  /* Quiz drills from before progress was kept still have their rounds. */
  const drills = STATS.drillsWithHistory(stats);
  for (let i = 0; i < drills.length; i++) {
    if (!PROG.item(progress, 'quiz:' + drills[i])) rows.push({ label: STATS.drillLabel(drills[i]), drill: drills[i] });
  }
  progressRows = rows;
  progressCursor = 0;
  view = PROGRESS_VIEW;
  dirty = true;
  ledDirty = true;
  announce('Progress.');
}

function drawProgressDetail() {
  const row = progressRows[progressCursor];
  if (!row) return;
  const index = progressCursor;
  const total = progressRows.length;
  if (row.overview) {
    const ids = row.overview === 'all'
      ? PROG.leafIds(agg, catalog)
      : PLAN.trackSteps(row.track).map((st) => st.id);
    const sum = PROG.summariseIds(progress, ids);
    VIEW.drawOverview(ctx, {
      title: row.overview === 'all' ? 'Overall' : row.track.name,
      percent: sum.percent, done: sum.done, half: sum.half, count: sum.count,
      timeline: PROG.passTimeline(progress, ids, L.PROGRESS_PLOT.w, L.PROGRESS_PLOT.h, Date.now()),
      index, total,
    });
    return;
  }
  /* A quiz drill keeps its own chart, rate over error: the speed is the point
   * of a round, where accuracy is the point of a piece. */
  const drill = row.drill || (row.itemId.indexOf('quiz:') === 0 ? row.itemId.slice(5) : null);
  if (drill && STATS.forDrill(stats, drill).length) {
    VIEW.drawProgress(ctx, {
      drill, records: STATS.forDrill(stats, drill), drillIndex: index, drillCount: total,
    });
    return;
  }
  const it = PROG.item(progress, row.itemId);
  VIEW.drawItemProgress(ctx, {
    title: row.label,
    history: it ? it.h : [],
    percent: PROG.itemPercent(it),
    best: it ? Math.max(it.stages[0].best, it.stages[1].best) * 100 : 0,
    mark: PROG.itemMark(it),
    index,
    count: total,
  });
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
  /* The octave decides which rungs a generated lesson has, and Half tones and
   * Chords decide which drill a Quiz row files its rounds under: the leaves
   * the folders add up change, so the cached sums start again. */
  if (res.key === 'transpose' || res.key === 'halfTones' || res.key === 'chordSet') {
    PROG.resetShape(agg);
  }
  if (res.key === 'rootPc' || res.key === 'mode' || res.key === 'transpose' ||
      res.key === 'halfTones' || res.key === 'chordSet') rebuildMenu();

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
    /* A step of the program keeps the options it pinned; a Quiz row follows. */
    startQuiz(quizSpec.pinned ? quizSpec
      : { ...quizSpec, halfTones: settings.halfTones, chordSet: settings.chordSet });
  } else if (res.rebuild && CTRL.shouldRebuildChart(view, chart && chart.source)) {
    const row = armedId ? findLeaf(armedId) : null;
    if (row && row.build) {
      chart = row.build();
      if (chart.source !== 'file') chart.bpm = settings.bpm;
      armRun();
    }
  }
  ledDirty = true;
  dirty = true;
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
  if (answerBarActive() && AP.inAnswerBar(quiz.choices.length, pad)) {
    answerPressed[pad] = 1;
    const at = AP.answerAt(quiz.choices.length, pad);
    const res = at >= 0 ? GUESS.chooseAnswer(quiz, at, now()) : null;
    if (res) {
      answered(res);
      if (res === GUESS.WRONG) flashPad(pad, PAD.LED_MISS, 200);
      else flashPad(pad, PAD.LED_HIT, 300);
    }
    return;
  }

  heldPads[pad] = 1;
  ledDirty = true;
  const pitch = PAD.padPitch(pad, settings.transpose);
  noteOn(pitch, vel);

  if (view === GUESS_VIEW && quizPick) {
    /* Above the bar the pads are the question; pressing one just sounds it. */
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
  /*
   * TWO CLOCKS, AND THEY ARE NOT INTERCHANGEABLE HERE.
   *
   * The marker is a statement about the PICTURE — a ring sitting clear of its
   * notehead is the timing error made visible — so it goes where the press was
   * seen to happen. On the honest clock it landed to the RIGHT of the hit line
   * while the scroll was frozen, which draws a ring over notes not yet
   * reached, and a ring is the same glyph as a hit notehead.
   *
   * The judgement is a statement about TIME, so it keeps the honest clock:
   * against the frozen one every press reads as perfectly on time however long
   * it took.
   */
  SCORE.addMarker(run, pitch, songBeats);
  const j = SCORE.judgeNoteOn(run, pitch, scoreBeats, songBeats);
  if (j.result === 'stray') {
    flashPad(pad, PAD.LED_MISS, 120);
  } else {
    flashPitch(pitch, j.result === 'late' ? PAD.LED_MISS : PAD.LED_HIT);
  }
  dirty = true;
}

function onPadUp(pad) {
  if (answerPressed[pad]) {
    delete answerPressed[pad];
    return;
  }
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
    progressCursor = clamp(progressCursor + (delta > 0 ? 1 : -1), 0, progressRows.length - 1);
    dirty = true;
    return;
  }
  if (view === PROGRESS_DETAIL) {
    if (progressRows.length > 1) {
      progressCursor = (progressCursor + (delta > 0 ? 1 : -1) + progressRows.length)
        % progressRows.length;
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
   * run. jogAction ignores it everywhere but the lists. */
  const top = CAT.navTop(nav);
  const next = CTRL.jogAction(view, delta, top.cursor, top.node.children.length);
  /* On the ready screen the jog picks the stage — never the exercise. */
  if (next.action === 'stage' && armedId) {
    if (next.index !== stage) {
      stage = next.index;
      dirty = true;
      ledDirty = true;
      announce(stage === 2 ? 'Stage two. The pads stay dark.' : 'Stage one. The pads light up.');
    }
    return;
  }
  if (next.action !== 'cursor') return;
  top.cursor = next.index;
  dirty = true;
}

/* An answer was given, by the jog or by its pad. */
function answered(res) {
  if (res === GUESS.CORRECT) {
    quizSolvedAt = now();
    /* Heard, named, now shown: where it sits on the grid. */
    if (quiz.kind === GUESS.EAR) for (const p of quiz.prompt) flashPitch(p, PAD.LED_HIT, EAR_ADVANCE_MS);
  }
  dirty = true;
  ledDirty = true;
}

function onJogClick() {
  if (view === GUESS_VIEW && quizPick && quiz && !shiftHeld) {
    if (quiz.solved) return;
    answered(GUESS.pickChoice(quiz, now()));
    return;
  }
  if (view === PROGRESS_VIEW && !shiftHeld) {
    if (progressRows.length) view = PROGRESS_DETAIL;
    dirty = true;
    return;
  }
  switch (CTRL.jogClickAction(view, shiftHeld, Boolean(chart))) {
    case 'next':
      goNext();
      break;
    case 'skip':
      skipFromResult();
      break;
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
      openRow();
      break;
    default:
      view = MENU;
      break;
  }
  dirty = true;
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
  return Math.max(0, Math.min(settingsCursor - (SETTINGS_PER_PAGE >> 1), n - SETTINGS_PER_PAGE));
}

function inSong() {
  return view === RUNNING || view === READY;
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
      if (view === READY || (view === RUNNING && paused)) scrubBy(delta);
      return;
    }
    if (index === KNOB_COUNT - 1) editSetting(SET.settingIndex('bpm'), delta);
    return;
  }
  if (view === SETTINGS) {
    const row = settingsPageTop() + index;
    if (index >= SETTINGS_PER_PAGE || row >= SET.SETTINGS_COUNT) return;
    settingsCursor = row;
    /* Key and octave wrap through a lot of values; one step per event or a
     * flick sends them spinning. */
    const def = SET.SETTINGS_DEF[row];
    const step = def && (def.type === 'wrap' || def.type === 'list' || def.type === 'enum');
    editSetting(row, step ? (delta > 0 ? 1 : -1) : delta);
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
  if (view !== SETTINGS || index >= SETTINGS_PER_PAGE) return;
  const row = settingsPageTop() + index;
  if (row >= SET.SETTINGS_COUNT) return;
  settingsCursor = row;
  dirty = true;
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
  nav = [];
  armedId = null;
  armedTrack = null;
  stage = 1;
  runFromTop = false;
  settingsCursor = 0;
  settingsEditing = false;
  quiz = null;
  quizHear = false;
  quizPick = false;
  quizSpec = null;
  lastResult = null;
  progressRows = [];
  progressCursor = 0;
  repCache = { rev: -1, day: -1, rows: [] };
  quizSolvedAt = 0;
  guessOff.length = 0;
  guessOn.length = 0;
  ledPhase = -1;
  lastClickBeat = null;
  lastDrawMs = 0;
  lastLedMs = 0;
  settingsDirty = false;
  lastSaveMs = 0;
  pendingExitAt = 0;
  panicChannelNext = 16;
  for (const k in heldPads) delete heldPads[k];
  for (const k in answerPressed) delete answerPressed[k];
  for (const k in padFlash) delete padFlash[k];
  for (const k in pitchRefcount) delete pitchRefcount[k];

  loadSettings();
  loadStats();
  loadProgress();
  loadFileExercises();
  buildTracks();
  PROG.resetShape(agg);
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
   /*
    * Paused stops the CLOCK, not the frame. The draw gate requires `dirty`,
    * and `dirty` is set at the bottom of this block — so gating the whole
    * thing on !paused stopped the panel repainting at all, and a pad press or
    * a scrub while paused would have changed nothing on screen.
    */
   if (!paused) {
    prevBeats = songBeats;
    const raw = msToBeats(t - runStartMs, chart.bpm) - countInBeats;

    /*
     * Freeze first, then resolve — the reverse of the old order, and the
     * reason is that there are two clocks now. Expiring used to have to run
     * first because a frozen clock could never reach the note's late window;
     * scoreBeats reaches it whether the scroll is frozen or not, so the freeze
     * can be decided from the run as it stands and the judgement follows on
     * real time.
     */
    const waiting = settings.waitForNote && !listening;
    const block = waiting ? SCORE.blockingBeat(run) : null;
    const clock = applyWait(raw, waitedBeats, block, frozenAt);
    songBeats = clock.songBeats;
    waitedBeats = clock.waitedBeats;
    frozenAt = clock.frozenAt;
    scoreBeats = clock.scoreBeats;
    blocked = clock.blocked;

    if (!listening && scoreBeats >= 0) SCORE.expireMissed(run, scoreBeats, waiting);

    if (isBeatEdge(prevBeats, songBeats)) serviceClick();
    serviceReference();
    serviceNoteOffs();
    SCORE.pruneMarkers(run, xToBeat(L.DESPAWN_X, songBeats, settings.pxPerBeat));
    if (SCORE.runFinished(run, songBeats, blocked) ||
        (listening && songBeats > chartTotalBeats(chart))) {
      allNotesOff();
      const wasListening = listening;
      listening = false;
      const s = SCORE.runStats(run);
      if (!wasListening && runFromTop && armedId) {
        finishExercise(s);
      } else {
        /* Listening, or a passage started from a scrubbed bar: nothing to
         * record, so straight back to the start to play it again. */
        armRun();
        view = READY;
        announce('Done.');
      }
    }
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
    onJogClick();
    return;
  }
  /* Play listens, Record practises: at an instrument "play" means play it to
   * me, and "record" means capture what I do. Pressing the running mode's own
   * button stops it; pressing the other switches, so no press is ever a no-op. */
  if (d1 === CC_PLAY) {
    if (view === RESULT_VIEW) {
      if (lastResult.kind === 'quiz') startQuiz(quizSpec);
      else startRun(true);
      return;
    }
    if (view === GUESS_VIEW) {
      hearPrompt();
      return;
    }
    if (view === RUNNING && listening) togglePause();
    else if (chart) startRun(true);
    else openRow();
    return;
  }
  if (d1 === CC_RECORD) {
    if (view === RESULT_VIEW) {
      if (lastResult.kind === 'quiz') startQuiz(quizSpec);
      else startRun(false);
      return;
    }
    if (view === GUESS_VIEW) {
      takeHint();
      return;
    }
    if (view === RUNNING && !listening) togglePause();
    else if (chart) startRun(false);
    else openRow();
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
    if (view === SETTINGS) {
      view = chart ? READY : MENU;
      dirty = true;
      return;
    }
    if (view === RUNNING) {
      /* Restart, not exit. Back from the READY screen this lands on already
       * goes to the list, so pressing it twice leaves without inventing a
       * second gesture. */
      stopRun();
      armRun();
      announce('Back to the start.');
      return;
    }
    /* From a result, Back is another go from the start — the list is one
     * more press away, from the ready screen or the new round. */
    if (view === RESULT_VIEW) {
      retryFromResult();
      return;
    }
    if (view === PROGRESS_DETAIL) {
      view = PROGRESS_VIEW;
      dirty = true;
      return;
    }
    if (view === PROGRESS_VIEW) {
      view = MENU;
      dirty = true;
      ledDirty = true;
      return;
    }
    /* Up one folder. The top of the tree is the only list Back leaves from. */
    if (view === MENU && CAT.navPop(nav)) {
      dirty = true;
      ledDirty = true;
      return;
    }
    /* Back from a ready screen lands on the folder it was opened from — for a
     * song, its ladder: having just played the right hand, the next thing you
     * want is the left hand of the same piece, one rung away. */
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
