// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * view_model.mjs — what a renderer needs to show a session, as plain data. Pure.
 *
 * The Move's panel reads the session directly: it lives in the same process
 * and draws 50 times a second from live objects. A browser cannot always do
 * that. In the browser's own practice mode the session runs beside the page;
 * on a Move it runs on the device and the page sees it only through
 * Schwung's parameter channel. So the page renders from THIS — a snapshot
 * that is the same object in both cases — and never from session internals.
 *
 *   viewModel(session, { plotW, plotH, t }) -> vm   everything on screen now
 *   clockOf(session, t)                  -> clock   the part that moves every frame
 *   encodeViewModel(vm) / decodeViewModel(flat)     for Schwung's `state` key
 *
 * Two rules keep it honest:
 *   - Plain JSON only: numbers, strings, booleans, arrays, plain objects. A
 *     test round-trips it.
 *   - A quiz's prompt is LEFT OUT while it is hidden. A renderer cannot leak
 *     what it was never sent.
 */

import * as SCORE from './scoring.mjs';
import * as CAT from './catalog.mjs';
import * as GUESS from './guess.mjs';
import * as GEN from './generator.mjs';
import * as NOTATION from './notation.mjs';
import * as AP from './answer_pads.mjs';
import { chartTotalBeats, beatsPerBar, barBeatOf, keyAt } from './chart.mjs';
import {
  MENU, READY, RUNNING, GUESS_VIEW, RESULT_VIEW, PROGRESS_VIEW, PROGRESS_DETAIL, SHEET_VIEW, CARD_VIEW,
} from './session.mjs';
import { groupByKey } from './settings_def.mjs';
import { iconRows } from './home/render.mjs';

export const VM_VERSION = 2;

/* One character per note judgement, so a long piece stays small. */
export const NOTE_PENDING = 'p';
export const NOTE_HIT = 'h';
export const NOTE_MISSED = 'm';

function noteCode(state) {
  if (state === SCORE.HIT) return NOTE_HIT;
  if (state === SCORE.MISSED) return NOTE_MISSED;
  return NOTE_PENDING;
}

/* ---- Pieces -------------------------------------------------------------- */

export function keyOf(settings, fifths) {
  const intervals = GEN.MODES[settings.mode] || GEN.MODES.major;
  const scale = new Array(12).fill(false);
  for (let i = 0; i < intervals.length; i++) scale[(settings.rootPc + intervals[i]) % 12] = true;
  return {
    rootPc: settings.rootPc,
    mode: settings.mode,
    modeLabel: GEN.MODE_LABELS[settings.mode] || settings.mode,
    /* The key to spell in — signature and the scale's own letters — and the
     * tonic's name as the scale spells it. */
    fifths,
    root: fifths && fifths.root ? fifths.root : null,
    transpose: settings.transpose,
    scale,
  };
}

/* The piece, as written. Changes only when something new is armed or rebuilt. */
export function chartOf(chart) {
  if (!chart) return null;
  return {
    id: chart.id || null,
    name: chart.name,
    source: chart.source || null,
    bpm: chart.bpm,
    timeSig: chart.timeSig || [4, 4],
    keySig: chart.keySig || 0,
    spelling: chart.spelling || null,
    keyChanges: chart.keyChanges ? chart.keyChanges.map((k) => ({ beat: k.beat, keySig: k.keySig })) : [],
    total: chartTotalBeats(chart),
    events: chart.events.map((e) => ({
      beat: e.beat,
      dur: e.durBeats || 1,
      pitches: e.pitches.slice(),
      hand: e.hand || 'r',
      symbol: e.symbol || null,
    })),
  };
}

/*
 * How the piece is going: per event, one code per note in pitch order (the
 * order scoring keeps them in), each hit's timing in beats, every press as a
 * marker, and the note the scroll is waiting on.
 */
export function runOf(run, blocked) {
  if (!run) return null;
  const notes = [];
  const offsets = [];
  for (let i = 0; i < run.entries.length; i++) {
    const entry = run.entries[i];
    let codes = '';
    const off = [];
    for (let n = 0; n < entry.notes.length; n++) {
      const note = entry.notes[n];
      codes += noteCode(note.state);
      off.push(note.state === SCORE.HIT ? Math.round(note.offsetBeats * 1000) / 1000 : 0);
    }
    notes.push(codes);
    offsets.push(off);
  }
  const stats = SCORE.runStats(run);
  return {
    notes,
    offsets,
    markers: run.markers.map((m) => [Math.round(m.beat * 1000) / 1000, m.pitch]),
    cursor: run.cursor,
    blockIndex: blocked ? SCORE.blockingEntryIndex(run) : -1,
    stats: {
      hits: stats.hits,
      misses: stats.misses,
      strays: stats.strays,
      total: stats.total,
      accuracy: Math.round(stats.accuracy * 1000) / 1000,
    },
  };
}

