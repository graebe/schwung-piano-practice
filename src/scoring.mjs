/*
 * scoring.mjs — hit windows and run state. Pure: the caller supplies the time.
 *
 * Windows are specified in milliseconds (that is how playing feels) and
 * converted to beats once, at run creation, because everything else in the
 * module thinks in beats.
 *
 * Chords are judged per note. Hit two of the three and the two you got go fat
 * while the one you missed turns into an X in the same stack — which is far
 * more useful feedback than a single pass/fail on the chord.
 */

import { msToBeats } from './chart.mjs';

export const DEFAULT_WINDOWS = {
  perfectMs: 60,
  goodMs: 120,
  lateMs: 180,       /* past this, the note is gone */
  chordSpreadMs: 80, /* how far apart a chord's notes may land */
};

export const PENDING = 'pending';
export const HIT = 'hit';
export const MISSED = 'missed';

/*
 * A note carries two independent facts, and conflating them is the trap here.
 *
 *   state   the scoring outcome: pending -> hit | missed
 *   played  whether the key ever went down
 *
 * They have to be separate because a note that ran past its window is scored a
 * miss AND the scroll still has to wait for it (wait mode). If waiting keyed
 * off `state`, marking the miss would advance the cursor and there would be
 * nothing left to wait for; if scoring keyed off `played`, a note you
 * eventually fumbled out would count as a clean hit.
 */

export function createRun(chart, opts = {}) {
  const windows = { ...DEFAULT_WINDOWS, ...(opts.windows || {}) };
  const bpm = opts.bpm || chart.bpm || 90;
  let totalNotes = 0;
  const entries = chart.events.map((event) => {
    totalNotes += event.pitches.length;
    return {
      beat: event.beat,
      event,
      state: PENDING,
      notes: event.pitches
        .slice()
        .sort((a, b) => a - b)
        .map((pitch) => ({ pitch, state: PENDING, played: false, offsetBeats: 0 })),
    };
  });
  return {
    chart,
    bpm,
    anyOctave: Boolean(opts.anyOctave),
    windows,
    good: msToBeats(windows.goodMs, bpm),
    perfect: msToBeats(windows.perfectMs, bpm),
    late: msToBeats(windows.lateMs, bpm),
    entries,
    cursor: 0,      /* first entry with a note still unscored */
    waitCursor: 0,  /* first entry with a note still unplayed  */
    markers: [],    /* { beat, pitch } for every pad press, at the exact time */
    totalNotes,
    hits: 0,
    perfects: 0,
    misses: 0,
    strays: 0,
    combo: 0,
    bestCombo: 0,
    lastJudgement: null, /* { result, pitch, offsetBeats, at } */
  };
}

function pitchMatches(run, wanted, played) {
  if (wanted === played) return true;
  return run.anyOctave && ((wanted % 12) + 12) % 12 === ((played % 12) + 12) % 12;
}

/*
 * A pad went down. Finds the nearest unresolved entry holding a matching
 * pending note within the GOOD window and resolves that one note.
 * Returns { result: 'perfect'|'good'|'stray', entryIndex, noteIndex, offsetBeats }.
 */
