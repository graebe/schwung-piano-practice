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
    /* Twice the good window. Playing ahead of the beat is the commonest way to
     * be wrong about a note you actually know, and 120ms was punishing it as a
     * stray. The late side is Grace and far wider; see the match loop for why
     * the two directions are not the same number. */
    early: 2 * msToBeats(windows.goodMs, bpm),
    /*
     * How late a note may be and still count. The Grace setting widens it:
     * that setting used to move the point the SCROLL stopped at, which is why
     * a missed note sailed a beat past the hit line before the display
     * halted. The scroll now stops on the note whatever Grace says, and Grace
     * decides only how forgiving the judgement is.
     *
     * Never narrower than lateMs, so turning Grace down cannot make the drill
     * stricter than the scoring windows it is graded against.
     */
    late: Math.max(msToBeats(windows.lateMs, bpm), opts.graceBeats || 0),
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

  /*
   * ASYMMETRIC, AND THAT IS THE POINT OF GRACE.
   *
   * Early is still the tight window: a press well before a note is a mistake,
   * and a wide early window would let it swallow the note AFTER the one you
   * meant. Late is the Grace setting, because "how long a late note still
   * counts" is exactly what Grace now means.
   *
   * It also closes a hole this created. The scroll freezes ON the note now,
   * so the note is PENDING while you hunt for it — and releaseBlocked only
   * releases a note already scored MISSED. With the match window at `good`,
   * a press between 120ms and Grace matched nothing, released nothing, and
   * scored a stray: the right pad, pressed, with the scroll sitting there
   * doing nothing until the note finally expired.
   */
  for (let i = run.cursor; i < run.entries.length; i++) {
    const entry = run.entries[i];
    const dist = entry.beat - songBeats;
    if (dist > run.early) break; /* everything further out is further out */
    if (dist > 0 ? dist > run.early : -dist > run.late) continue;
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
    /*
     * A NOTE THE SCROLL NEVER REACHED CANNOT BE MISSED.
     *
     * This clock is real time, and in wait mode it keeps running while the
     * display sits frozen on one note — so without this the windows of every
     * note BEHIND the freeze close too, and a single stall X-ed out the next
     * five notes before the scroll had shown any of them.
     */
    if (waiting && i > run.waitCursor) break;
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

/* Which entry the scroll is stuck on, or -1. Shared by the pads, the callout
 * and the notehead, so all three name the same note. */
export function blockingEntryIndex(run) {
  return blockingEntry(run);
}

/*
 * The beat the scroll must freeze at, or null when nothing is holding it up.
 *
 * The note's OWN beat: beatToX maps songBeats to HIT_X, so freezing here puts
 * the note exactly on the hit line. It used to be `beat + grace`, which is the
 * same constant that buys the timing tolerance — so widening the tolerance
 * also pushed the halt further past the line, and at a full beat of grace the
 * note visibly scrolled by before anything stopped.
 *
 * The judge is not frozen with it; see applyWait's scoreBeats.
 */
export function blockingBeat(run) {
  const i = blockingEntry(run);
  if (i < 0) return null;
  return run.entries[i].beat;
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
 * `blocked` is true while the scroll is frozen waiting for a note, and the run
 * cannot be over while one is still being asked for. The freeze now pins the
 * clock at the note's own beat rather than past it, so this no longer guards
 * against an early finish on the LAST note — but it still says the true thing,
 * and the true thing is the reason to keep it.
 */
export function runFinished(run, songBeats, blocked = false) {
  if (blocked) return false;
  if (run.cursor < run.entries.length) return false;
  const last = run.entries[run.entries.length - 1];
  return !last || songBeats > last.beat + run.late;
}
