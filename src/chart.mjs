/*
 * chart.mjs — the scroll engine. Pure: no host calls, no mutable module state.
 *
 * There is exactly one clock. Everything on screen is a function of
 *
 *     songBeats = elapsedMs / 1000 * bpm / 60
 *
 * so nothing has to be animated, nothing can drift apart, and a frame can be
 * rendered for any instant in the piece — which is what lets the whole reading
 * view be asserted on in `node --test`.
 *
 * Chart shape (produced by generator.mjs, or loaded by exercise_io.mjs):
 *   { id, name, bpm, timeSig: [num, den], keySig: fifths,
 *     events: [ { beat, durBeats, pitches: [midi, ...] } ] }
 *
 * A chart is already flattened: the `hand` tag lives on the SONG file and is
 * consumed by levels.mjs, so nothing downstream of here has to know about it.
 */

import * as L from './layout.mjs';

export function beatToX(beat, songBeats, pxPerBeat, hitX = L.HIT_X) {
  return hitX + (beat - songBeats) * pxPerBeat;
}

export function xToBeat(x, songBeats, pxPerBeat, hitX = L.HIT_X) {
  return songBeats + (x - hitX) / pxPerBeat;
}

export function msToBeats(ms, bpm) {
  return (ms / 1000) * (bpm / 60);
}

export function beatsToMs(beats, bpm) {
  return (beats / (bpm / 60)) * 1000;
}

/* Beats of the last event, plus its duration — how long the run lasts. */
export function chartTotalBeats(chart) {
  let end = 0;
  for (let i = 0; i < chart.events.length; i++) {
    const e = chart.events[i];
    const stop = e.beat + (e.durBeats || 1);
    if (stop > end) end = stop;
  }
  return end;
}

/* The beat window currently on screen, from the despawn edge to the right edge. */
function visibleRange(songBeats, pxPerBeat) {
  return {
    fromBeat: xToBeat(L.DESPAWN_X, songBeats, pxPerBeat),
    toBeat: xToBeat(L.SPAWN_X, songBeats, pxPerBeat),
  };
}

/*
 * Events on screen right now, left to right, each with its x.
 * Walks only the visible slice — the draw loop never touches the whole chart.
 */
export function visibleEvents(chart, songBeats, pxPerBeat) {
  const { fromBeat, toBeat } = visibleRange(songBeats, pxPerBeat);
  const out = [];
  const events = chart.events;
  for (let i = 0; i < events.length; i++) {
    const beat = events[i].beat;
    if (beat < fromBeat) continue;
    if (beat > toBeat) break; /* events are beat-ordered */
    out.push({ index: i, event: events[i], x: beatToX(beat, songBeats, pxPerBeat) });
  }
  return out;
}

/* Bar lines are derived from the time signature, never stored as events. */
export function visibleBars(chart, songBeats, pxPerBeat) {
  const perBar = beatsPerBar(chart);
  const total = chartTotalBeats(chart);
  const { fromBeat, toBeat } = visibleRange(songBeats, pxPerBeat);
  const first = Math.max(0, Math.ceil(fromBeat / perBar));
  const last = Math.floor(Math.min(toBeat, total) / perBar);
  const out = [];
  for (let b = first; b <= last; b++) {
    out.push({
      bar: b + 1,
      beat: b * perBar,
      x: beatToX(b * perBar, songBeats, pxPerBeat) + L.BAR_OFFSET_PX,
    });
  }
  return out;
}

export function beatsPerBar(chart) {
  const ts = chart.timeSig || [4, 4];
  return (ts[0] * 4) / ts[1];
}

/* 1-based bar and beat at the playhead, for the header readout. */
export function barBeatOf(chart, songBeats) {
  const perBar = beatsPerBar(chart);
  const clamped = Math.max(0, songBeats);
  return {
    bar: Math.floor(clamped / perBar) + 1,
    beat: Math.floor(clamped % perBar) + 1,
  };
}

/* How wide a name-lane label may be before it would collide with the next entry. */
export function labelLimitPx(visible, i, pxPerBeat) {
  const next = visible[i + 1];
  if (!next) return L.SCREEN_W - visible[i].x;
  return Math.max(0, next.x - visible[i].x - 2);
}

/* True on the frame a new beat starts — used to flash the hit line. */
export function isBeatEdge(prevBeats, songBeats) {
  return Math.floor(prevBeats) !== Math.floor(songBeats);
}

/*
 * Wait-for-note: hold the playhead at `blockBeat` while the scroll is frozen.
 *
 * Rather than stopping the clock, the time that passes while frozen is
 * accumulated into `waitedBeats` and subtracted out. The run therefore resumes
 * in tempo from where it stopped instead of lurching forward to catch up, and
 * the click and reference line freeze with it because both are derived from
 * songBeats.
 *
 * TWO CLOCKS, AND THE SECOND ONE IS WHY THIS IS NOT FOUR LINES.
 *
 * The scroll stops on the note. The JUDGE must not: expireMissed is driven by
 * a clock, so one pinned at the note never reaches that note's late window,
 * the note is never scored, and judgeNoteOn reads an offset of zero — a note
 * found three seconds later would be a perfect hit and a miss would become
 * something that cannot happen.
 *
 * So `scoreBeats` keeps running in real time while `songBeats` sits still. It
 * cannot be derived after the fact: the first frozen frame folds the overshoot
 * into `waitedBeats`, after which `rawBeats - waitedBeats` is pinned at the
 * block point again. `frozenAt` carries the pre-freeze `waitedBeats` across
 * frames so the honest clock survives, and is null whenever nothing is frozen.
 *
 * `rawBeats` is the unadjusted wall-clock position.
 */
export function applyWait(rawBeats, waitedBeats, blockBeat, frozenAt = null) {
  const t = rawBeats - waitedBeats;
  if (blockBeat === null || blockBeat === undefined || t <= blockBeat) {
    return { songBeats: t, waitedBeats, blocked: false, scoreBeats: t, frozenAt: null };
  }
  const start = frozenAt === null || frozenAt === undefined ? waitedBeats : frozenAt;
  return {
    songBeats: blockBeat,
    waitedBeats: waitedBeats + (t - blockBeat),
    blocked: true,
    scoreBeats: rawBeats - start,
    frozenAt: start,
  };
}