export function judgeNoteOn(run, pitch, songBeats) {
  let bestEntry = -1;
  let bestNote = -1;
  let bestDist = Infinity;

  for (let i = run.cursor; i < run.entries.length; i++) {
    const entry = run.entries[i];
    const dist = entry.beat - songBeats;
    if (dist > run.good) break; /* everything further out is further out */
    if (Math.abs(dist) > run.good) continue;
    for (let n = 0; n < entry.notes.length; n++) {
      const note = entry.notes[n];
      if (note.state !== PENDING) continue;
      if (!pitchMatches(run, note.pitch, pitch)) continue;
      if (Math.abs(dist) < bestDist) {
        bestDist = Math.abs(dist);
        bestEntry = i;
        bestNote = n;
      }
    }
  }

  if (bestEntry < 0) {
    /* Nothing pending matches. Before calling it a stray, check whether this is
     * the note the scroll is frozen on — already scored a miss, but still
     * unplayed. Playing it releases the freeze and scores nothing: the miss
     * was recorded when its window closed and does not get taken back. */
    const released = releaseBlocked(run, pitch);
    if (released) {
      run.lastJudgement = { result: 'late', pitch, offsetBeats: songBeats - released.beat,
                            entryIndex: released.entryIndex, noteIndex: released.noteIndex };
      return run.lastJudgement;
    }
    run.strays++;
    run.lastJudgement = { result: 'stray', pitch, offsetBeats: 0 };
    return run.lastJudgement;
  }

  const entry = run.entries[bestEntry];
  const note = entry.notes[bestNote];
  const offsetBeats = songBeats - entry.beat;
  note.state = HIT;
  note.played = true;
  note.offsetBeats = offsetBeats;
  run.hits++;
  run.combo++;
  if (run.combo > run.bestCombo) run.bestCombo = run.combo;
  const perfect = Math.abs(offsetBeats) <= run.perfect;
  if (perfect) run.perfects++;
  settleEntry(entry);
  advanceCursor(run);
  advanceWaitCursor(run);
  run.lastJudgement = {
    result: perfect ? 'perfect' : 'good',
    pitch,
    offsetBeats,
    entryIndex: bestEntry,
    noteIndex: bestNote,
  };
  return run.lastJudgement;
}

/* Resolve everything whose late window has closed. Call once per frame. */
/*
 * Resolve everything whose late window has closed. Call once per frame.
 *
 * `waiting` is the wait-for-note setting. When it is off an expired note is
 * also marked played — it is gone for good — so that switching the setting on
 * later cannot find a backlog of ancient unplayed notes to freeze on.
 */
export function expireMissed(run, songBeats, waiting = false) {
  let expired = 0;
  for (let i = run.cursor; i < run.entries.length; i++) {
    const entry = run.entries[i];
    if (entry.beat + run.late >= songBeats) break;
    for (let n = 0; n < entry.notes.length; n++) {
      const note = entry.notes[n];
      if (note.state !== PENDING) continue;
      note.state = MISSED;
      if (!waiting) note.played = true;
      run.misses++;
      run.combo = 0;
      expired++;
    }
    settleEntry(entry);
  }
  advanceCursor(run);
  advanceWaitCursor(run);
  return expired;
}

/* The first entry still holding an unplayed note, or -1. */
function blockingEntry(run) {
  advanceWaitCursor(run);
  return run.waitCursor < run.entries.length ? run.waitCursor : -1;
}

/*
 * The beat the scroll must freeze at, or null when nothing is holding it up.
 * `graceBeats` is the tolerance: play within it and the clock never stops, so
 * a slightly late note does not break the rhythm.
 */
export function blockingBeat(run, graceBeats) {
  const i = blockingEntry(run);
  if (i < 0) return null;
  return run.entries[i].beat + effectiveGrace(run, graceBeats);
}

/*
 * The grace can never be shorter than the late window, or the clock would
 * freeze while the note is still PENDING — and since expireMissed is driven by
 * the clock, the note could never reach its late window and be marked missed,
 * so the only thing that releases the freeze could never happen. A deadlock,
 * and at 200bpm a 1/3-beat grace (100ms) really is shorter than the 180ms
 * window. Clamping means the note is always already scored by the time the
 * scroll stops for it.
 */
export function effectiveGrace(run, graceBeats) {
  return Math.max(graceBeats, run.late);
}

/*
 * The notes the scroll is currently stuck on: unplayed, on the blocking entry.
 *
 * One definition, used by both the pad that lights up and the name shown on
 * screen. If those two ever disagreed about which note you are stuck on, the
 * rescue would be worse than no rescue.
 */
export function blockingNotes(run) {
  const i = blockingEntry(run);
  if (i < 0) return [];
  const entry = run.entries[i];
  const out = [];
  for (let n = 0; n < entry.notes.length; n++) {
    if (!entry.notes[n].played) out.push(entry.notes[n]);
  }
  return out;
}

