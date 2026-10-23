// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * session.mjs — Piano Practice itself, with no host in it. Pure.
 *
 * Everything the module DOES lives here: the lesson tree and the Path,
 * arming, the transport and its two clocks, scoring, the quizzes and the
 * hearing drills, results, progress, help, the options of a row, the welcome
 * and the tips, the settings and their file.
 * What it does not do is touch a device. It reads the time, sounds a note,
 * saves a file and speaks through the `fx` it is given, so the same session
 * runs inside the Move (ui.js) and in a browser (web/), and the two cannot
 * drift apart.
 *
 *   createSession(fx) -> session
 *
 *   fx.now()                monotonic milliseconds (the frame clock)
 *   fx.wallNow()            wall-clock milliseconds, for dates and seeds
 *   fx.strike(pitch, vel)   sound a note — called on EVERY note-on
 *   fx.release(pitch)       stop it — called once its last holder lets go
 *   fx.silence(pitches)     everything off, at once: the pitches still held
 *   fx.announce(text)       say it (screen reader, live region)
 *   fx.readText(name)       'settings.json', 'stats.json', 'progress.json',
 *   fx.writeText(name, t)   'exercises/index.json', 'exercises/<file>'
 *   fx.reveal(pitches, ms)  show where an answer sits (on the Move: its pads)
 *   fx.exit()               leave; the host decides how to get out cleanly
 *   fx.settingChanged(key)  a setting the host itself acts on has changed
 *
 * The session never decides how a note gets out — the built-in piano, a Move
 * track, USB, Web Audio — only that it should sound. It does keep the
 * refcount, because when a note STOPS is musical: see noteOn below.
 *
 * Input arrives as what it means, not as which button: play(pitch), activate,
 * back, moveSelection. ui.js maps Move's buttons onto these; a browser maps
 * clicks and keys. State is read from `session` (getters), and the session sets
 * `dirty` / `ledDirty` when a renderer has something new to show.
 *
 * The code below moved here from ui.js unchanged in substance; tests/ui_trace
 * holds the Move to what it received before the move.
 */

import * as L from './layout.mjs';
import * as PAD from './padmap.mjs';
import * as GEN from './generator.mjs';
import * as SCORE from './scoring.mjs';
import * as CTRL from './controls.mjs';
import * as SET from './settings_def.mjs';
import * as GUESS from './guess.mjs';
import * as STATS from './stats.mjs';
import * as PROG from './progress.mjs';
import * as PLAN from './program.mjs';
import * as AP from './answer_pads.mjs';
import * as INFO from './info.mjs';
import * as CUES from './cues.mjs';
import * as NOTATION from './notation.mjs';
import {
  msToBeats, beatsToMs, chartTotalBeats, beatsPerBar, isBeatEdge, applyWait, xToBeat,
} from './chart.mjs';
import { parseExercise, parseManifest, parseCategories } from './exercise_io.mjs';
import * as CAT from './catalog.mjs';
import * as HINTS from './hints.mjs';
import * as TIPS from './tips.mjs';
import * as SHEET from './row_sheet.mjs';
import * as MP from './map_places.mjs';
import { layoutPlaces, placeOfPad } from './pathmap/layout.mjs';
import { createWalk, walkTo, walkStep, posAt, arrived } from './pathmap/walk.mjs';
import { createGrow, startGrow, growing, itemOfPad, HOME_MAX } from './home/render.mjs';
import { PRACTICE_PIANO } from './home/icons.mjs';
import * as SC from './pathmap/scenes.mjs';

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

/* ---- Views ---------------------------------------------------------------- */
export const MENU = 'menu';
export const READY = 'ready';
export const RUNNING = 'running';
export const SETTINGS = 'settings';
export const GUESS_VIEW = 'guess';
/* controls.mjs's name for it, so Play and Record pulse here as they do on the
 * ready screen: both start the next attempt. */
export const RESULT_VIEW = CTRL.SUMMARY;
export const PROGRESS_VIEW = 'progress';
export const PROGRESS_DETAIL = 'progress-detail';
export const INFO_VIEW = 'info';
/* The options of a row (Shift + jog-click in the list). */
export const SHEET_VIEW = 'sheet';
/* A card over whatever is underneath: the welcome, a first-visit tip. */
export const CARD_VIEW = 'card';

/* A folder of the Path drawn as its map. Not a view of its own — the view
 * stays MENU, the cursor a child index — but a screen with its own hint
 * line and help (screenNow). */
export const MAP_SCREEN = 'map';
/* The top of the list drawn as five circles (src/home/): MENU too. */
export const HOME_SCREEN = 'home';
/* A scene of the Learning Path (pathmap/scenes.mjs): a walk, a flag, a zoom... Any
 * key skips it. */
export const ANIM_VIEW = 'anim';

/* Every screen, for whoever must cover them all (hints.mjs, its test). */
export const VIEWS = [
  MENU, READY, RUNNING, SETTINGS, GUESS_VIEW, RESULT_VIEW, PROGRESS_VIEW, PROGRESS_DETAIL,
  INFO_VIEW, SHEET_VIEW, CARD_VIEW, MAP_SCREEN, HOME_SCREEN, ANIM_VIEW,
];

/* What the session keeps, by name; the host decides where. */
const SETTINGS_FILE = 'settings.json';
const STATS_FILE = 'stats.json';
const STATS_V1_FILE = 'stats.v1.bak.json';
const PROGRESS_FILE = 'progress.json';

export const backupName = (name) => name.replace(/\.json$/, '.bak.json');

/* Whether a record file is whole: JSON, and an object. A truncated write is
 * neither. */
export function isRecordText(text) {
  if (!text) return false;
  try {
    const obj = JSON.parse(text);
    return Boolean(obj) && typeof obj === 'object';
  } catch (e) {
    return false;
  }
}

/*
 * opts.keepMarkersBeats: how far behind the playhead the marks of your presses
 * are kept. By default, to the panel's left edge — on a 128px screen that is
 * barely a beat; a browser's lane shows far more of what you just played.
 */
