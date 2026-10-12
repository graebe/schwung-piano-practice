// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * chart-view.js — the view model's chart and run as GrandStaff's props. Pure.
 *
 * The session judges each note and says how far off it was; the staff draws a
 * judgement per note. A hit inside the perfect window is 'hit', inside the
 * good window 'good', and later than that 'late' — the scoring's own windows
 * (src/scoring.mjs), turned from milliseconds into beats at the piece's tempo.
 */
import { DEFAULT_WINDOWS } from '../../../src/scoring.mjs';
import { NOTE_HIT, NOTE_MISSED } from '../../../src/view_model.mjs';

export function staffEvents(chart) {
  if (!chart) return [];
  return chart.events.map((e, index) => ({
    beat: e.beat, durBeats: e.dur, pitches: e.pitches, hand: e.hand, symbol: e.symbol, index,
  }));
}

function hitQuality(offsetBeats, bpm) {
  const ms = Math.abs((offsetBeats * 60000) / bpm);
  if (ms <= DEFAULT_WINDOWS.perfectMs) return 'hit';
  if (ms <= DEFAULT_WINDOWS.goodMs) return 'good';
  return 'late';
}

/*
 * One array per event, parallel to its `pitches` as written. The run keeps
 * each event's notes sorted by pitch; the chart keeps them as the file wrote
 * them — so each written pitch is looked up in the sorted order.
 */
export function staffJudgements(chart, run) {
  if (!chart || !run) return [];
  return chart.events.map((e, i) => {
    const codes = run.notes[i] || '';
    const offsets = run.offsets[i] || [];
    const sorted = e.pitches.slice().sort((a, b) => a - b);
    return e.pitches.map((p) => {
      const k = sorted.indexOf(p);
      const code = codes[k];
      if (code === NOTE_HIT) return hitQuality(offsets[k] || 0, chart.bpm);
      if (code === NOTE_MISSED) return 'missed';
      return 'pending';
    });
  });
}

/*
 * Every press, where it happened. A press near no note of its pitch is a
 * stray, drawn red: within a beat of an event that has the pitch, it was an
 * attempt at that note, however early or late.
 */
export function staffMarkers(chart, run) {
  if (!chart || !run) return [];
  return run.markers.map(([beat, pitch]) => ({
    beat,
    pitch,
    stray: !chart.events.some((e) => Math.abs(e.beat - beat) <= 1 && e.pitches.includes(pitch)),
  }));
}

/* Where the run stands, for the read-out beside the transport. */
export function runSummary(run) {
  if (!run) return null;
  const s = run.stats;
  return { hits: s.hits, misses: s.misses, strays: s.strays, total: s.total };
}