/*
 * The part of the picture that moves every frame: kept apart so a renderer
 * can follow it without rebuilding everything else.
 *
 * WHAT A RENDERER ELSEWHERE NEEDS TO RUN IT ON ITS OWN. A page on another
 * machine gets this some unknown time after it was taken, so the clock says
 * WHEN it was taken and how fast it runs, and where it will stop:
 *
 *   t          the session's time when `beats` was true (the `t` its tick
 *              was given: the Move's performance.now()), or null when the
 *              caller has none -- a renderer beside the session reads it live
 *   perBeatMs  one beat in ms: the session's own conversion (msToBeats)
 *   waitAt     the beat the scroll will freeze on, waiting for a note to be
 *              played (Wait for note, while practising), else null -- the
 *              session's own rule (applyWait, SCORE.blockingBeat), so a
 *              renderer never draws past where the Move stops
 */
export function clockOf(S, t = null) {
  const chart = S.chart;
  const where = chart && S.songBeats >= 0 ? barBeatOf(chart, S.songBeats) : null;
  const bpm = chart ? chart.bpm : S.settings.bpm;
  const waiting = S.view === RUNNING && S.settings.waitForNote && !S.listening && S.run;
  return {
    t: Number.isFinite(t) ? t : null,
    perBeatMs: bpm > 0 ? 60000 / bpm : 0,
    waitAt: waiting ? SCORE.blockingBeat(S.run) : null,
    beats: S.songBeats,
    bpm,
    running: S.view === RUNNING,
    listening: S.listening,
    paused: S.paused,
    blocked: S.blocked,
    countIn: chart ? S.songBeats < 0 : false,
    bar: where ? where.bar : 0,
    beat: where ? where.beat : 0,
    perBar: chart ? beatsPerBar(chart) : 4,
    beatFlash: S.beatFlash,
  };
}

/* What the pads — or a keyboard — would light: the same decision the Move
 * makes, in pitches. `playing` is every note sounding now, on any screen --
 * a pad held in the list included -- for a keyboard that shows what is
 * played wherever you are (the click aside). */
export function cueOf(S) {
  const near = S.collectTarget();
  S.collectStuck();
  S.collectSounding();
  S.collectPrompt();
  S.collectPlaying();
  return {
    target: S.targetBuf.slice(),
    near: Boolean(near),
    stuck: S.stuckBuf.slice(),
    sounding: S.soundingBuf.slice(),
    prompt: S.promptBuf.slice(),
    playing: S.playingBuf.slice(),
  };
}

export function navOf(S) {
  if (!S.nav.length) return null;
  const top = CAT.navTop(S.nav);
  return {
    path: S.nav.map((n) => n.node.label),
    title: top.node.label,
    cursor: top.cursor,
    rows: top.node.children.map((row) => {
      const deco = S.decorateRow(row) || {};
      return {
        label: deco.label || row.label,
        value: deco.value !== undefined ? String(deco.value) : String(row.value || ''),
        mark: deco.mark || null,
        /* A settings group opens a page, not a folder, but reads as one. */
        folder: CAT.isFolder(row) || Boolean(row.settingsGroup),
      };
    }),
  };
}

/* The options sheet: the row's name and what can be done with it. */
function sheetOf(S) {
  const sheet = S.sheet;
  if (S.view !== SHEET_VIEW || !sheet) return null;
  return { title: sheet.title, cursor: sheet.cursor, items: sheet.items.map((it) => it.label) };
}

/*
 * The Path map on screen: its places, in the engine's own terms, and which
 * one the avatar is bound for. The page lays them out with the same engine
 * (layoutPlaces of their count) and walks its own avatar there.
 */
function mapOf(S) {
  const m = S.view === MENU ? S.mapModel() : null;
  if (!m) return null;
  return {
    world: !CAT.navTop(S.nav).node.phase,
    at: m.at,
    places: m.places.map((p) => ({
      id: p.id, label: p.label, short: p.short, percent: p.percent, state: p.state, due: p.due, kind: p.kind,
    })),
  };
}

