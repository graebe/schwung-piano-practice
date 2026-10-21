// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * session.mjs — Piano Practice itself, with no host in it. Pure.
 *
 * Everything the module DOES lives here: the lesson tree and the Learning
 * Program, arming, the transport and its two clocks, scoring, the quizzes and
 * the hearing drills, results, progress, Info, the settings and their file.
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

/* What the session keeps, by name; the host decides where. */
const SETTINGS_FILE = 'settings.json';
const STATS_FILE = 'stats.json';
const PROGRESS_FILE = 'progress.json';

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

  function loadStats() {
    stats = STATS.parseStats(readText(STATS_FILE));
  }

  /* One write per finished round — small, and rare enough not to need pacing. */
  function saveStats() {
    writeText(STATS_FILE, STATS.serialiseStats(stats));
  }

  function loadProgress() {
    progress = PROG.parseProgress(readText(PROGRESS_FILE));
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
  let tracks = [];             /* the Learning Program (program.mjs) */
  let progressRows = [];       /* the Progress list: overview, tracks, recent items */
  let progressCursor = 0;
  /* The Info page open: { title, lines, scroll, back }. `back` is the view
   * it came from, which Back and Menu return to exactly as it was. */
  let info = null;
  let infoEnv = { songs: {} };
  let infoOpenedAt = 0;
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

  let settingsCursor = 0;
  let settingsEditing = false;

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

  /* The program's song track is made from the files, so it follows them. */
  function buildTracks() {
    tracks = PLAN.buildProgram({ songs: fileSongs });
    infoEnv = { songs: {} };
    for (let i = 0; i < fileSongs.length; i++) infoEnv.songs[fileSongs[i].chart.id] = fileSongs[i].chart;
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
   * Play is read two ways: by its name (any octave counts) or off the staff
   * (the written pitches). Either way the next prompts queue up to the right.
   *
   * Play and Name follow the Half tones and Chords settings, and their ids do
   * too, so a chromatic round and an in-key round are filed apart.
   */
  const QUIZ_PLAY = [
    { label: 'Notes by alphabet', guess: GUESS.NOTES, read: GUESS.READ_NAME },
    { label: 'Notes by staff', guess: GUESS.NOTES, read: GUESS.READ_STAFF },
    { label: 'Chords by name', guess: GUESS.CHORDS, read: GUESS.READ_NAME },
    { label: 'Chords by staff', guess: GUESS.CHORDS, read: GUESS.READ_STAFF },
  ];
  const QUIZ_NAME = [
    { label: 'Notes', guess: GUESS.NOTES, pick: true },
    { label: 'Chords', guess: GUESS.CHORDS, pick: true },
  ];

  function settingsQuiz(row) {
    return {
      kind: row.guess, hear: Boolean(row.hear), pick: Boolean(row.pick), read: row.read || null,
      halfTones: settings.halfTones, chordSet: settings.chordSet, pinned: false,
    };
  }

  function quizId(spec) {
    return 'quiz:' + STATS.drillId(spec);
  }

  /* Rows here and in the Learning Program are the same steps by id, so a
   * level played in either is the same item in Progress. */
  /* Quiz › Hear and Quiz › Read, as the program lays them out. */
  const hearFolder = () => PLAN.hearMenu();
  const readFolder = () => PLAN.readMenu();

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
      readFolder(),
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

    const res = PROG.recordAttempt(progress, quizId(quizSpec), {
      stage: PROG.quizStage(quiz.hintsUsed),
      score: PROG.quizScore(quiz.correct, quiz.wrong),
      at: wallNow(),
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
      read: quizRead(spec),
      /* What this drill has asked before and how it went: the answers you
       * miss come round more often. */
      history: STATS.tallyFor(stats, STATS.drillId(spec)),
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
    return GEN.keyForScale(settings.rootPc, settings.mode);
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
    autoInfo({ id: armedId, label: chart.name });
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
    if (!PROG.moveOn(progress, id, wallNow())) PROG.skipItem(progress, id, wallNow());
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
      stage, score, at: wallNow(), bpm: chart.bpm,
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
      /* In time, early, late, and whether the run rushed or dragged. */
      timing: SCORE.timingSummary(run),
    };
    lastResult.footer = resultFooter();
    armRun();
    view = RESULT_VIEW;
    dirty = true;
    ledDirty = true;
    announce('Done. ' + Math.round(score * 100) + ' percent.' + passedWords(res.passed));
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
  /* ---- Info -------------------------------------------------------------------- */
  /*
   * Menu explains whatever is in front of you: the highlighted row of the list,
   * the armed exercise, the drill under way, a result. Opening it pauses what
   * is running — the scroll, the round's clock — so reading costs nothing.
   */
  function infoTarget() {
    if (view === MENU) {
      const row = CAT.navCurrent(nav) || CAT.navTop(nav).node;
      if (row.continueRow) return { kind: 'continue' };
      if (row.skipRow) return { kind: 'skip' };
      if (row.progress) return { kind: 'progress' };
      return { id: row.repId || row.id, label: row.label };
    }
    if (view === READY || view === RUNNING) return { id: armedId, label: chart ? chart.name : '' };
    if (view === GUESS_VIEW && quizSpec) return { id: quizId(quizSpec) };
    if (view === RESULT_VIEW) return { kind: 'result' };
    if (view === PROGRESS_VIEW || view === PROGRESS_DETAIL) return { kind: 'progress' };
    return null;
  }

  function openInfo(target) {
    const pageInfo = INFO.infoFor(target, infoEnv);
    if (!pageInfo) return false;
    if (view === RUNNING && !paused) togglePause();
    if (view === GUESS_VIEW) {
      /* Silence the prompt: it is played again on the way back. */
      stopPrompt();
      infoOpenedAt = now();
    }
    /* The words, not the lines: wrapping is the renderer's, and a 128px panel
     * and a browser window wrap the same paragraphs very differently. */
    info = {
      title: pageInfo.title,
      paragraphs: INFO.infoParagraphs(pageInfo),
      back: view,
    };
    if (!PROG.infoSeen(progress, pageInfo.key)) {
      PROG.markInfoSeen(progress, pageInfo.key, wallNow());
      saveProgress();
    }
    view = INFO_VIEW;
    dirty = true;
    ledDirty = true;
    announce(pageInfo.title + '. Info.');
    return true;
  }

  function closeInfo() {
    if (!info) return;
    view = info.back;
    if (view === GUESS_VIEW && quiz) {
      /* The time spent reading is not part of the round. */
      const away = now() - infoOpenedAt;
      if (quiz.startedAt !== null && quiz.finishedAt === null) quiz.startedAt += away;
      if (quizSolvedAt) quizSolvedAt += away;
      if ((quizHear || quiz.kind === GUESS.EAR) && !readingCourse() && !quiz.solved) hearPrompt();
    }
    info = null;
    dirty = true;
    ledDirty = true;
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
        : PLAN.trackSteps(row.track).map((st) => st.id);
      const sum = PROG.summariseIds(progress, ids);
      return {
        kind: 'overview',
        title: row.overview === 'all' ? 'Overall' : row.track.name,
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
   * modifier on a result, and settings from the list. */
  function activate(shiftHeld) {
    if (view === INFO_VIEW) {
      closeInfo();
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
   * Play listens, Record practises: at an instrument "play" means play it to
   * me, and "record" means capture what I do. Pressing the running mode's own
   * button stops it; pressing the other switches, so no press is ever a no-op.
   * Play and Record start things; on an Info page nothing is to be started.
   */
  function playButton() {
    if (view === INFO_VIEW) return;
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
    if (view === INFO_VIEW) return;
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

  /* Menu is Info: what the thing in front of you is, and its words. Press it
   * again to go back. From Settings it still leaves for the list. */
  function menuButton() {
    if (view === INFO_VIEW) {
      closeInfo();
      return;
    }
    if (view === SETTINGS) {
      view = MENU;
      settingsEditing = false;
      dirty = true;
      return;
    }
    openInfo(infoTarget());
    return;
  }

  /*
   * Back steps up one level, which from a running exercise is three presses to
   * get out. At the top of the list it leaves.
   */
  function back() {
    if (view === INFO_VIEW) {
      closeInfo();
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
    armedTrack = null;
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
    ledDirty = true;
    dirty = true;
  }

  /*
   * One frame of the session at time t: the run's clock, scoring, the click and
   * the reference line, and the quiz's scheduled notes.
   */
  function tick(t) {
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
    if (view !== MENU) return;
    const top = CAT.navTop(nav);
    if (index < 0 || index >= top.node.children.length) return;
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
  function selectSetting(row) {
    if (row < 0 || row >= SET.SETTINGS_COUNT) return;
    settingsCursor = row;
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
    editSetting,
    selectSetting,
    selectRow,
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
    get tracks() { return tracks; },
    get quiz() { return quiz; },
    get quizPick() { return quizPick; },
    get quizHear() { return quizHear; },
    get info() { return info; },
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