export function createSession(fx, opts = {}) {
  const keepMarkersBeats = typeof opts.keepMarkersBeats === 'number' ? opts.keepMarkersBeats : null;

  /* ---- The host, through fx ------------------------------------------------ */
  function now() {
    return fx.now();
  }

  function wallNow() {
    return fx.wallNow();
  }

  function announce(text) {
    fx.announce(text);
  }

  function readText(name) {
    try {
      return fx.readText(name);
    } catch (e) {
      return null;
    }
  }

  function writeText(name, text) {
    try {
      return fx.writeText(name, text) !== false;
    } catch (e) {
      return false;
    }
  }

  const pitchRefcount = {};

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
    fx.strike(pitch, vel || 100);
  }

  function noteOff(pitch) {
    if (pitch < 0 || pitch > 127) return;
    const prev = pitchRefcount[pitch] || 0;
    if (prev <= 1) {
      delete pitchRefcount[pitch];
      fx.release(pitch);
    } else {
      pitchRefcount[pitch] = prev - 1;
    }
  }
  /*
   * Everything off: what is scheduled is dropped, what is held is handed to the
   * host to silence. Drop the schedule first, or serviceNoteOffs would release
   * notes that have just been silenced and drive the refcount negative.
   */
  function allNotesOff() {
    guessOff.length = 0;
    guessOn.length = 0;
    listenOff.length = 0;
    const held = [];
    for (const key in pitchRefcount) {
      held.push(+key);
      delete pitchRefcount[key];
    }
    fx.silence(held);
  }

  /* ---- Settings ----------------------------------------------------------- */
  /*
   * Bumped when a default changes in a way a stored file would otherwise mask.
   * A saved settings.json always wins over a default, so changing one silently
   * does nothing for anybody who has already used the module.
   */
  const SETTINGS_VERSION = 8;

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
    quizSounds: true,  /* a chime when right, an uh-oh when wrong */
    autoInfo: true,    /* show a practice's Info page the first time it is opened */
    chordSet: 'triads',
    click: true,
    reference: 'stage1', /* hear the line you are meant to be playing — at stage 1 */
    names: 'stage1',   /* note names under the notes — at stage 1 */
    midiOut: OUT_INTERNAL, /* our own piano: always works, needs no setup */
    waitForNote: true, /* stop at a note until it is played */
    graceBeats: 1 / 4, /* beats you may be late and still be in time */
    refVel: 70,
    midiCh: 0,         /* 0 = every channel, so a track mismatch cannot silence us */
    countIn: 4,
  };

  function loadSettings() {
    const raw = readText(SETTINGS_FILE);
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
    /* The STORED value: coerceInto has already refused 'pentatonic' as no
     * longer in the list, so `settings.mode` can never be it here. */
    if (storedVersion < 6 && obj.mode === 'pentatonic') {
      settings.mode = 'majorPent';
      migrated = true;
    }
    /* v7: Guide pads became each exercise's stage — stage 1 lights the pads,
     * stage 2 does not — so the stored setting is simply no longer read, and
     * writing the file drops it. */
    /* v8: the reference line and the names fade with the stage, so a stored
     * "on" becomes "stage 1" — the default — and "off" stays off. Grace only
     * judges now, and the old default of a whole beat counted a note 750ms
     * late as in time; it moves to a quarter. A grace chosen deliberately stays. */
    if (storedVersion < 8) {
      if (obj.reference === false) settings.reference = 'off';
      if (settings.graceBeats === 1) settings.graceBeats = 1 / 4;
      migrated = true;
    }
    if (storedVersion !== SETTINGS_VERSION) {
      settings.version = SETTINGS_VERSION;
      migrated = true;
    }
    /* Only write when something actually changed: opening the module used to
     * cost a flash write every time. */
    if (migrated) saveSettings();

    fx.settingChanged('midiCh');
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

  /*
   * A record file — the stats, the progress — read so that a damaged one can
   * never cost the record. A file that parses is copied to its backup twin; one
   * that does not (a write cut short by a power cut or a full disk) is kept
   * aside as .corrupt and the twin is read instead. Without this the parser's
   * empty store would be the next thing saved, over everything, silently.
   */
  function loadRecord(name) {
    const text = readText(name);
    if (isRecordText(text)) {
      writeText(backupName(name), text);
      return text;
    }
    if (text) writeText(name.replace(/\.json$/, '.corrupt.json'), text);
    const backup = readText(backupName(name));
    return isRecordText(backup) ? backup : null;
  }

  /*
   * A version 1 file is migrated as it is read (stats.migrateTally). Before
   * the first save overwrites it, the old file is kept as it was — once, under
   * its own name: the .bak twin is rewritten on every load and would lose it.
   */
  function loadStats() {
    const text = loadRecord(STATS_FILE);
    stats = STATS.parseStats(text);
    if (stats.migrated && text && !readText(STATS_V1_FILE)) writeText(STATS_V1_FILE, text);
    delete stats.migrated;
  }

  /* One write per finished round — small, and rare enough not to need pacing. */
  function saveStats() {
    writeText(STATS_FILE, STATS.serialiseStats(stats));
  }

  function loadProgress() {
    progress = PROG.parseProgress(loadRecord(PROGRESS_FILE));
  }

  /* One write per finished attempt or skip, like the stats. */
  function saveProgress() {
    writeText(PROGRESS_FILE, PROG.serialiseProgress(progress));
  }

  function flushSettings(force) {
    if (!settingsDirty) return;
    const t = now();
    if (!force && t - lastSaveMs < SAVE_INTERVAL_MS) return;
    lastSaveMs = t;
    settingsDirty = false;
    writeText(SETTINGS_FILE, JSON.stringify(settings));
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }
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
  let dirty = true;
  let beatFlash = 0;          /* ms timestamp the current beat marker started */

  let stats = STATS.emptyStats();
  let lastResult = null;       /* the attempt just finished, for the result screen */
  let progress = PROG.emptyProgress();
  const agg = PROG.createAggregator();
  let phases = [];             /* the Path (program.mjs) */
  let progressRows = [];       /* the Progress list: overview, phases, recent items */
  let progressCursor = 0;
  /* The Info page open: { title, lines, scroll, back }. `back` is the view
   * it came from, which Back and Menu return to exactly as it was. */
  let info = null;
  let infoEnv = { songs: {} };
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
  /* The piece whose level is armed (a ladder: catalog.mjs ladderLeaf) and
   * which of its levels; null and 0 for anything else. */
  let armedPiece = null;
  let armedLevel = 0;
  /* The program unit it was opened from, so Next carries on in that unit. */
  let armedUnit = null;
  /* The stage whose checkpoint is being played (Test out: checkpoint, or a
   * row of its Checkpoint folder). */
  let checkPhase = null;
  /* Whether the next Continue is a review, when one is due: they alternate,
   * one review, then one new step. Kept in memory on purpose — it paces a
   * sitting, it is not a record. */
  let reviewNext = true;
  /* The options sheet open over the list: { title, items, cursor, row }. */
  let sheet = null;
  /* The card open: { kind: 'welcome'|'tip', pages, page, choice, back }. */
  let card = null;
  /* The settings group open (settings_def GROUPS), or null for every setting
   * at once — Shift+click on a piece. */
  let settingsGroup = null;
  /* When the quiz was left for a page over it (help, a tip), for its clock. */
  let awayAt = 0;
  /* Basics built the way the program teaches it (PLAN.PROGRAM_GEN), whatever
   * the settings say; program steps open from here. */
  let programTree = null;
  /* 1: the target pads light as the notes arrive. 2: they do not. */
  let stage = 1;
  /* Only a run started from the top is a whole attempt; one started from a
   * scrubbed bar is practice on a passage, and is not recorded. */
  let runFromTop = false;
  let fileSongs = [];       /* [{ chart, category }] in manifest order */
  let fileCategories = [];

  let settingsCursor = 0;
  let settingsEditing = false;
  /* Where the Settings page goes back to: 'menu' (the list or home it was
   * opened from) or 'piece' (Shift + click on a drill: its ready screen). */
  let settingsOver = 'menu';
  /* The list Settings › Advanced was opened over, to go back to. */
  let settingsBack = null;

  let ledDirty = true;

  /* ---- Exercises ---------------------------------------------------------- */
  function generatorOptions() {
    return {
      rootPc: settings.rootPc,
      mode: settings.mode,
      bpm: settings.bpm,
      transpose: settings.transpose,
      seed: 1,
      /* Practice › Random draws a new set each time a row is opened. */
      newSeed: () => (wallNow() & 0x7fffffff) || 1,
    };
  }

  function loadFileExercises() {
    fileSongs = [];
    fileCategories = [];
    const manifestText = readText('exercises/index.json');
    if (!manifestText) return;
    fileCategories = parseCategories(manifestText);
    const rows = parseManifest(manifestText);
    for (let i = 0; i < rows.length; i++) {
      const text = readText('exercises/' + rows[i].file);
      if (!text) continue;
      const { chart: parsed } = parseExercise(text, rows[i].id);
      if (parsed) fileSongs.push({ chart: parsed, category: rows[i].category });
    }
  }

  /* The path's whole-category units are made from the files, so they follow them. */
  function buildTracks() {
    phases = PLAN.buildProgram({ songs: fileSongs });
    infoEnv = { songs: {}, phases };
    for (let i = 0; i < fileSongs.length; i++) infoEnv.songs[fileSongs[i].chart.id] = fileSongs[i].chart;
  }

  /*
   * The tree, built again whenever a setting that shapes the generated lessons
   * changes. The open folders are carried across by path, so turning the key
   * with Practice › Progressions open leaves you in Practice › Progressions.
   */
  /*
   * The Quiz folder, by skill:
   *
   *   Ear      something is played; you name it or play it back
   *   Reading  the courses on the staff, and notes and chords by staff
   *   Keys     a name is shown and you find it on the pads (any octave
   *            counts), or a pad is lit and you name it
   *
   * The drills here follow the Half tones and Chords settings, and their ids
   * do too, so a chromatic round and an in-key round are filed apart.
   */
  const QUIZ_READ = [
    { label: 'Notes by staff', guess: GUESS.NOTES, read: GUESS.READ_STAFF },
    { label: 'Chords by staff', guess: GUESS.CHORDS, read: GUESS.READ_STAFF },
  ];
  const QUIZ_KEYS = [
    { label: 'Notes by alphabet', guess: GUESS.NOTES, read: GUESS.READ_NAME },
    { label: 'Chords by name', guess: GUESS.CHORDS, read: GUESS.READ_NAME },
    { label: 'Name notes', guess: GUESS.NOTES, pick: true },
    { label: 'Name chords', guess: GUESS.CHORDS, pick: true },
  ];

  function settingsQuiz(row) {
    return {
      kind: row.guess, hear: Boolean(row.hear), pick: Boolean(row.pick), read: row.read || null,
      halfTones: settings.halfTones, chordSet: settings.chordSet, pinned: false, label: row.label,
    };
  }

  function quizId(spec) {
    return 'quiz:' + STATS.drillId(spec);
  }

  /* Rows here and on the Path are the same steps by id, so a level played in
   * either is the same item in Progress. */
  function quizRows(rows) {
    return rows.map((r) => ({ ...r, value: '', key: quizId(settingsQuiz(r)), absolute: true }));
  }

  /*
   * Settings: its row opens the one short page ('main'); the rest is a real
   * folder under it, Advanced, of the groups, each opening its page. Real,
   * so a rebuild (a Key or Half tones edit) restores a list inside it.
   */
  function settingsFolder() {
    const advanced = CAT.folder('Advanced', SET.GROUPS.map((g) => ({
      label: g.label, value: CAT.FOLDER, key: g.key, settingsGroup: g.key,
    })), 'advanced');
    advanced.advanced = true;
    const node = CAT.folder('Settings', [advanced], 'settings');
    node.settingsGroup = SET.MAIN_GROUP.key;
    return node;
  }

  /*
   * The top of the list, the same in Piano Practice and Drums Practice:
   *
   *   Continue   the next step, or a review that is due
   *   Path       the stages, then Review while anything is due
   *   Practice   the free library: scales, chords, progressions, random, songs
   *   Quiz       Ear, Reading, Keys
   *   Progress
   *   Settings
   */
  function rebuildMenu() {
    const quizFolders = [
      PLAN.hearMenu(),
      PLAN.readMenu(quizRows(QUIZ_READ)),
      CAT.folder('Keys', quizRows(QUIZ_KEYS), 'keys'),
    ];
    catalog = CAT.buildCatalog({
      songs: fileSongs,
      categories: fileCategories,
      gen: generatorOptions(),
      /* Continue lives in the Path: PLAY on its map, the first row of its list. */
      lead: [PLAN.programFolder(phases, repetitionRows)],
      after: [CAT.folder('Quiz', quizFolders, 'quiz')],
      tail: [{ label: 'Progress', progress: true, value: '~' }, settingsFolder()],
    });
    /* The top of the list is the home screen: five circles; Practice and
     * Quiz are rings of their own. */
    ringOf(catalog, HOME_ICONS);
    ringOf(catalog.children.find((r) => r.key === 'basics'), PRACTICE_ICONS);
    ringOf(catalog.children.find((r) => r.key === 'quiz'), QUIZ_ICONS);
    nav = nav.length ? CAT.navRestore(catalog, CAT.navPath(nav)) : CAT.navStart(catalog);
    const pinned = CAT.basics({ ...generatorOptions(), ...PLAN.PROGRAM_GEN });
    CAT.stampChildren([pinned], '');
    programTree = { children: [pinned] };
  }

  /* Where a top-level row sits, by its key. */
  function topIndex(key) {
    return catalog.children.findIndex((r) => r.key === key || (key === 'continue' && r.continueRow));
  }

  /* The list at the top, the cursor on a top-level row, and into it if it is
   * a folder: how the sheet reaches Settings, and the welcome the Path. */
  function goTop(key, enter) {
    nav = CAT.navStart(catalog);
    nav[0].cursor = Math.max(0, topIndex(key));
    if (enter && CAT.navPush(nav)) enterMap();
    view = MENU;
    dirty = true;
    ledDirty = true;
  }

  /* A program step's row: generated ones from the pinned Practice. */
  function findProgramLeaf(id) {
    if (programTree && id.indexOf('basics/') === 0) {
      const hit = CAT.findById(programTree, id);
      if (hit) return hit.node;
    }
    return findLeaf(id);
  }

  /* A row by id, wherever it sits in the tree. */
  function findLeaf(id) {
    const hit = CAT.findById(catalog, id);
    return hit ? hit.node : null;
  }

  /* What an item is called on its own, outside the folder it sits in. */
  function itemTitle(id) {
    if (id.indexOf('quiz:') === 0) return STATS.drillLabel(id.slice(5));
    const step = PLAN.findStep(phases, id);
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
    const day = Math.floor(wallNow() / 86400000);
    if (repCache.rev === progress.rev && repCache.day === day) return repCache.rows;
    const rows = PROG.repetitionSession(progress, wallNow()).map((r) => ({
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
      drill, n: quiz.correct, ms, wrong: quiz.wrong, hints: quiz.hintsUsed, at: wallNow(),
      context: roundContext(),
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
    STATS.addTally(stats, drill, quiz.tally);
    if (quiz.subject) STATS.addItems(stats, quiz.subject, quiz.mode, quiz.items);
    /* After the append, so the chart's last point is the round you just played.
     * `best` above is deliberately taken before it — that is the number you were
     * trying to beat, not the one you have just set. */
    lastResult.records = STATS.forDrill(stats, drill);
    lastResult.success = STATS.successPercent(quiz.correct, quiz.wrong);
    /* Each answer: this round, and every round of this drill so far. */
    const all = STATS.tallyFor(stats, drill);
    lastResult.answers = GUESS.tallyRows(quiz).map((r) => ({
      key: r.key, label: r.label, asked: r.asked, right: r.right,
      allAsked: all[r.key] ? all[r.key][0] : r.asked,
      allRight: all[r.key] ? all[r.key][1] : r.right,
    }));
    lastResult.page = 0;
    saveStats();

    const before = pathSnapshot(quizId(quizSpec));
    const res = PROG.recordAttempt(progress, quizId(quizSpec), {
      stage: PROG.quizStage(quiz.hintsUsed),
      score: PROG.quizScore(quiz.correct, quiz.wrong),
      at: wallNow(),
    });
    saveProgress();
    takeStory = storyOf(before, quizId(quizSpec));
    lastResult.passed = res.passed;
    lastResult.twoNext = twoNext();
    const assumed = checkCompleted();

    allNotesOff();
    view = RESULT_VIEW;
    dirty = true;
    ledDirty = true;
    announce('Round done. ' + Math.round(lastResult.rate) + ' per minute.'
      + (lastResult.isBest ? ' Best yet.' : '') + passedWords(res.passed) + assumed);
    learnedScene();
  }

  function passedWords(passed) {
    if (passed === 2) return ' Finished.';
    if (passed === 1) return ' Guided done.';
    return '';
  }

  /*
   * What a round was asked in beyond its id: the key, and for a chord drill
   * the roots it drew from — the Half tones setting decides them, and it is
   * not part of a chord drill's id, so the record says.
   */
  function roundContext() {
    if (!quiz || quiz.kind === GUESS.EAR) return null;
    const x = { k: quizKey().rootPc };
    if (quiz.kind === GUESS.CHORDS) {
      x.r = quizSpec.chordSet === 'types' || quizSpec.chordSet === 'advanced'
        ? (quizSpec.halfTones ? 'chromatic' : 'key')
        : 'diatonic';
    }
    return x;
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
  function twoNext() {
    const it = PROG.item(progress, currentItemId());
    return Boolean(it && PROG.stagePassed(it, 1) && !PROG.isFinished(it));
  }

  /* The key a quiz asks in: a program step's own, or the settings'. */
  function quizKey() {
    return quizSpec && quizSpec.gen ? quizSpec.gen : settings;
  }

  function startQuiz(spec) {
    allNotesOff();
    quizSpec = spec;
    quizHear = Boolean(spec.hear);
    quizPick = Boolean(spec.pick);
    quiz = GUESS.createQuiz({
      kind: spec.kind,
      rootPc: quizKey().rootPc,
      mode: quizKey().mode,
      transpose: settings.transpose,
      halfTones: spec.halfTones,
      chordSet: spec.chordSet,
      pick: quizPick,
      exercise: spec.exercise,
      level: spec.level,
      roundSize: settings.roundSize,
      fifths: keyFifths(),
      read: quizRead(spec),
      /* What this drill has asked before and how it went: the answers you
       * miss come round more often. */
      history: STATS.tallyFor(stats, STATS.drillId(spec)),
      itemTable: stats.items,
      seed: (wallNow() & 0x7fffffff) || 1,
    });
    quizSolvedAt = 0;
    view = GUESS_VIEW;
    dirty = true;
    ledDirty = true;
    if (readingCourse()) {
      /* Reading: the staff is the question, so nothing sounds until you ask. */
      announce(quiz.exercise.name + '. Read it, then jog to the answer and click.');
    } else if (quiz.kind === GUESS.EAR) {
      hearPrompt();
      announce(quiz.exercise.name + '. Listen, then jog to the answer and click.');
    } else if (quizPick) {
      announce('Name the lit pad. Jog to choose, click to answer.');
    } else if (quizHear) {
      hearPrompt();
      announce('Ear training. Listen, then play what you hear.');
    } else if (quiz.read === GUESS.READ_STAFF) {
      /* The name is the answer here; saying it would read the staff for you. */
      announce((quiz.kind === GUESS.CHORDS ? 'Chords' : 'Notes') + ' by staff. Play what is written.');
    } else {
      announce('Note guesser. Play ' + promptName() + '.');
    }
    autoInfo({ id: quizId(spec) });
    showTip(TIPS.QUIZ);
  }

  /*
   * How a quiz that is played on the pads is read. A Play row says; a program
   * step or a repetition from before the split asked for the name and the
   * notes together, which the name drill — same id — now is.
   */
  function quizRead(spec) {
    if (spec.kind === GUESS.EAR || spec.hear || spec.pick) return null;
    return spec.read === GUESS.READ_STAFF ? GUESS.READ_STAFF : GUESS.READ_NAME;
  }

  /*
   * How far the row has moved on towards the next prompt: 0 at rest, rising to
   * 1 over the pause after a right answer — which is exactly when nextPrompt
   * shifts the queue, so the jump back to 0 lands on the same picture. Eased
   * out, as the song staff settles: quick to leave, gentle to arrive.
   */
  function quizGlide() {
    if (!quiz || !quiz.read || !quizSolvedAt) return 0;
    const f = Math.min(1, Math.max(0, (now() - quizSolvedAt) / GUESS_ADVANCE_MS));
    return 1 - Math.pow(1 - f, 3);
  }

  /* A reading course: the prompt is drawn, not played. */
  function readingCourse() {
    return Boolean(quiz && quiz.exercise && quiz.exercise.read);
  }

  /* What the prompt is called: its chord symbol if it has one, else its notes. */
  function promptName() {
    if (!quiz) return '';
    if (quiz.read === GUESS.READ_NAME && quiz.entry) return GUESS.entryName(quiz, quiz.entry);
    return quiz.label || NOTATION.chordLabel(quiz.prompt, keyFifths());
  }

  /*
   * The help that fades with the stage: the reference line and the names
   * under the notes, on at stage 1 and off at stage 2 unless chosen otherwise.
   */
  const fades = (value, onWord) => value === onWord || (value === 'stage1' && stage === 1);
  function referenceOn() {
    return fades(settings.reference, 'on');
  }
  function namesShown() {
    return fades(settings.names, 'always');
  }

  /* Without names, the note the scroll waits on is named once it has waited
   * this long: a hint for the stuck, not the answer for the hesitant. */
  const STUCK_NAME_BEATS = 2;
  function stuckNamed() {
    return namesShown() || (blocked && scoreBeats - songBeats >= STUCK_NAME_BEATS);
  }

  /* The Key and Scale settings' key, to spell in: C minor's Eb, not D#. */
  function keyFifths() {
    return GEN.keyForScale(quizKey().rootPc, quizKey().mode);
  }

  /*
   * The checkpoint just played through is complete: every check step passed
   * at stage 2. Continue now starts at the next stage. Passing the same steps
   * in ordinary practice moves the learner on too (currentPhase), but only
   * the checkpoint skips the rest of the stage, because only it asked to.
   */
  function checkCompleted() {
    if (!checkPhase || !PLAN.checkPassed(progress, checkPhase)) return '';
    const done = checkPhase;
    checkPhase = null;
    if (PROG.programStart(progress) <= done.index) {
      PROG.setProgramStart(progress, Math.min(done.index + 1, phases.length - 1));
      saveProgress();
    }
    return ' Checkpoint ' + done.n + ' passed. The path moves on.';
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
    /* Settings is a page, not its folder; a group of Advanced its page. */
    if (row.settingsGroup) {
      openSettings(row.settingsGroup, 'menu');
      return;
    }
    if (CAT.navPush(nav)) {
      view = MENU;
      dirty = true;
      ledDirty = true;
      enterMap();
      /* From the world into an island: the island grows out of its place. */
      if (zoomsBetween(nav[nav.length - 2].node, row)) {
        const world = pathMap(null);
        const m = mapNow();
        playScenes([{ kind: SC.ZOOM, dir: 'in', map: world, island: pathMap(row.phase),
          at: placeOfPhase(world, row.phase), landAt: m ? m.walk.target : 0, say: row.label + '.' }], toMenu);
        return;
      }
      announce(row.label + '.');
      return;
    }
    if (row.progress) {
      openProgress();
      return;
    }
    checkPhase = null;
    if (row.continueRow) {
      openContinue();
      return;
    }
    if (row.step) {
      /* A row of a Checkpoint folder is the exam: at S2, and on to the next
       * check step from its result. */
      const exam = CAT.navTop(nav).node.checkpoint;
      if (exam) {
        checkPhase = exam;
        openStep(row.step, null, 2);
        return;
      }
      openStep(row.step, openUnit());
      return;
    }
    armedUnit = null;
    if (row.repId) {
      openItem(row.repId);
      return;
    }
    if (row.guess) {
      startQuiz(settingsQuiz(row));
      return;
    }
    if (row.levels) {
      armLeaf(row.levels[firstOpenLevel(row)]);
      return;
    }
    armLeaf(row);
  }

  /* The program unit whose folder the list is in, if it is in one. */
  function openUnit() {
    for (let i = nav.length - 1; i >= 0; i--) if (nav[i].node.unit) return nav[i].node.unit;
    return null;
  }

  /* The program's next step, worked out once per change of progress: the list
   * asks for it on every row it draws. */
  let nextCache = { progress: null, phases: null, rev: -1, value: null };

  function continueNext() {
    const c = nextCache;
    if (c.progress !== progress || c.phases !== phases || c.rev !== progress.rev) {
      nextCache = { progress, phases, rev: progress.rev, value: PLAN.continueStep(progress, phases) };
    }
    return nextCache.value;
  }

  /*
   * What Continue opens: when a review is due, one review and then one new
   * step, in turn, so a sitting of new work still brings old work back. With
   * nothing new left, only reviews; with nothing due, only new steps.
   */
  function continueTarget() {
    const next = continueNext();
    if (reviewNext || !next) {
      const due = repetitionRows().find((r) => !r.done);
      if (due) return { review: due.repId };
    }
    return next;
  }

  function openContinue() {
    const next = continueTarget();
    if (!next) return;
    reviewNext = !next.review;
    if (next.review) {
      armedUnit = null;
      openItem(next.review);
      return;
    }
    openStep(next.step, next.unit);
  }

  /* A program step: a pointer at a row, or a quiz with its options pinned. */
  function openStep(step, unit, forceStage) {
    armedUnit = unit || PLAN.unitOf(phases, step.id);
    if (step.quiz) {
      startQuiz({ ...step.quiz, pinned: true, gen: PLAN.PROGRAM_GEN, label: PLAN.stepTitle(step) });
      return;
    }
    const node = findProgramLeaf(step.id);
    if (node) armLeaf(node, forceStage);
  }

  /* Test out: checkpoint. Its steps one after another at stage 2; the ones
   * already passed there count without being played again. */
  function openCheck(phase) {
    checkPhase = phase;
    const step = PLAN.nextCheckStep(progress, phases, phase);
    if (!step) {
      announce('Checkpoint passed.' + checkCompleted());
      dirty = true;
      return;
    }
    openStep(step, null, 2);
  }

  function startHere(phase) {
    PROG.setProgramStart(progress, phase.index);
    saveProgress();
    announce('The path starts at stage ' + phase.n + '.' + (phase.index ? ' The stages before it count as assumed.' : ''));
    dirty = true;
  }

  /* Anything by its id: a repetition, or what Next lands on. */
  function openItem(id) {
    const inProgram = Boolean(PLAN.findStep(phases, id));
    if (id.indexOf('quiz:') === 0) {
      const spec = PLAN.quizFromId(id);
      if (spec) startQuiz({ ...spec, pinned: true, gen: inProgram ? PLAN.PROGRAM_GEN : null, label: itemTitle(id) });
      return;
    }
    const node = inProgram ? findProgramLeaf(id) : findLeaf(id);
    if (node) armLeaf(node);
  }

  /* Arm a playable row on the first stage you have not yet passed, or on the
   * stage a check asks for. */
  function armLeaf(node, forceStage) {
    /* Opened again, a song starts at its written tempo. */
    sessionTempo = null;
    if (!armNode(node, forceStage)) return;
    announce(chart.name + '. ' + (stage === 2 ? 'Solo' : 'Guided') + '. Press play to start.');
    autoInfo({ id: armedId, label: chart.name });
    showTip(TIPS.PRACTICE);
  }

  /* The chart of a row (or of one level of a piece) on the ready screen, at
   * its first stage not passed or the one asked for. */
  function armNode(node, forceStage) {
    const built = node.build ? node.build() : null;
    if (!built) return false;
    armedId = node.id || null;
    armedPiece = node.piece || null;
    armedLevel = armedPiece ? armedPiece.levels.indexOf(node) : 0;
    chart = built;
    if (chart.source !== 'file') chart.bpm = settings.bpm;
    /* Another level of the same song keeps the tempo turned to for it. */
    else if (sessionTempo && sessionTempo.key === (armedPiece || armedId)) chart.bpm = sessionTempo.bpm;
    stage = forceStage || PROG.recommendedStage(PROG.item(progress, armedId));
    armRun();
    view = READY;
    dirty = true;
    ledDirty = true;
    return true;
  }

  /* ---- The level, on the ready screen ---------------------------------------- */
  /*
   * A piece with a ladder is one row; opening it arms its first level not yet
   * learned, and the jog on the ready screen walks its levels and their two
   * ways together — 1 Guided, 1 Solo, 2 Guided, 2 Solo... — clamped. A step
   * of the Path, Continue and Review arm the level they name.
   */
  function firstOpenLevel(piece) {
    const at = piece.levels.findIndex((lv) => !PROG.isFinished(PROG.item(progress, lv.id)));
    return at >= 0 ? at : piece.levels.length - 1;
  }

  function readyJog(sign) {
    const count = armedPiece ? armedPiece.levels.length : 1;
    const pos = armedLevel * 2 + stage - 1;
    const next = clamp(pos + sign, 0, count * 2 - 1);
    if (next === pos) return;
    const level = next >> 1;
    const to = (next & 1) + 1;
    if (level !== armedLevel) {
      armLevel(level, to);
      return;
    }
    stage = to;
    dirty = true;
    ledDirty = true;
    announce(stage === 2 ? 'Solo. The pads stay dark.' : 'Guided. The pads light up.');
  }

  /* Another level of the armed piece, from bar 1, at `toStage` (default: its
   * first not passed). */
  function armLevel(index, toStage) {
    if (!armedPiece || view !== READY || index < 0 || index >= armedPiece.levels.length) return;
    const lv = armedPiece.levels[index];
    if (!armNode(lv, toStage)) return;
    announce('Level ' + lv.label + '. ' + (stage === 2 ? 'Solo' : 'Guided') + '.');
  }

  /* What the ready screen's LEVEL box shows: the levels (one, for a piece
   * without a ladder), which is armed, and how far each is learned. */
  function levelInfo() {
    if ((view !== READY && view !== RUNNING) || !chart || !armedId) return null;
    const levels = armedPiece ? armedPiece.levels : [{ id: armedId, label: '', step: 'L1', name: '' }];
    return {
      index: armedLevel,
      stage,
      ladder: Boolean(armedPiece),
      levels: levels.map((lv) => ({
        id: lv.id, label: lv.label, step: lv.step, name: lv.name || '',
        learned: PROG.isFinished(PROG.item(progress, lv.id)),
      })),
      /* The bottom line's name for it: the level and the way it is played. */
      name: armedPiece ? levels[armedLevel].label + '  ' + (stage === 2 ? 'Solo' : 'Guided')
        : (stage === 2 ? 'Solo: pads dark' : 'Guided: pads lit'),
    };
  }

  /*
   * Past Continue's step without playing it. A step whose stage 1 is passed is
   * moved on from — counted finished at stage 1 — rather than skipped.
   */
  function skipContinue() {
    const next = continueNext();
    if (!next) return;
    passOver(next.step.id);
    announce('Skipped. Next: ' + itemTitle((continueNext() || next).step.id) + '.');
    dirty = true;
  }

  function passOver(id) {
    if (!PROG.moveOn(progress, id, wallNow())) PROG.skipItem(progress, id, wallNow());
    saveProgress();
  }

  /*
   * Next, from a result: stage 2 of the same piece if stage 1 has just been
   * passed; in a check, its next step; otherwise the next step of the unit you
   * came from, or wherever Continue would send you.
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
        announce('Solo. The pads stay dark.');
      }
      dirty = true;
      ledDirty = true;
      return;
    }
    if (checkPhase) {
      const step = PLAN.nextCheckStep(progress, phases, checkPhase);
      if (step) {
        openStep(step, null, 2);
        return;
      }
      checkPhase = null;
    }
    const unit = armedUnit || PLAN.unitOf(phases, id);
    const step = unit ? PLAN.nextInUnit(progress, unit) : null;
    const next = step ? { step, unit } : continueNext();
    /* A place or a stage just done: its scenes first, then on. */
    const story = takeStory;
    takeStory = null;
    const scenes = story ? storyScenes(story, next) : [];
    const go = () => {
      /* The whole path done: its world map, the moment to look back. */
      if (story && story.pathDone) {
        goTop('program', true);
        return;
      }
      if (next) {
        openStep(next.step, next.unit);
        return;
      }
      view = MENU;
      dirty = true;
      ledDirty = true;
    };
    if (scenes.length) {
      playScenes(scenes, go);
      return;
    }
    go();
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
    announce('Back to the start. ' + (stage === 2 ? 'Solo' : 'Guided') + '.');
  }

  /*
   * Knob 8: the tempo. A generated drill is made at the Tempo setting, so
   * there it edits the setting (saved, as before). A song keeps the tempo it
   * was written at, so there it turns the song's own tempo for the session:
   * to learn it slowly and build it up. That is never saved -- not into the
   * song, the settings or the progress -- and opening the song again starts
   * at its written tempo; its other levels keep it while it stays armed.
   * The range is the Tempo setting's (40..200): one knob, one range, slow
   * enough for any first reading and as fast as any drill goes. A take at a
   * slower tempo is judged as every take is: 90% passes at any tempo
   * (progress.mjs PASS); its tempo is kept with the attempt, as always.
   */
  let sessionTempo = null;

  function tempoKnob(delta) {
    if (!delta) return;
    if (!chart || chart.source !== 'file' || (view !== READY && view !== RUNNING)) {
      editSetting(SET.settingIndex('bpm'), delta);
      return;
    }
    const def = SET.SETTINGS_DEF[SET.settingIndex('bpm')];
    const bpm = clamp(chart.bpm + delta, def.min, def.max);
    if (bpm === chart.bpm) return;
    /* Running, the playhead keeps its place: the clock is re-anchored at the
     * new tempo where it stands (or where it was paused). */
    if (view === RUNNING) {
      const at = paused ? pausedAtMs : now();
      const beats = msToBeats(at - runStartMs, chart.bpm);
      runStartMs = at - beatsToMs(beats, bpm);
    }
    chart.bpm = bpm;
    if (run) SCORE.setRunTempo(run, bpm, settings.graceBeats);
    sessionTempo = { key: armedPiece || armedId, bpm };
    dirty = true;
    ledDirty = true;
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
    const snapshot = pathSnapshot(armedId);
    const res = PROG.recordAttempt(progress, armedId, {
      stage, score, at: wallNow(), bpm: chart.bpm,
    });
    saveProgress();
    takeStory = storyOf(snapshot, armedId);
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
      /* In time, early, late, and whether the run rushed or dragged. */
      timing: SCORE.timingSummary(run),
    };
    lastResult.twoNext = twoNext();
    armRun();
    view = RESULT_VIEW;
    dirty = true;
    ledDirty = true;
    announce('Done. ' + Math.round(score * 100) + ' percent.' + passedWords(res.passed) + checkCompleted());
    learnedScene();
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
  /*
   * Every pitch sounding now, whatever the screen: a pad held in the list, a
   * key played on a page, Listen, a quiz's prompt, the reference line. Not
   * the click -- a metronome tick is not a note anyone played -- which is the
   * scheduled offs marked as the click's, so nothing new has to be kept in
   * step. The Move's own pads light from collectSounding, which is Listen's;
   * this is for a renderer that shows a keyboard (view_model.mjs, cue.playing).
   */
  const playingBuf = [];
  function collectPlaying() {
    playingBuf.length = 0;
    const clicks = {};
    for (let i = 0; i < listenOff.length; i++) {
      if (listenOff[i].click) clicks[listenOff[i].pitch] = (clicks[listenOff[i].pitch] || 0) + 1;
    }
    for (const key in pitchRefcount) {
      if (pitchRefcount[key] > (clicks[key] || 0)) playingBuf.push(+key);
    }
  }
  /*
   * The answer bar: the Hear drills' answers as coloured pads. Only there —
   * in Name the lit pads ARE the question, and a bar across the bottom row
   * covered the very pads you were being asked about, so Name answers with the
   * jog. Everywhere else the bar does not exist and the bottom row is keys.
   */
  function answerBarActive() {
    return view === GUESS_VIEW && Boolean(quiz) && quiz.kind === GUESS.EAR;
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
    /* A host with a metronome of its own — the piano's recorded claves —
     * plays it and says so; one that cannot (MIDI out to an instrument
     * elsewhere) gets the click as notes, below. */
    if (fx.click && fx.click(downbeat)) return;
    /* Short, high, and out of the way of anything the exercise plays.
     * Goes through noteOn, not a raw midiOut: allNotesOff can only silence what
     * pitchRefcount knows about, and a click sent behind its back was left
     * ringing when the module closed between the note-on and its scheduled off. */
    const pitch = downbeat ? 96 : 91;
    noteOn(pitch, downbeat ? 90 : 55);
    listenOff.push({ pitch, atBeats: songBeats + 0.1, click: true });
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
    const vel = CTRL.referenceVelocity(listening, referenceOn(), settings.refVel);
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
      noteOn(guessOn[i].pitch, guessOn[i].vel || 90);
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
      } else if (quiz.read !== GUESS.READ_STAFF) {
        announce(promptName());
      }
      return;
    }
    /* The row is gliding on: every frame of it is a new picture. */
    if (quizSolvedAt && quiz && quiz.read) dirty = true;
  }

  function serviceNoteOffs() {
    for (let i = listenOff.length - 1; i >= 0; i--) {
      if (listenOff[i].atBeats > songBeats) continue;
      noteOff(listenOff[i].pitch);
      listenOff.splice(i, 1);
    }
  }
  /*
   * What a row of the list says about your progress: a percentage, and a mark
   * for a stage passed, a skip, or the program's next step. Worked out as the
   * row is drawn, from the store, so the tree never has to be rebuilt when you
   * get better at something.
   */
  function decorateRow(row) {
    /* Continue names what it opens. A name too long for the row gives way
     * to its unit's number (`short`), and the whole name goes to the title
     * bar while the cursor is on the row (`title`). */
    if (row.continueRow) {
      const next = continueTarget();
      if (!next) return { label: 'Continue', value: 'all done', mark: PROG.MARK_DONE };
      const name = next.review ? itemTitle(next.review) : PLAN.stepTitle(next.step);
      const unit = next.review ? PLAN.unitOf(phases, next.review) : next.unit;
      return { label: next.review ? 'Review' : 'Continue', value: name, short: unit ? unit.num : '', title: name };
    }
    if (row.checkpoint) {
      const passed = row.checkpoint.check.filter((id) => PROG.stagePassed(PROG.item(progress, id), 2)).length;
      return {
        value: passed + '/' + row.checkpoint.check.length + ' >',
        mark: PLAN.checkPassed(progress, row.checkpoint) ? PROG.MARK_DONE : null,
      };
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
        : PROG.summariseIds(progress, PLAN.phaseSteps(row.phase).map((st) => st.id));
      return { value: sum.percent + '%' };
    }
    if ('children' in row) {
      if (row.untracked) return null;
      const sum = PROG.folderSummary(agg, progress, row);
      return { value: sum.percent > 0 ? sum.percent + '% >' : '>', mark: programMark(row) };
    }
    /* A piece with a ladder: its levels summed, marked done when all are. */
    if (row.levels) {
      const sum = PROG.summariseIds(progress, row.levels.map((lv) => lv.id));
      const mark = sum.done === sum.count ? PROG.MARK_DONE : sum.done || sum.half ? PROG.MARK_HALF : null;
      return { value: sum.percent > 0 ? sum.percent + '%' : '', mark };
    }
    const id = row.itemId || (PROG.isTracked(row) ? row.id : null);
    if (!id) return null;
    const it = PROG.item(progress, id);
    let mark = PROG.itemMark(it);
    /* Only inside the program: the same step in Quiz › Hear is just a drill. */
    const unit = !mark && row.step ? openUnit() : null;
    if (unit) {
      const next = PLAN.nextInUnit(progress, unit);
      if (next && next.id === id) mark = 'next';
      else if (PLAN.isAssumed(progress, phases, unit.phase)) mark = PROG.MARK_ASSUMED;
    }
    return { value: it && it.plays ? PROG.itemPercent(it) + '%' : '', mark };
  }

  /* A phase or unit folder of the program: where you are, or skipped past. */
  function programMark(row) {
    if (row.phase) {
      if (PLAN.isAssumed(progress, phases, row.phase)) return PROG.MARK_ASSUMED;
      const cur = PLAN.currentPhase(progress, phases);
      return cur === row.phase ? 'next' : null;
    }
    if (row.unit) {
      const next = continueNext();
      return next && next.unit === row.unit ? 'next' : null;
    }
    return null;
  }
  /* ---- Help (MENU) -------------------------------------------------------------- */
  /*
   * Menu is help for whatever is in front of you: the highlighted row of the
   * list, the armed exercise, the drill under way, a result, the sheet, a
   * card. Every page ends with the keys of the screen it was opened from,
   * from the same table as the hint line. Opening it pauses what is running —
   * the scroll, the round's clock — so reading costs nothing.
   */
  function infoTarget() {
    if (view === MENU && onHome()) {
      const row = CAT.navCurrent(nav);
      return row ? (row.progress ? { kind: 'progress' } : { id: row.id, label: row.label }) : null;
    }
    if (view === MENU && onMap()) {
      /* The place under the avatar: a stage's promise, a unit's purpose and
       * why, the checkpoint's exam. */
      const row = CAT.navCurrent(nav);
      if (row && row.checkpoint) return { kind: 'checkpoint', id: 'program/' + row.checkpoint.key };
      return row ? { id: row.id, label: row.label } : null;
    }
    if (view === MENU) {
      const row = CAT.navCurrent(nav) || CAT.navTop(nav).node;
      if (row.continueRow) return { kind: 'continue' };
      if (row.checkpoint) return { kind: 'checkpoint', id: 'program/' + row.checkpoint.key };
      if (row.settingsGroup) return { kind: 'settings', group: row.settingsGroup };
      if (row.step) {
        const ex = PLAN.exerciseOf(phases, row.step.id);
        if (ex) return { id: row.id, label: row.label, about: ex.about, why: ex.why, exercise: ex.label };
      }
      if (row.progress) return { kind: 'progress' };
      return { id: row.repId || row.id, label: row.label };
    }
    if (view === READY || view === RUNNING) return { id: armedId, label: chart ? chart.name : '' };
    if (view === GUESS_VIEW && quizSpec) return { id: quizId(quizSpec), label: quizSpec.label };
    if (view === RESULT_VIEW) return { kind: 'result' };
    if (view === PROGRESS_VIEW || view === PROGRESS_DETAIL) return { kind: 'progress' };
    if (view === SETTINGS) return { kind: 'settings', group: settingsGroup };
    if (view === SHEET_VIEW) return { kind: 'sheet', label: sheet ? sheet.title : '' };
    if (view === CARD_VIEW) return { kind: card && card.kind === 'welcome' ? 'welcome' : 'tip' };
    return null;
  }

  /* What the screen in front of you is called, for a row with no page of its
   * own: its help is still its keys. */
  function screenTitle() {
    if (view === MENU) {
      const row = CAT.navCurrent(nav);
      return row ? row.label : CAT.navTop(nav).node.label;
    }
    return chart ? chart.name : 'Help';
  }

  /* A page left for another over it: the quiz's prompt stops, and its clock
   * is put back by the time spent away (returnTo). */
  function leaveView() {
    if (view === RUNNING && !paused) togglePause();
    if (view === GUESS_VIEW) {
      stopPrompt();
      awayAt = now();
    }
  }

  function returnTo(back) {
    view = back;
    if (view === GUESS_VIEW && quiz) {
      /* The time spent reading is not part of the round. */
      const away = now() - awayAt;
      if (quiz.startedAt !== null && quiz.finishedAt === null) quiz.startedAt += away;
      if (quizSolvedAt) quizSolvedAt += away;
      if ((quizHear || quiz.kind === GUESS.EAR) && !readingCourse() && !quiz.solved) hearPrompt();
    }
    dirty = true;
    ledDirty = true;
  }

  function openInfo(target) {
    const screen = HINTS.screenHelp(screenNow(), hintState());
    const pageInfo = INFO.infoFor(target, infoEnv) || INFO.screenPage(screenTitle());
    leaveView();
    /* The words, not the lines: wrapping is the renderer's, and a 128px panel
     * and a browser window wrap the same paragraphs very differently. */
    info = {
      title: pageInfo.title,
      paragraphs: INFO.infoParagraphs(INFO.withScreen(pageInfo, screen)),
      back: view,
    };
    if (pageInfo.key && !PROG.infoSeen(progress, pageInfo.key)) {
      PROG.markInfoSeen(progress, pageInfo.key, wallNow());
      saveProgress();
    }
    view = INFO_VIEW;
    dirty = true;
    ledDirty = true;
    announce(pageInfo.title + '. Help.');
    return true;
  }

  function closeInfo() {
    if (!info) return;
    const back = info.back;
    info = null;
    returnTo(back);
  }

  /* The first time a kind of practice is opened, its Info page comes first. */
  function autoInfo(target) {
    if (!settings.autoInfo) return;
    const pageInfo = INFO.infoFor(target, infoEnv);
    if (pageInfo && !PROG.infoSeen(progress, pageInfo.key)) openInfo(target);
  }
  /* ---- Progress --------------------------------------------------------------- */
  /*
   * The overview first, then each track, then everything you have played, most
   * recent first. Clicking a row draws its chart; the jog walks the charts.
   */
  const PROGRESS_RECENT = 40;

  function openProgress() {
    const rows = [{ label: 'Overall', overview: 'all' }];
    for (let i = 0; i < phases.length; i++) {
      rows.push({ label: 'Stage ' + phases[i].n, overview: phases[i].key, phase: phases[i] });
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
  /*
   * What the open chart shows, as data: the overview of a track or of
   * everything, a quiz drill's rate over its error, or an exercise's attempts.
   * The plot's size is the renderer's, since the pass timeline is bucketed to it.
   */
  function progressDetail(plotW, plotH) {
    const row = progressRows[progressCursor];
    if (!row) return null;
    const index = progressCursor;
    const total = progressRows.length;
    if (row.overview) {
      const ids = row.overview === 'all'
        ? PROG.leafIds(agg, catalog)
        : PLAN.phaseSteps(row.phase).map((st) => st.id);
      const sum = PROG.summariseIds(progress, ids);
      return {
        kind: 'overview',
        title: row.overview === 'all' ? 'Overall' : 'Stage ' + row.phase.n + ' ' + row.phase.name,
        percent: sum.percent, done: sum.done, half: sum.half, count: sum.count,
        timeline: PROG.passTimeline(progress, ids, plotW, plotH, wallNow()),
        index, total,
      };
    }
    /* A quiz drill keeps its own chart, rate over error: the speed is the point
     * of a round, where accuracy is the point of a piece. */
    const drill = row.drill || (row.itemId.indexOf('quiz:') === 0 ? row.itemId.slice(5) : null);
    if (drill && STATS.forDrill(stats, drill).length) {
      return {
        kind: 'drill', drill, records: STATS.forDrill(stats, drill), drillIndex: index, drillCount: total,
        answers: STATS.answerRows(stats, drill),
      };
    }
    const it = PROG.item(progress, row.itemId);
    return {
      kind: 'item',
      title: row.label,
      history: it ? it.h : [],
      percent: PROG.itemPercent(it),
      best: it ? Math.max(it.stages[0].best, it.stages[1].best) * 100 : 0,
      mark: PROG.itemMark(it),
      index,
      count: total,
    };
  }

  /* ---- Settings ---------------------------------------------------------------- */
  /*
   * One short page ('main') edited in place, and Advanced, a folder of the
   * groups, each a page of its own. A row is a setting ({ index } into
   * settings_def), the path's start, or an action (Advanced, Help's two).
   *
   *   Back: a group's page -> Advanced's list -> the page -> where it was
   *   opened from (the list or home, or a drill's ready screen).
   *   Shift + click on any of them: straight back there.
   */
  function settingsRows() {
    return SET.groupRows(settingsGroup, settings, { start: PLAN.startIndex(progress, phases) + 1 });
  }

  /* A page: 'main', or a group of Advanced. `over` says where the main page
   * goes back to, when it is opened. */
  function openSettings(group, over) {
    settingsGroup = group || SET.MAIN_GROUP.key;
    if (settingsGroup === SET.MAIN_GROUP.key && over) {
      settingsOver = over;
      settingsBack = null;
    }
    settingsCursor = 0;
    settingsEditing = false;
    view = SETTINGS;
    dirty = true;
    ledDirty = true;
    announce(SET.groupByKey(settingsGroup).label + '.');
  }

  const onMain = () => settingsGroup === SET.MAIN_GROUP.key;
  const inAdvanced = () => view === MENU && Boolean(CAT.navTop(nav).node.advanced);

  /* The Advanced row: the list of the groups, Settings › Advanced. */
  function openAdvanced() {
    settingsBack = CAT.navPath(nav);
    nav = CAT.navStart(catalog);
    nav[0].cursor = Math.max(0, topIndex('settings'));
    CAT.navPush(nav);
    CAT.navPush(nav);
    settingsEditing = false;
    view = MENU;
    dirty = true;
    ledDirty = true;
    announce('Advanced.');
  }

  /* Back from Advanced's list: the page again, on its Advanced row. */
  function leaveAdvanced() {
    nav = settingsBack ? CAT.navRestore(catalog, settingsBack) : CAT.navStart(catalog);
    settingsBack = null;
    settingsGroup = SET.MAIN_GROUP.key;
    settingsCursor = SET.MAIN.indexOf('advanced');
    settingsEditing = false;
    view = SETTINGS;
    dirty = true;
    ledDirty = true;
    announce('Settings.');
  }

  /* Back from a page: a group to Advanced's list, the page to its origin. */
  function closeSettings() {
    settingsEditing = false;
    if (!onMain()) view = MENU;
    else view = settingsOver === 'piece' && chart ? READY : MENU;
    dirty = true;
    ledDirty = true;
  }

  /* Shift + click on any page: all the way back to where Settings was opened. */
  function closeAllSettings() {
    if (!onMain()) {
      if (settingsBack) nav = CAT.navRestore(catalog, settingsBack);
      settingsBack = null;
      settingsGroup = SET.MAIN_GROUP.key;
    }
    closeSettings();
  }

  /* A row of the page changed by the jog or a knob. */
  function editRow(row, delta) {
    const r = settingsRows()[row];
    if (!r || !delta) return;
    if (r.index !== undefined) {
      editSetting(r.index, delta);
      return;
    }
    if (r.edit === 'start') {
      const at = clamp(PLAN.startIndex(progress, phases) + (delta > 0 ? 1 : -1), 0, phases.length - 1);
      if (at !== PLAN.startIndex(progress, phases)) startHere(phases[at]);
      ledDirty = true;
    }
  }

  /* Click on a row of the page: an action runs, anything else is edited. */
  function clickRow(row) {
    const r = settingsRows()[row];
    if (!r) return;
    if (!r.act) {
      settingsEditing = !settingsEditing;
      dirty = true;
      return;
    }
    if (r.act === 'advanced') {
      openAdvanced();
      return;
    }
    if (r.act === 'tips') {
      PROG.clearTips(progress);
      saveProgress();
      announce('Tips will show again.');
    } else if (r.act === 'welcome') {
      openWelcome(SETTINGS);
    }
    dirty = true;
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
      fx.settingChanged('midiCh');
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
  /* ---- The options sheet ----------------------------------------------------- */
  /*
   * Shift + jog-click on a row: what can be done with it besides opening it
   * (row_sheet.mjs). Drawn as a short list under the row's name; CLICK runs
   * an option and closes the sheet, BACK closes it.
   */
  const sheetLook = {
    settled: (id) => {
      const it = PROG.item(progress, id);
      return PROG.isFinished(it) || Boolean(it && it.skip);
    },
    skipped: (id) => PROG.isSkipped(PROG.item(progress, id)),
    view: () => {
      const node = CAT.navTop(nav).node;
      if (view !== SHEET_VIEW && view !== MENU) return null;
      /* Home offers its list; Back from the list is the circles again. */
      if (node.view === 'home') return listViews.has(node) ? null : 'map';
      return node.view !== 'map' ? null : listViews.has(node) ? 'list' : 'map';
    },
    continueSkippable: () => {
      const next = continueTarget();
      return Boolean(next && !next.review);
    },
  };

  function openSheet() {
    const row = CAT.navCurrent(nav);
    if (!row) return;
    const deco = decorateRow(row);
    sheet = {
      title: deco && deco.label ? deco.label : row.label,
      items: SHEET.sheetFor(row, sheetLook),
      cursor: 0,
      row,
    };
    view = SHEET_VIEW;
    dirty = true;
    ledDirty = true;
    announce(sheet.title + '. Options: ' + sheet.items.map((it) => it.label).join(', ') + '.');
    showTip(TIPS.SHEET);
  }

  function closeSheet() {
    sheet = null;
    view = MENU;
    dirty = true;
    ledDirty = true;
  }

  /* Every step a sheet's row stands for: the step, or what a folder holds. */
  function sheetSteps(row) {
    return row.step ? [row.step] : PLAN.stepsUnder(row);
  }

  function runSheet(index) {
    if (!sheet) return;
    const pick = sheet.items[index];
    if (!pick) return;
    const row = sheet.row;
    closeSheet();
    switch (pick.act) {
      case SHEET.SKIP:
        if (row.continueRow) {
          skipContinue();
        } else {
          passOver(row.step.id);
          announce('Skipped.');
        }
        break;
      case SHEET.SKIP_ALL: {
        const open = sheetSteps(row).filter((st) => !sheetLook.settled(st.id));
        for (const st of open) {
          if (!PROG.moveOn(progress, st.id, wallNow())) PROG.skipItem(progress, st.id, wallNow());
        }
        saveProgress();
        announce('Skipped ' + open.length + (open.length === 1 ? ' step.' : ' steps.'));
        break;
      }
      case SHEET.UNDO: {
        let n = 0;
        for (const st of sheetSteps(row)) if (PROG.unskipItem(progress, st.id)) n++;
        saveProgress();
        announce(n === 1 ? 'Skip undone.' : n + ' skips undone.');
        break;
      }
      case SHEET.START:
        startHere(row.phase);
        break;
      case SHEET.TEST_OUT:
        checkPhase = null;
        openCheck(row.phase);
        break;
      case SHEET.LIST:
      case SHEET.MAP:
        showFolderAs(pick.act);
        break;
      case SHEET.SETTINGS:
        /* Over the list it was asked from; inside Advanced, the page again. */
        if (inAdvanced()) leaveAdvanced();
        else openSettings(SET.MAIN_GROUP.key, 'menu');
        break;
      default:
        break;
    }
    dirty = true;
  }

  /* ---- Cards: the welcome and the tips --------------------------------------- */
  /*
   * A card sits over the screen it was opened on and goes back to it. A tip
   * is shown once, the first time its kind of screen appears (tips.mjs), and
   * recorded in the progress; the welcome runs on the first launch of
   * somebody who has played nothing yet.
   */
  function openCard(kind, pages) {
    leaveView();
    card = { kind, pages, page: 0, choice: 0, back: view };
    view = CARD_VIEW;
    dirty = true;
    ledDirty = true;
    const p = pages[0];
    announce(p.title + '. ' + p.paragraphs.map((x) => x.text).join(' '));
  }

  function showTip(key) {
    if (PROG.tipSeen(progress, key)) return;
    const page = TIPS.tipCard(key);
    if (!page) return;
    PROG.markTipSeen(progress, key);
    saveProgress();
    openCard('tip', [page]);
  }

  function openWelcome(back) {
    openCard('welcome', TIPS.welcomePages('Piano Practice', 'piano', 'note'));
    if (back) card.back = back;
  }

  function closeCard() {
    if (!card) return;
    const done = card;
    card = null;
    if (done.kind === 'welcome') {
      PROG.markTipSeen(progress, TIPS.WELCOME);
      saveProgress();
      goTop('program', false);
      return;
    }
    returnTo(done.back);
  }

  function cardPage(delta) {
    const p = card.pages[card.page];
    if (p.choices) {
      card.choice = clamp(card.choice + (delta > 0 ? 1 : -1), 0, p.choices.length - 1);
      announce(p.choices[card.choice] + '.');
    } else {
      const to = clamp(card.page + (delta > 0 ? 1 : -1), 0, card.pages.length - 1);
      if (to === card.page) return;
      card.page = to;
      const q = card.pages[to];
      announce(q.title + '. ' + (q.choices ? q.choices.join(' or ') : q.paragraphs.map((x) => x.text).join(' ')));
    }
    dirty = true;
  }

  /* CLICK on a card: the next page, or the end of it. On the welcome's last
   * page it answers its question. */
  function cardOn(choice) {
    const p = card.pages[card.page];
    if (!p.choices && card.page < card.pages.length - 1) {
      cardPage(1);
      return;
    }
    if (p.choices && card.kind === 'welcome') {
      placement(choice === undefined ? card.choice : choice);
      return;
    }
    closeCard();
  }

  /* The welcome's answer. From the start: the path from stage 1, the cursor
   * on Continue. Already playing: the Path, and how to test out of a stage. */
  function placement(choice) {
    card = null;
    PROG.markTipSeen(progress, TIPS.WELCOME);
    if (choice === TIPS.ALREADY_PLAY) {
      saveProgress();
      goTop('program', true);
      announce('Learning Path.');
      showTip(TIPS.PLACEMENT);
      return;
    }
    PROG.setProgramStart(progress, 0);
    saveProgress();
    goTop('program', true);
    announce('Learning Path. PLAY opens your first step.');
  }

  /* At start-up: the welcome for somebody new; an existing learner is
   * marked as welcomed without being shown it. */
  function welcomeAtStart() {
    const due = TIPS.welcomeDue(PROG.tipSeen(progress, TIPS.WELCOME),
      PROG.hasHistory(progress) || stats.records.length > 0);
    if (due === 'silent') {
      PROG.markTipSeen(progress, TIPS.WELCOME);
      saveProgress();
    } else if (due === 'show') {
      openWelcome(MENU);
    }
  }

  /* ---- The hint line ----------------------------------------------------------- */
  /* What hints.mjs needs to know about the screen beyond its name. */
  function hintState(extra = {}) {
    const st = { ...extra };
    if (view === MENU) {
      st.top = nav.length <= 1;
      /* Which ring the circles are: home, Practice or Quiz (its help). */
      st.ring = nav.length <= 1 ? 'home' : CAT.navTop(nav).node.key || '';
    }
    if (view === READY) {
      st.stages = Boolean(armedId);
      st.stage = stage;
      st.levels = armedPiece ? armedPiece.levels.length : 1;
    }
    if (view === RUNNING) {
      st.listening = listening;
      st.paused = paused;
    }
    if (view === RESULT_VIEW && lastResult) {
      st.quiz = lastResult.kind === 'quiz';
      st.twoNext = Boolean(lastResult.twoNext);
    }
    if (view === GUESS_VIEW && quiz) {
      st.ear = quiz.kind === GUESS.EAR;
      st.pick = quizPick;
      st.hintsLeft = GUESS.hintsLeft(quiz) > 0;
      st.streak = GUESS.quizStats(quiz).streak;
    }
    if (view === SETTINGS) {
      const r = settingsRows()[settingsCursor];
      st.editing = settingsEditing;
      st.action = Boolean(r && r.act);
      st.open = Boolean(r && r.act === 'advanced');
    }
    if (view === CARD_VIEW && card) {
      st.pages = card.pages.length;
      st.choice = Boolean(card.pages[card.page].choices);
    }
    return st;
  }

  /* The footer's parts for this screen; `opts.shift` while Shift is held,
   * `opts.scrolls` when the renderer's help page is longer than the panel. */
  function hint(opts = {}) {
    return HINTS.hintFor(screenNow(), hintState(opts));
  }

  /* The list's title: the open folder, or, with the cursor on Continue,
   * the whole name of what it opens. */
  function listTitle() {
    const row = CAT.navCurrent(nav);
    const deco = row && row.continueRow ? decorateRow(row) : null;
    return deco && deco.title ? deco.title : CAT.navTop(nav).node.label;
  }

  /* ---- The Path map ---------------------------------------------------------- */
  /*
   * The Path and its stages are drawn as maps (map_places.mjs, pathmap/): the
   * world, an island per stage, and on an island a place per unit and the
   * checkpoint's fort. The nav cursor stays the child index, so Back, a
   * restore and the tests' walk by label work as in a list; the avatar
   * stands on the place that child is. Pads walk on the map and make no
   * sound (the host routes them here, mapPad); in a list they are the piano.
   * What is no place — the Path's Review — is in the folder's list, one
   * option of the sheet away (Show as list), for the session.
   */
  const listViews = new Set();
  let map = null;

  function isMapNode(node) {
    return Boolean(node && node.view === 'map' && !listViews.has(node));
  }

  function onMap() {
    return view === MENU && isMapNode(CAT.navTop(nav).node) && Boolean(mapNow());
  }

  /* The screen the hint line and help speak for: a map, and home, are drawn
   * on MENU. */
  function screenNow() {
    return onHome() ? HOME_SCREEN : onMap() ? MAP_SCREEN : view;
  }

  /* ---- Home: the top of the list as five circles ------------------------------ */
  /*
   * The root folder (view 'home') is drawn by src/home/: Path, Practice,
   * Quiz, Progress, Settings as circles, the one the cursor is on filled and
   * grown. The cursor is the child index, as in the list, so coming back
   * from a section finds its circle selected. The jog grows the next one;
   * Click, or the circle's pad (69..73, silent), opens it. Shift + Click's
   * options can show the five as a list for the session.
   */
  let homeGrow = null;
  let homeGrowNode = null;

  /*
   * Rings: home, and one level down Practice and Quiz, drawn as circles
   * with an icon each (home/icons.mjs), by the same hooks. A folder is a
   * ring with view 'home' and 2 to 5 rows; with more it is a list, which
   * only grown content could cause. Icons are keyed by the row's key, or
   * its label where it has none.
   */
  const HOME_ICONS = { program: 'path', basics: PRACTICE_PIANO, quiz: 'quiz', progress: 'progress', settings: 'settings' };
  const PRACTICE_ICONS = { Scales: 'stairs', Chords: 'chord', Progressions: 'progression', Random: 'dice', Songs: 'song' };
  const QUIZ_ICONS = { hear: 'ear', read: 'staff', keys: 'keyletter' };

  const rowKey = (r) => r.key || (r.progress ? 'progress' : r.label);

  function ringOf(node, icons) {
    if (!node) return;
    node.view = 'home';
    for (const r of node.children) {
      const icon = icons[rowKey(r)] || icons[r.label];
      if (icon) r.icon = icon;
    }
  }

  const isRing = (node) => Boolean(node && node.view === 'home' && !listViews.has(node)
    && node.children.length >= 2 && node.children.length <= HOME_MAX);

  function onHome() {
    return view === MENU && isRing(CAT.navTop(nav).node);
  }

  /* The ring's circles, as the engine takes them, and the grow of the
   * selection: one grow per ring, made again on coming back to it. */
  function homeModel() {
    if (!onHome()) return null;
    const top = CAT.navTop(nav);
    if (!homeGrow || homeGrowNode !== top.node || homeGrow.to !== top.cursor) {
      homeGrow = createGrow(top.cursor);
      homeGrowNode = top.node;
    }
    return {
      items: top.node.children.map((r) => ({ key: rowKey(r), label: r.label, icon: r.icon || null })),
      selected: top.cursor,
      grow: homeGrow,
    };
  }

  function homeJog(delta) {
    const top = CAT.navTop(nav);
    const to = clamp(top.cursor + (delta > 0 ? 1 : -1), 0, top.node.children.length - 1);
    if (to === top.cursor) return;
    homeModel();
    top.cursor = to;
    startGrow(homeGrow, to, now());
    dirty = true;
    ledDirty = true;
    announce(top.node.children[to].label + '.');
  }

  /* A circle, from a pad or a pointer: selected, and opened at once. */
  function homePick(i) {
    skipScene();
    if (!onHome()) return;
    const top = CAT.navTop(nav);
    if (i < 0 || i >= top.node.children.length) return;
    homeModel();
    top.cursor = i;
    startGrow(homeGrow, i, now());
    openRow();
  }

  /* A pad on home: its circle, or nothing; true when home took it, so the
   * host sounds nothing. */
  function homePad(note) {
    if (!onHome()) return false;
    homePick(itemOfPad(note, CAT.navTop(nav).node.children.length));
    return true;
  }

  /* The child of `node` a place opens. */
  function childOf(node, target) {
    return node.children.findIndex((r) => (target.phase ? r.phase === target.phase
      : target.unit ? r.unit === target.unit : r.checkpoint === target.check));
  }

  /*
   * The map of the open folder: its places, worked out again when the
   * progress or the day moves on — the avatar walks on through that — and an
   * avatar on the place of the nav cursor. Null when there are no places.
   */
  function mapNow() {
    const top = CAT.navTop(nav);
    if (!isMapNode(top.node)) return null;
    const day = Math.floor(wallNow() / 86400000);
    if (map && map.node === top.node && map.rev === progress.rev && map.day === day && map.phases === phases) {
      return map;
    }
    const due = MP.dueIdsOf(progress, wallNow());
    const built = top.node.phase ? MP.unitPlaces(progress, phases, top.node.phase, due)
      : MP.stagePlaces(progress, phases, due);
    if (!built.places.length) return null;
    const children = built.targets.map((t) => childOf(top.node, t));
    const same = map && map.node === top.node && map.places.length === built.places.length;
    const layout = same ? map.layout
      : layoutPlaces(built.places.length, { kind: top.node.phase ? 'island' : 'world' });
    let at = children.indexOf(top.cursor);
    if (at < 0) {
      at = MP.startPlace(built.places);
      top.cursor = children[at];
    }
    map = {
      node: top.node, rev: progress.rev, day, phases, places: built.places, children, layout,
      walk: same ? map.walk : createWalk(layout, at), said: same ? map.said : at,
    };
    return map;
  }

  /* Into a map folder: the avatar on the place Continue would choose, else
   * the first open one. */
  function enterMap() {
    const top = CAT.navTop(nav);
    if (!isMapNode(top.node)) return;
    map = null;
    top.cursor = -1;
    const m = mapNow();
    if (!m) {
      top.cursor = 0;
      return;
    }
    const at = MP.startPlace(m.places);
    top.cursor = m.children[at];
    m.walk = createWalk(m.layout, at);
    m.said = at;
  }

  function mapJog(delta) {
    const m = mapNow();
    walkStep(m.walk, delta, m.places.length, now());
    CAT.navTop(nav).cursor = m.children[m.walk.target];
    dirty = true;
    ledDirty = true;
  }

  /* A place, from a pad or a pointer: walk there, or go in when the avatar
   * is already there or on its way. */
  function mapPick(i) {
    skipScene();
    if (!onMap()) return;
    const m = mapNow();
    if (i < 0 || i >= m.places.length) return;
    if (i === m.walk.target) {
      openRow();
      return;
    }
    walkTo(m.walk, i, now());
    CAT.navTop(nav).cursor = m.children[i];
    dirty = true;
    ledDirty = true;
  }

  /* A pad on the map: its place, or nothing on water. True when the map
   * took it, so the host sounds nothing. */
  function mapPad(note) {
    if (!onMap()) return false;
    mapPick(placeOfPad(mapNow().layout, note));
    return true;
  }

  /* While the avatar walks, every frame is a new picture; on arrival, the
   * place's name and how far it is, said once. A map's first-visit tip. */
  function serviceMap(t) {
    if (!onMap()) return;
    const m = mapNow();
    if (!arrived(m.walk, t)) {
      dirty = true;
      ledDirty = true;
    } else if (m.said !== m.walk.target) {
      m.said = m.walk.target;
      const p = m.places[m.said];
      announce(p.label + ', ' + p.percent + ' percent' + (p.due ? ', ' + p.due + ' due' : '') + '.');
    }
    showTip(CAT.navTop(nav).node.phase ? TIPS.ISLAND : TIPS.MAP);
  }

  /* The sheet's Show as list / Show as map, for this folder, this session. */
  function showFolderAs(as) {
    const top = CAT.navTop(nav);
    if (as === 'list') {
      listViews.add(top.node);
      announce('List.');
    } else {
      listViews.delete(top.node);
      map = null;
      homeGrow = null;
      announce(top.node.view !== 'home' ? 'Map.' : nav.length === 1 ? 'Home.' : top.node.label + '.');
    }
    dirty = true;
    ledDirty = true;
  }

  /* What a renderer draws of the map now: places, layout, the avatar's walk
   * and the title bar. Null when the screen is not a map. */
  function mapModel() {
    if (!onMap()) return null;
    const m = mapNow();
    const pos = posAt(m.walk, now());
    return { places: m.places, layout: m.layout, walk: m.walk, at: m.walk.target, place: m.places[pos.at] };
  }

  /* ---- Scenes: the Learning Path in motion ------------------------------------ */
  /*
   * A short queue of scenes (pathmap/scenes.mjs) on their own screen, ANIM: a flag
   * when a place is done, the walk to the next place, a zoom between the
   * world and an island, fireworks for a stage, the finale for the whole
   * path, a star round a level learned. Each is said as it starts. Any key
   * or pad skips the rest and goes straight on; nothing is played, scored or
   * recorded meanwhile, and the screen redraws every frame.
   */
  let player = SC.createPlayer();
  /* What the last take finished (storyOf), for its result's Next. */
  let takeStory = null;

  /* Nothing is sounding when a scene starts (a result, or the map), so it
   * sends no silence of its own: no MIDI goes out for a picture. */
  function playScenes(scenes, then) {
    const first = SC.startScenes(player, scenes, () => {
      dirty = true;
      ledDirty = true;
      then();
      /* Whatever `then` did, the scene screen is not left standing. */
      if (view === ANIM_VIEW && !SC.playing(player)) view = MENU;
    }, now());
    if (first) {
      view = ANIM_VIEW;
      if (first.say) announce(first.say);
    }
    dirty = true;
    ledDirty = true;
  }

  function serviceScenes(t) {
    const was = player.current;
    const cur = SC.stepScenes(player, t);
    if (cur && cur !== was && cur.say) announce(cur.say);
    dirty = true;
    ledDirty = true;
  }

  /* Any key: true when it skipped a scene, so the key does nothing else. */
  function skipScene() {
    if (view !== ANIM_VIEW) return false;
    if (!SC.skipScenes(player)) view = MENU;
    dirty = true;
    ledDirty = true;
    return true;
  }

  function toMenu() {
    view = MENU;
  }

  /* A map of the Learning Path as it stands: the world (no phase) or an
   * island, its places, what each opens, and its layout. */
  function pathMap(phase) {
    const due = MP.dueIdsOf(progress, wallNow());
    const built = phase ? MP.unitPlaces(progress, phases, phase, due) : MP.stagePlaces(progress, phases, due);
    return { world: !phase, phase: phase || null, places: built.places, targets: built.targets,
      layout: layoutPlaces(built.places.length, { kind: phase ? 'island' : 'world' }) };
  }

  const placeOfPhase = (world, phase) => Math.max(0, world.targets.findIndex((t) => t.phase === phase));
  const placeOfUnit = (island, unit) => island.targets.findIndex((t) => t.unit === unit);
  const fortOf = (island) => island.targets.findIndex((t) => t.check);

  /* Between the world and an island, both drawn as maps: a zoom. */
  function zoomsBetween(world, island) {
    return Boolean(world && island && island.phase && !world.phase && isMapNode(world) && isMapNode(island));
  }

  /*
   * The Learning Path's places as they stand, around the item about to be
   * recorded: the stages, the places of its stage, and whether it is
   * learned. Null for an item off the path, which only a level learned can
   * celebrate.
   */
  function pathSnapshot(id) {
    const it = PROG.item(progress, id);
    const learned = PROG.isFinished(it);
    if (!id || !phases.length || !PLAN.findStep(phases, id)) return { phase: null, learned };
    const unit = PLAN.unitOf(phases, id);
    const phase = checkPhase || (armedUnit && armedUnit.phase) || (unit && unit.phase) || null;
    const stageStates = MP.stagePlaces(progress, phases).places.map((p) => p.state);
    const island = phase ? MP.unitPlaces(progress, phases, phase).places : [];
    /* In the engine's terms (pathmap/scenes.mjs changes): each stage, done
     * or not, and the done places of the take's own stage. */
    const stages = {};
    phases.forEach((ph, i) => {
      stages[ph.key] = { done: stageStates[i] === 'done',
        places: ph === phase ? island.filter((p) => p.state === 'done').map((p) => p.id) : [] };
    });
    const settled = (st) => st === 'done' || st === 'skipped';
    return {
      phase,
      learned,
      path: { stages, all: stageStates.every(settled) },
      /* The places as they were, for a flag to rise from. */
      was: island.map((p) => p.state),
    };
  }

  /*
   * What a take changed: a place newly done, a stage newly done (its last
   * place, or its checkpoint passed), the whole path newly done (every stage
   * done or assumed), an item newly learned.
   */
  function storyOf(before, id) {
    const after = pathSnapshot(id);
    const story = { phase: before.phase, place: -1, stageDone: null, pathDone: false,
      learned: !before.learned && after.learned, was: before.was || [] };
    if (!before.phase || after.phase !== before.phase) return story;
    const change = SC.changes(before.path, after.path);
    const island = MP.unitPlaces(progress, phases, before.phase);
    story.place = island.places.findIndex((p) => change.places.includes(p.id));
    /* The fort among them: the checkpoint passed. */
    const fort = island.targets.findIndex((tg) => tg.check);
    story.checkpoint = fort >= 0 && change.places.includes(island.places[fort].id);
    story.stageDone = phases.find((ph) => change.stages.includes(ph.key)) || null;
    story.pathDone = change.all;
    return story;
  }

  const walkScene = (map, from, to, say) => ({ kind: SC.WALK, map, from, to, say });

  /*
   * The scenes between a take that finished something and the next step:
   *   a place done, next in another place     flag, walk there
   *   a stage done (or a place, next on       flag with fireworks (and for a
   *     another island)                       stage its banner), zoom out,
   *                                           sail, zoom in, walk to the place
   *   the whole path done                     ... zoom out, its banner, finale (then the
   *                                           world map, not the next step)
   * Next in the same place, or nothing done: none.
   */
  function storyScenes(story, next) {
    if (!story.phase || (story.place < 0 && !story.stageDone && !story.pathDone)) return [];
    const from = story.phase;
    const island = pathMap(from);
    const nextUnit = next ? next.unit : null;
    const nextPhase = nextUnit ? nextUnit.phase : null;
    const stage = story.stageDone === from;
    const doneAt = stage && fortOf(island) >= 0 ? fortOf(island) : Math.max(0, story.place);
    if (!stage && !story.pathDone && nextPhase === from && placeOfUnit(island, nextUnit) === doneAt) return [];
    const scenes = [{
      kind: SC.CELEBRATE, map: island, at: doneAt, big: stage, was: story.was[doneAt] || 'started',
      say: stage ? 'Stage ' + from.n + ' complete.' : 'Unit done.',
    }];
    if (stage) {
      scenes.push(story.checkpoint
        ? { kind: SC.BANNER, map: island, at: doneAt, text: 'CHECKPOINT PASSED', say: 'Checkpoint passed.' }
        : { kind: SC.BANNER, map: island, at: doneAt, text: 'STAGE COMPLETE' });
    }
    if (nextPhase === from && !story.pathDone) {
      const to = placeOfUnit(island, nextUnit);
      if (to >= 0 && to !== doneAt) scenes.push(walkScene(island, doneAt, to, 'Walking to ' + island.places[to].label + '.'));
      return scenes;
    }
    if (!nextPhase && !story.pathDone) return scenes;
    const world = pathMap(null);
    const fromAt = placeOfPhase(world, from);
    scenes.push({ kind: SC.ZOOM, dir: 'out', map: world, island, at: fromAt, say: 'World map.' });
    if (story.pathDone) {
      scenes.push({ kind: SC.BANNER, map: world, at: fromAt, text: 'LEARNING PATH COMPLETE',
        say: 'Learning Path complete.' });
      scenes.push({ kind: SC.FINALE, map: world, at: fromAt });
      return scenes;
    }
    const toAt = placeOfPhase(world, nextPhase);
    if (toAt !== fromAt) scenes.push(walkScene(world, fromAt, toAt, 'Sailing to ' + world.places[toAt].label + '.'));
    const there = pathMap(nextPhase);
    scenes.push({ kind: SC.ZOOM, dir: 'in', map: world, island: there, at: toAt, landAt: 0,
      say: world.places[toAt].label + '.' });
    const target = placeOfUnit(there, nextUnit);
    if (target > 0) scenes.push(walkScene(there, 0, target, 'Walking to ' + there.places[target].label + '.'));
    return scenes;
  }

  /* A level learned on this take: a star round the score, once, over the
   * result. */
  function learnedScene() {
    if (!takeStory || !takeStory.learned) return;
    playScenes([{ kind: SC.STAR, over: 'result', say: 'Level learned.' }], () => { view = RESULT_VIEW; });
  }

  /* The scene playing, as data: its kind and how far it is, and the map it
   * plays on in the engine's terms, for a page that draws its own. */
  function sceneModel(t = now()) {
    const sc = player.current;
    if (view !== ANIM_VIEW || !sc) return null;
    const on = sc.kind === SC.ZOOM && sc.dir === 'in' ? sc.island : sc.map;
    return {
      kind: sc.kind,
      dir: sc.dir || null,
      say: sc.say,
      progress: SC.sceneProgress(sc, t),
      fireworks: Boolean(sc.big),
      over: sc.over || null,
      from: sc.kind === SC.WALK ? sc.from : null,
      to: sc.kind === SC.WALK ? sc.to : null,
      at: sc.kind === SC.WALK ? sc.to : sc.kind === SC.ZOOM && sc.dir === 'in' ? sc.landAt || 0 : sc.at ?? null,
      world: on ? on.world : null,
      zoomAt: sc.kind === SC.ZOOM ? sc.at : null,
      places: on ? on.places : null,
      /* What a page needs to draw it as the panel does. */
      ms: SC.runMs(sc),
      was: sc.was || null,
      text: sc.text || null,
      zoomFrom: sc.kind === SC.ZOOM ? { count: sc.map.places.length, place: sc.map.places[sc.at] } : null,
    };
  }

  /* Back has somewhere to go, except at the top of the list, where it leaves. */
  function canGoBack() {
    return !(view === MENU && nav.length <= 1 && !listViews.has(CAT.navTop(nav).node));
  }

  /* ---- Input ------------------------------------------------------------ */
  /*
   * An answer given on its own pad (the Hear drills' answer bar). Nothing
   * sounds: a press there is a choice, not a note. Returns the result, or null.
   */
  function answer(at) {
    /* Only an open multiple-choice question takes an answer; a page or a
     * remote may send one at any moment. */
    if (view !== GUESS_VIEW || !quiz || !quiz.pick) return null;
    const res = at >= 0 ? GUESS.chooseAnswer(quiz, at, now()) : null;
    if (res) answered(res);
    return res;
  }

  /*
   * A note played, from a pad, a key or a keyboard. It always sounds; what it
   * MEANS depends on the screen, and the outcome says so, so the host can show
   * it — on the Move, which pads flash:
   *
   *   { kind: 'quiz', res }          a quiz answered by playing: CORRECT/WRONG/INCOMPLETE
   *   { kind: 'judged', result }     a run in practice: 'hit' | 'late' | 'stray' | ...
   *   null                           it only sounded
   */
  function play(pitch, vel) {
    /* A pad skips a scene, and sounds nothing. */
    if (skipScene()) return null;
    ledDirty = true;
    noteOn(pitch, vel);

    if (view === GUESS_VIEW && quizPick) {
      /* Above the bar the pads are the question; pressing one just sounds it. */
      return null;
    }
    if (view === GUESS_VIEW) {
      const res = GUESS.pressPitch(quiz, pitch, now());
      playCue(res);
      if (res === GUESS.CORRECT) quizSolvedAt = now();
      dirty = true;
      return { kind: 'quiz', res };
    }
    if (view !== RUNNING || listening) return null;
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
    dirty = true;
    return { kind: 'judged', result: j.result };
  }

  function release(pitch) {
    ledDirty = true;
    if (view === GUESS_VIEW && quiz) GUESS.releasePitch(quiz, pitch);
    noteOff(pitch);
  }

  /* The jog, or the arrow keys: what "next" means depends on the screen. An Info
   * page scrolls in its renderer, so it is not handled here. */
  function moveSelection(delta) {
    if (skipScene()) return;
    if (onHome()) {
      homeJog(delta);
      return;
    }
    if (onMap()) {
      mapJog(delta);
      return;
    }
    /* A round's result: the jog turns its pages — the round, right %, answers. */
    if (view === RESULT_VIEW && lastResult && lastResult.kind === 'quiz') {
      const pages = L.resultPageCount(lastResult.answers);
      lastResult.page = ((lastResult.page + (delta > 0 ? 1 : -1)) % pages + pages) % pages;
      dirty = true;
      return;
    }
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
      if (settingsEditing) editRow(settingsCursor, delta);
      else settingsCursor = clamp(settingsCursor + delta, 0, settingsRows().length - 1);
      dirty = true;
      return;
    }
    if (view === SHEET_VIEW && sheet) {
      sheet.cursor = clamp(sheet.cursor + (delta > 0 ? 1 : -1), 0, sheet.items.length - 1);
      dirty = true;
      return;
    }
    if (view === CARD_VIEW && card) {
      cardPage(delta);
      return;
    }
    /* A nudge mid-exercise used to drop straight back to the menu and abandon the
     * run. jogAction ignores it everywhere but the lists. */
    const top = CAT.navTop(nav);
    const next = CTRL.jogAction(view, delta, top.cursor, top.node.children.length);
    /* On the ready screen the jog walks the level and Guided or Solo —
     * never the exercise. */
    if (next.action === 'ready' && armedId) {
      readyJog(next.delta);
      return;
    }
    if (next.action !== 'cursor') return;
    top.cursor = next.index;
    dirty = true;
  }
  /* The answer cue, on the module's own piano: see cues.mjs. */
  function playCue(res) {
    if (!settings.quizSounds) return;
    const events = res === GUESS.CORRECT ? CUES.successCue(settings.rootPc)
      : res === GUESS.WRONG ? CUES.failureCue(settings.rootPc) : null;
    if (!events) return;
    const t = now();
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      guessOn.push({ pitch: e.pitch, atMs: t + e.at, offMs: t + e.at + e.dur, vel: e.vel });
    }
  }

  /* An answer was given, by the jog or by its pad. */
  function answered(res) {
    playCue(res);
    if (res === GUESS.CORRECT) {
      quizSolvedAt = now();
      /* Heard, named, now shown: where it sits on the grid. Read and named:
       * now heard, so the picture gets its sound. */
      if (quiz.kind === GUESS.EAR) fx.reveal(quiz.prompt, EAR_ADVANCE_MS);
      if (readingCourse()) hearPrompt();
    }
    dirty = true;
    ledDirty = true;
  }
  /* The jog's click, or Enter: open, choose, confirm. Shift is the "move on"
   * modifier on a result, the row's options in the list, and settings from a
   * piece. */
  function activate(shiftHeld) {
    if (skipScene()) return;
    if (view === INFO_VIEW) {
      closeInfo();
      return;
    }
    if (view === CARD_VIEW && card) {
      cardOn();
      return;
    }
    if (view === SHEET_VIEW) {
      runSheet(sheet ? sheet.cursor : -1);
      return;
    }
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
    switch (CTRL.jogClickAction(view, shiftHeld)) {
      case 'next':
        goNext();
        break;
      case 'skip':
        skipFromResult();
        break;
      case 'sheet':
        openSheet();
        return;
      case 'settings':
        openSettings(SET.MAIN_GROUP.key, 'piece');
        return;
      case 'close-settings':
        closeAllSettings();
        return;
      case 'toggle-edit':
        clickRow(settingsCursor);
        return;
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
   * Play listens, Record practises: at an instrument "play" means play it to
   * me, and "record" means capture what I do. Pressing the running mode's own
   * button stops it; pressing the other switches, so no press is ever a no-op.
   * Play and Record start things; on an Info page nothing is to be started.
   */
  function playButton() {
    if (skipScene()) return;
    if (view === INFO_VIEW || view === CARD_VIEW || view === SHEET_VIEW) return;
    /* Home offers nothing to play. */
    if (onHome()) return;
    /* On the map Play is Continue: the one button. */
    if (onMap()) {
      checkPhase = null;
      openContinue();
      return;
    }
    if (view === RESULT_VIEW) {
      if (lastResult.kind === 'quiz') startQuiz(quizSpec);
      else startRun(true);
      return;
    }
    if (view === GUESS_VIEW) {
      /* Hearing what you are reading answers it, so the first listen is a
       * hint and is counted as one; once taken, PLAY repeats it freely. */
      if (readingCourse() && !quiz.solved && quiz.hint === 0) takeHint();
      else hearPrompt();
      return;
    }
    if (view === RUNNING && listening) togglePause();
    else if (chart) startRun(true);
    else openRow();
    return;
  }

  function recordButton() {
    if (skipScene()) return;
    if (view === INFO_VIEW || view === CARD_VIEW || view === SHEET_VIEW) return;
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

  /* Menu is help, on every screen: what the thing in front of you is, its
   * words, and its keys. Press it again to go back. */
  function menuButton() {
    if (skipScene()) return;
    if (view === INFO_VIEW) {
      closeInfo();
      return;
    }
    openInfo(infoTarget());
  }

  /*
   * Back steps up one level, which from a running exercise is three presses to
   * get out. At the top of the list it leaves.
   */
  function back() {
    if (skipScene()) return;
    if (view === INFO_VIEW) {
      closeInfo();
      return;
    }
    if (view === CARD_VIEW) {
      closeCard();
      return;
    }
    if (view === SHEET_VIEW) {
      closeSheet();
      return;
    }
    if (view === SETTINGS) {
      if (settingsEditing) {
        settingsEditing = false;
        dirty = true;
        return;
      }
      closeSettings();
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
    /* A map folder (or home) shown as its list goes back to the picture first. */
    if (view === MENU && listViews.has(CAT.navTop(nav).node)) {
      showFolderAs('map');
      return;
    }
    /* Advanced's list goes back to the page it was opened from. */
    if (inAdvanced()) {
      leaveAdvanced();
      return;
    }
    /* Up one folder. The top of the tree is the only list Back leaves from. */
    const leaving = view === MENU && nav.length > 1 ? CAT.navTop(nav).node : null;
    if (view === MENU && CAT.navPop(nav)) {
      dirty = true;
      ledDirty = true;
      /* From an island back to the world: it shrinks into its place. */
      if (zoomsBetween(CAT.navTop(nav).node, leaving)) {
        const world = pathMap(null);
        playScenes([{ kind: SC.ZOOM, dir: 'out', map: world, island: pathMap(leaving.phase),
          at: placeOfPhase(world, leaving.phase), say: 'World map.' }], toMenu);
      }
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
    fx.exit();
  }

  /* ---- Lifecycle ---------------------------------------------------------- */
  function init() {
    view = MENU;
    chart = null;
    run = null;
    songBeats = 0;
    prevBeats = 0;
    listening = false;
    nav = [];
    armedId = null;
    armedPiece = null;
    armedLevel = 0;
    armedUnit = null;
    checkPhase = null;
    reviewNext = true;
    sheet = null;
    card = null;
    settingsGroup = null;
    settingsOver = 'menu';
    settingsBack = null;
    awayAt = 0;
    listViews.clear();
    map = null;
    homeGrow = null;
    player = SC.createPlayer();
    takeStory = null;
    stage = 1;
    runFromTop = false;
    settingsCursor = 0;
    settingsEditing = false;
    quiz = null;
    quizHear = false;
    quizPick = false;
    quizSpec = null;
    info = null;
    lastResult = null;
    progressRows = [];
    progressCursor = 0;
    repCache = { rev: -1, day: -1, rows: [] };
    quizSolvedAt = 0;
    guessOff.length = 0;
    guessOn.length = 0;
    lastClickBeat = null;
    settingsDirty = false;
    lastSaveMs = 0;
    for (const k in pitchRefcount) delete pitchRefcount[k];

    loadSettings();
    loadStats();
    loadProgress();
    loadFileExercises();
    buildTracks();
    PROG.resetShape(agg);
    rebuildMenu();
    welcomeAtStart();
    ledDirty = true;
    dirty = true;
  }

  /*
   * One frame of the session at time t: the run's clock, scoring, the click and
   * the reference line, and the quiz's scheduled notes.
   */
  function tick(t) {
    if (view === ANIM_VIEW) serviceScenes(t);
    if (view === MENU) serviceMap(t);
    /* While a circle grows every frame is a new picture. */
    if (homeGrow && onHome() && growing(homeGrow, t)) {
      dirty = true;
      ledDirty = true;
    }
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
      SCORE.pruneMarkers(run, keepMarkersBeats === null
          ? xToBeat(L.DESPAWN_X, songBeats, settings.pxPerBeat)
          : songBeats - keepMarkersBeats);
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
    if (view === GUESS_VIEW) serviceGuess();
    if (blocked) dirty = true;   /* keep the callout and the pulse alive */
  }

  /* Silence before leaving: the host drains the MIDI ring, then goes. */
  function halt() {
    allNotesOff();
    listening = false;
  }

  function scrubAllowed() {
    return view === READY || (view === RUNNING && paused);
  }

  /*
   * Point straight at a row, for a renderer with a pointer: a click lands on
   * the row it hit rather than stepping there one jog click at a time.
   */
  function selectRow(index) {
    skipScene();
    if (view !== MENU) return;
    const top = CAT.navTop(nav);
    if (index < 0 || index >= top.node.children.length) return;
    /* On a map the avatar goes to the place that row is, if it is one. */
    const m = onMap() ? mapNow() : null;
    const at = m ? m.children.indexOf(index) : -1;
    if (at >= 0 && at !== m.walk.target) walkTo(m.walk, at, now());
    top.cursor = index;
    dirty = true;
  }

  function selectProgress(index) {
    if (view !== PROGRESS_VIEW && view !== PROGRESS_DETAIL) return;
    if (index < 0 || index >= progressRows.length) return;
    progressCursor = index;
    dirty = true;
  }

  /* Moves the cursor only; whoever moved it decides whether that alone is
   * worth a redraw (a knob's edit redraws anyway, a touch does not). */
  function selectSetting(index) {
    const at = settingsRows().findIndex((r) => r.index === index);
    if (at >= 0) settingsCursor = at;
  }

  /* The same by the row's place on the page, for a row that is not a setting. */
  function selectSettingRow(row) {
    if (row >= 0 && row < settingsRows().length) settingsCursor = row;
  }

  /* Pointing at an option of the sheet, or at the welcome's answer. */
  function pickSheet(index) {
    if (view !== SHEET_VIEW || !sheet || index < 0 || index >= sheet.items.length) return;
    sheet.cursor = index;
    runSheet(index);
  }

  function pickCard(index) {
    if (view !== CARD_VIEW || !card) return;
    const p = card.pages[card.page];
    if (!p.choices || index < 0 || index >= p.choices.length) return;
    card.choice = index;
    cardOn(index);
  }

  return {
    init,
    tick,
    flushSettings,
    play,
    release,
    answer,
    answerBarActive,
    moveSelection,
    activate,
    playButton,
    recordButton,
    menuButton,
    back,
    halt,
    silence: allNotesOff,
    scrubBy,
    scrubAllowed,
    tempoKnob,
    editSetting,
    selectSetting,
    selectSettingRow,
    editRow,
    selectRow,
    openSheet,
    pickSheet,
    pickCard,
    /* The Settings page over the list, as the web page's top bar opens it. */
    openSettingsPage: () => openSettings(SET.MAIN_GROUP.key, 'menu'),
    hint,
    onMap,
    onHome,
    skipScenes: skipScene,
    sceneModel,
    homeModel,
    homePad,
    homePick,
    mapPad,
    mapPick,
    mapModel,
    canGoBack,
    screenNow,
    listTitle,
    levelInfo,
    armLevel,
    selectProgress,
    settingsRows,
    decorateRow,
    progressDetail,
    keyFifths,
    quizGlide,
    namesShown,
    stuckNamed,
    collectTarget,
    collectStuck,
    collectSounding,
    collectPlaying,
    playingBuf,
    collectPrompt,
    targetBuf,
    stuckBuf,
    soundingBuf,
    promptBuf,
    get view() { return view; },
    get scene() { return player.current; },
    get chart() { return chart; },
    get run() { return run; },
    get songBeats() { return songBeats; },
    get blocked() { return blocked; },
    get paused() { return paused; },
    get listening() { return listening; },
    get beatFlash() { return beatFlash; },
    get stage() { return stage; },
    get armedId() { return armedId; },
    get settings() { return settings; },
    get nav() { return nav; },
    get catalog() { return catalog; },
    get progress() { return progress; },
    get agg() { return agg; },
    get phases() { return phases; },
    get quiz() { return quiz; },
    get quizPick() { return quizPick; },
    get quizHear() { return quizHear; },
    get info() { return info; },
    get sheet() { return sheet; },
    get card() { return card; },
    get settingsGroup() { return settingsGroup; },
    get lastResult() { return lastResult; },
    get progressRows() { return progressRows; },
    get progressCursor() { return progressCursor; },
    get settingsCursor() { return settingsCursor; },
    get settingsEditing() { return settingsEditing; },
    get dirty() { return dirty; },
    set dirty(v) { dirty = v; },
    get ledDirty() { return ledDirty; },
    set ledDirty(v) { ledDirty = v; },
  };

}