/*
 * Home on screen: the five circles, their icons as the engine's rows ('#'
 * lit) at both sizes, and which one is selected. The page draws its own
 * circles and grows the selected one itself.
 */
function homeOf(S) {
  const h = S.view === MENU ? S.homeModel() : null;
  if (!h) return null;
  return {
    selected: h.selected,
    items: h.items.map((it) => ({
      key: it.key, label: it.label, small: iconRows(it.icon, false), large: iconRows(it.icon, true),
    })),
  };
}

/*
 * A scene playing (scenes.mjs): its kind, how far it is (0..1), and the map
 * it plays on in the engine's terms, so the page draws and paces its own.
 */
function animOf(S, t) {
  const a = S.sceneModel(t === null ? undefined : t);
  if (!a) return null;
  return {
    kind: a.kind, dir: a.dir, say: a.say, progress: Math.round(a.progress * 1000) / 1000,
    fireworks: a.fireworks, over: a.over, from: a.from, to: a.to, at: a.at, zoomAt: a.zoomAt, world: a.world,
    places: a.places ? a.places.map((p) => ({
      id: p.id, label: p.label, short: p.short, percent: p.percent, state: p.state, due: p.due, kind: p.kind,
    })) : null,
  };
}

/* The card on screen: its page, as paragraphs, or the question it asks. */
function cardOf(S) {
  const card = S.card;
  if (S.view !== CARD_VIEW || !card) return null;
  const page = card.pages[card.page];
  return {
    kind: card.kind,
    title: page.title,
    paragraphs: page.paragraphs.map((p) => p.text),
    lines: Boolean(page.lines),
    choices: page.choices ? page.choices.slice() : null,
    choice: card.choice,
    page: card.page,
    pages: card.pages.length,
  };
}

function staffOf(columns) {
  return columns.map((c, i) => ({
    beat: i + c.part,
    durBeats: 0,
    index: i,
    /* All on the treble, as on the Move: a 3rd split across middle C would be
     * read as two staves, not one interval. */
    hand: 'r',
    pitches: c.notes.map((n) => n.pitch),
    spelled: c.notes.map((n) => ({ step: n.diatonic, alteration: n.alter, letter: ((n.diatonic % 7) + 7) % 7 })),
  }));
}

/*
 * The open quiz. While the prompt is withheld — a hearing drill not yet
 * answered — neither the notes nor their name are sent.
 */
export function quizOf(S) {
  const quiz = S.quiz;
  if (!quiz) return null;
  const ear = quiz.kind === GUESS.EAR;
  const hidden = (S.quizHear || ear) && !quiz.solved;
  const st = GUESS.quizStats(quiz);
  return {
    kind: quiz.kind,
    mode: ear ? 'ear' : S.quizPick ? 'pick' : S.quizHear ? 'hear' : 'play',
    title: ear ? quiz.exercise.name : null,
    question: ear ? quiz.exercise.question || null : null,
    prompt: hidden ? null : quiz.prompt.slice(),
    label: hidden ? null : quiz.label || null,
    /* A Play drill's row, head first. `index` counts prompts from the start, so
     * a prompt keeps its place as the row moves on. A staff drill withholds the
     * name — reading it is the drill — until Help gives it. */
    read: quiz.read || null,
    /* A reading course draws its prompt: one event per column, spelled as the
     * course wrote it, a beat apart and a beat more between two intervals. */
    sheet: quiz.exercise && quiz.exercise.read && quiz.entry ? staffOf(quiz.entry.staff) : null,
    queue: quiz.read ? quiz.queue.map((e, i) => ({
      index: quiz.asked - 1 + i,
      pitches: e.pitches.slice(),
      name: quiz.read === GUESS.READ_NAME || (i === 0 && quiz.hint > 0) ? GUESS.entryName(quiz, e) : null,
    })) : [],
    fifths: NOTATION.keyFifths(quiz.fifths),
    spelling: quiz.fifths && quiz.fifths.map ? quiz.fifths.map : null,
    solved: quiz.solved,
    hint: quiz.hint,
    maxHint: GUESS.MAX_HINT,
    hintsLeft: GUESS.hintsLeft(quiz),
    options: quiz.choices.map((c, i) => ({
      label: GUESS.optionLabel(quiz, c),
      short: AP.shortLabel(c),
      colour: ear ? AP.answerColour(i).name : null,
      out: GUESS.isEliminated(quiz, i),
    })),
    choice: quiz.choiceIndex,
    correct: st.correct,
    wrong: st.wrong,
    asked: st.asked,
    streak: st.streak,
    roundSize: quiz.roundSize,
  };
}