/* Mark the matching unplayed note on the blocking entry as played. */
function releaseBlocked(run, pitch) {
  const i = blockingEntry(run);
  if (i < 0) return null;
  const entry = run.entries[i];
  for (let n = 0; n < entry.notes.length; n++) {
    const note = entry.notes[n];
    if (note.played) continue;
    /* Only a note already scored a miss may be released this way. A PENDING
     * note outside the good window is an ordinary stray — releasing it would
     * silently swallow the note and rob it of its own judgement. */
    if (note.state !== MISSED) continue;
    if (!pitchMatches(run, note.pitch, pitch)) continue;
    note.played = true;
    advanceWaitCursor(run);
    return { beat: entry.beat, entryIndex: i, noteIndex: n };
  }
  return null;
}

/*
 * Bring the wait pointer up to the playhead, marking anything already behind it
 * as played. Called when wait mode is switched on mid-run: without it the
 * pointer would still be parked on a note from minutes ago and the clock would
 * be pinned to a beat in the past, i.e. jump backwards.
 */
export function resyncWait(run, songBeats) {
  for (let i = 0; i < run.entries.length; i++) {
    const entry = run.entries[i];
    if (entry.beat >= songBeats) break;
    for (let n = 0; n < entry.notes.length; n++) entry.notes[n].played = true;
  }
  advanceWaitCursor(run);
}

/* Record a pad press at the exact moment it happened, for the played markers. */
export function addMarker(run, pitch, songBeats, limit = 64) {
  run.markers.push({ beat: songBeats, pitch });
  if (run.markers.length > limit) run.markers.splice(0, run.markers.length - limit);
}

/* Drop markers that have scrolled off the left edge. */
export function pruneMarkers(run, beforeBeat) {
  let drop = 0;
  while (drop < run.markers.length && run.markers[drop].beat < beforeBeat) drop++;
  if (drop > 0) run.markers.splice(0, drop);
}

function settleEntry(entry) {
  let pending = 0;
  let missed = 0;
  for (let i = 0; i < entry.notes.length; i++) {
    if (entry.notes[i].state === PENDING) pending++;
    else if (entry.notes[i].state === MISSED) missed++;
  }
  if (pending > 0) entry.state = PENDING;
  else if (missed === entry.notes.length) entry.state = MISSED;
  else if (missed > 0) entry.state = 'partial';
  else entry.state = HIT;
}

function advanceCursor(run) {
  while (run.cursor < run.entries.length && run.entries[run.cursor].state !== PENDING) {
    run.cursor++;
  }
}

function entryFullyPlayed(entry) {
  for (let i = 0; i < entry.notes.length; i++) {
    if (!entry.notes[i].played) return false;
  }
  return true;
}

function advanceWaitCursor(run) {
  while (run.waitCursor < run.entries.length && entryFullyPlayed(run.entries[run.waitCursor])) {
    run.waitCursor++;
  }
}

export function runStats(run) {
  const judged = run.hits + run.misses;
  return {
    hits: run.hits,
    perfects: run.perfects,
    misses: run.misses,
    strays: run.strays,
    combo: run.combo,
    bestCombo: run.bestCombo,
    total: run.totalNotes,
    accuracy: judged === 0 ? 0 : run.hits / judged,
  };
}

/* The run is over once the chart has scrolled past and nothing is pending. */
/*
 * `blocked` is true while the scroll is frozen waiting for a note. Without it
 * the run would report finished mid-freeze: the clock is pinned at
 * beat + grace, which already exceeds beat + late, so the summary would pop up
 * over a note you are still being asked to play.
 */
export function runFinished(run, songBeats, blocked = false) {
  if (blocked) return false;
  if (run.cursor < run.entries.length) return false;
  const last = run.entries[run.entries.length - 1];
  return !last || songBeats > last.beat + run.late;
}