function progressOf(S, plotW, plotH) {
  if (S.view !== PROGRESS_VIEW && S.view !== PROGRESS_DETAIL) return null;
  return {
    cursor: S.progressCursor,
    rows: S.progressRows.map((row) => {
      const deco = S.decorateRow(row) || {};
      return { label: row.label, value: deco.value !== undefined ? String(deco.value) : '' };
    }),
    detail: S.view === PROGRESS_DETAIL ? S.progressDetail(plotW, plotH) : null,
  };
}

/* The note or chord the scroll waits on, named in its key. */
function stuckNameOf(S) {
  const at = SCORE.blockingEntryIndex(S.run);
  const event = S.chart.events[at];
  const pitches = SCORE.blockingNotes(S.run).map((n) => n.pitch);
  if (!event || !pitches.length) return null;
  return event.symbol || NOTATION.chordLabel(pitches, keyAt(S.chart, event.beat));
}

/* ---- The whole picture -------------------------------------------------------- */

export function viewModel(S, { plotW = 240, plotH = 96, t = null } = {}) {
  const view = S.view;
  const settings = S.settings;
  const inSong = view === READY || view === RUNNING;
  const rows = S.settingsRows();
  return {
    v: VM_VERSION,
    screen: view,
    key: keyOf(settings, S.keyFifths()),
    nav: view === MENU ? navOf(S) : null,
    /* With the level box's facts: the piece's levels, which is armed, and
     * the bottom line's name for it (session levelInfo). */
    armed: S.armedId ? { id: S.armedId, stage: S.stage, level: inSong ? S.levelInfo() : null } : null,
    /* The names under the notes, as the stage and the Names setting have them;
     * a stuck note's name once it has waited long enough. */
    names: inSong ? S.namesShown() : true,
    stuckName: inSong && S.blocked && S.run && S.stuckNamed() ? stuckNameOf(S) : null,
    chart: inSong ? chartOf(S.chart) : null,
    run: inSong ? runOf(S.run, S.blocked) : null,
    clock: clockOf(S, t),
    cue: cueOf(S),
    quiz: view === GUESS_VIEW ? quizOf(S) : null,
    /* Also under a scene that plays over it (a level learned). */
    result: (view === RESULT_VIEW || (S.scene && S.scene.over === 'result')) && S.lastResult
      ? JSON.parse(JSON.stringify(S.lastResult)) : null,
    progress: progressOf(S, plotW, plotH),
    info: S.info ? { title: S.info.title, paragraphs: S.info.paragraphs.slice(), back: S.info.back } : null,
    sheet: sheetOf(S),
    card: cardOf(S),
    map: mapOf(S),
    home: homeOf(S),
    anim: animOf(S, t),
    /* The hint line, as the Move's footer has it: its parts, which take turns. */
    hint: S.hint(),
    settings: {
      group: S.settingsGroup,
      title: groupByKey(S.settingsGroup) ? groupByKey(S.settingsGroup).label : 'Settings',
      cursor: S.settingsCursor,
      editing: S.settingsEditing,
      /* `row` is the place on the page; `index` the setting, for a setting;
       * `act` an action a click runs; `edit` something else the jog changes. */
      rows: rows.map((r, i) => ({
        row: i, index: r.index !== undefined ? r.index : -1, label: r.label, value: r.value,
        act: r.act || null, edit: r.edit || null,
      })),
    },
    can: {
      listen: Boolean(S.chart) && inSong,
      practice: Boolean(S.chart) && inSong,
      scrub: S.scrubAllowed(),
    },
  };
}

/* ---- Schwung's state key ------------------------------------------------------ */
/*
 * Schwung hands a tool's web page `get_param("state")` as ONE FLAT object whose
 * values arrive as strings, at most 64KB in all. So each top-level field
 * travels as its own JSON string, and the page parses them back.
 */
export const STATE_LIMIT = 64 * 1024;

export function encodeViewModel(vm) {
  const flat = {};
  for (const key of Object.keys(vm)) flat[key] = JSON.stringify(vm[key]);
  return flat;
}

export function decodeViewModel(flat) {
  const vm = {};
  for (const key of Object.keys(flat)) {
    try {
      vm[key] = JSON.parse(flat[key]);
    } catch (e) {
      vm[key] = null;
    }
  }
  return vm;
}

export function encodedSize(vm) {
  return JSON.stringify(encodeViewModel(vm)).length;
}
