/*
 * view.mjs — composes whole screens out of staff_render's primitives.
 *
 * Kept separate from ui.js so a complete frame can be rendered into a byte
 * buffer and asserted on from `node --test`, and dumped as ASCII art by
 * `npm run preview`. ui.js supplies the ctx and the state; nothing here
 * touches the host.
 */

import * as L from './layout.mjs';
import * as R from './staff_render.mjs';
import { spell, pitchToY, chordLabel, inStaffRange } from './notation.mjs';
import {
  visibleEvents, visibleBars, barBeatOf, labelLimitPx, chartTotalBeats, beatToX,
} from './chart.mjs';
import { runStats, blockingNotes, blockingEntryIndex } from './scoring.mjs';
import { countInRemaining } from './controls.mjs';
import { drillLabel, sparkline, summarise, recordRate } from './stats.mjs';

export const SETTINGS_HINT = 'shift + jog: settings';

/* Centred one-liner along the bottom edge. */
export function drawFooterHint(ctx, text) {
  ctx.text((L.SCREEN_W - ctx.textWidth(text)) >> 1, L.FOOTER_Y - 2, text, 1);
}

function truncate(ctx, text, maxPx) {
  let s = text;
  while (s.length > 1 && ctx.textWidth(s) > maxPx) s = s.slice(0, -1);
  return s;
}

/*
 * The reading view.
 * state = { chart, run, songBeats, pxPerBeat, running, beatFlash }
 */
export function drawReadingView(ctx, state) {
  const { chart, run, songBeats, pxPerBeat } = state;
  const fifths = chart.keySig || 0;

  ctx.clear();
  R.drawStaff(ctx);

  /* Bar lines go under the notes. */
  const bars = visibleBars(chart, songBeats, pxPerBeat);
  for (let i = 0; i < bars.length; i++) R.drawBarLine(ctx, bars[i].x);

  const visible = visibleEvents(chart, songBeats, pxPerBeat);

  /*
   * The note the scroll is frozen on is drawn whatever visibleEvents decided.
   *
   * A frozen note sits at hitX - grace*pxPerBeat. At a wide read-ahead that is
   * past DESPAWN_X, so the filter dropped it and the one note you were being
   * asked to play was the one not on screen. Capping the grace cannot fix it:
   * at fast tempos the grace is already floored at the late window to avoid a
   * deadlock, so the two clamps would fight. Pinning it is the honest fix, and
   * nothing is moving while frozen, so there is no jump to notice.
   */
  if (state.blocked && run) {
    const at = blockingEntryIndex(run);
    if (at >= 0 && chart.events[at]) {
      const x = Math.max(beatToX(chart.events[at].beat, songBeats, pxPerBeat), L.BLOCKED_MIN_X);
      const already = visible.find((v) => v.index === at);
      /* Clamp it whether or not the filter kept it, so the note looks the same
       * at every read-ahead — otherwise a missed F# shows its sharp at one
       * setting and a bare notehead at another. */
      if (already) already.x = x;
      else visible.unshift({ index: at, event: chart.events[at], x });
    }
  }

  for (let i = 0; i < visible.length; i++) {
    const v = visible[i];
    const entry = run ? run.entries[v.index] : null;
    const notes = [];
    for (let n = 0; n < v.event.pitches.length; n++) {
      const pitch = v.event.pitches[n];
      if (!inStaffRange(pitch)) continue;
      const s = spell(pitch, fifths);
      notes.push({
        y: pitchToY(pitch, fifths),
        alter: s.alter,
        state: entry ? entry.notes[n].state : 'pending',
      });
    }
    if (!notes.length) continue;
    R.drawEntry(ctx, {
      x: v.x,
      notes,
      label: chordLabel(v.event.pitches, fifths),
      labelLimitPx: labelLimitPx(visible, i, pxPerBeat),
    });
  }

  /* Where the keys actually went down, at the exact moment — so a marker sitting
   * clear of its notehead is the timing error made visible. Drawn after the
   * notes so it is never buried by one. */
  if (run && run.markers) {
    for (let i = 0; i < run.markers.length; i++) {
      const m = run.markers[i];
      if (!inStaffRange(m.pitch)) continue;
      const mx = beatToX(m.beat, songBeats, pxPerBeat);
      if (mx < L.DESPAWN_X || mx >= L.SCREEN_W) continue;
      R.drawPlayedMarker(ctx, mx, pitchToY(m.pitch, fifths));
    }
  }

  /* The clef sits on top: notes scroll behind it and vanish there. */
  ctx.fillRect(0, L.STAFF_AREA_TOP_Y, L.STAFF_LEFT_X, L.STAFF_AREA_BOTTOM_Y - L.STAFF_AREA_TOP_Y + 1, 0);
  R.drawClef(ctx);
  R.drawHitLine(ctx, Boolean(state.beatFlash));

  /* Count-in: the beats before the first note used to pass with nothing on
   * screen to say the run had begun. The notes keep scrolling in behind the
   * digit — watching them approach in tempo is the point of counting in. */
  const countIn = countInRemaining(songBeats);
  if (countIn > 0) {
    drawCentreCallout(ctx, String(Math.min(9, countIn)), 4);
  } else if (state.blocked && run) {
    const stuck = blockingNotes(run).map((n) => spell(n.pitch, fifths).name);
    if (stuck.length) drawCentreCallout(ctx, stuck.slice(0, 3).join(' '), 3);
    /* Stuck. Name the note: reading the staff is the skill, but once you have
     * missed it you need telling, not testing again. Shares the count-in's box
     * and can never collide with it — the count-in is before the first note,
     * a freeze is during. */
  }

  const bb = barBeatOf(chart, songBeats);
  const stats = run ? runStats(run) : null;
  R.drawChrome(ctx, {
    left: truncate(ctx, chart.name || 'Practice', 74),
    right: bb.bar + '.' + bb.beat,
  });

  const total = chartTotalBeats(chart) || 1;
  R.drawFooter(ctx, songBeats / total, stats ? stats.hits + '/' + stats.misses : '');
  return ctx;
}

/*
 * Shown before Play, and whenever the run is armed but not started.
 *
 * The prompt names the BUTTON and draws its symbol, because "play" at a
 * keyboard means press a key — which is what the first tester did, to no
 * effect. The Play button also pulses green while this is on screen
 * (controls.mjs), which is the signal that actually gets read.
 */
export const READY_BOX = { x: 12, y: 19, w: 104, h: 28 };

export function drawReadyView(ctx, state) {
  drawReadingView(ctx, { ...state, songBeats: state.songBeats || 0, run: state.run });

  const b = READY_BOX;
  ctx.fillRect(b.x, b.y, b.w, b.h, 0);
  ctx.drawRect(b.x, b.y, b.w, b.h, 1);

  /* Two buttons, two symbols, two words. Which one does what is the thing that
   * has to be readable without being learned. */
  const gh = 7;
  const gx = b.x + 6;
  const tx = gx + 12;

  R.drawPlayGlyph(ctx, gx, b.y + 4, gh);
  ctx.text(tx, b.y + 4, state.playLabel || 'PLAY  listen', 1);

  R.drawRecordGlyph(ctx, gx, b.y + 15, gh);
  ctx.text(tx, b.y + 15, state.recLabel || 'REC   practice', 1);

  /* Where the notes are going, on the one screen you always pass through. A
   * silent channel mismatch is otherwise indistinguishable from broken. */
  if (state.outLabel) {
    ctx.text(L.SCREEN_W - ctx.textWidth(state.outLabel) - 2, 0, state.outLabel, 0);
  }

  /* Replace the progress bar with the one thing here you cannot discover by
   * trying it: turning the jog swaps exercise and shows you it did, but
   * nothing hints that Shift is involved in anything. 21 characters at the
   * 6px advance is 125px, so it just fits the width. */
  ctx.fillRect(0, L.FOOTER_Y - 3, L.SCREEN_W, L.SCREEN_H - L.FOOTER_Y + 3, 0);
  drawFooterHint(ctx, SETTINGS_HINT);
  return ctx;
}

/*
 * The note guesser: one note or chord, still, named, until you play it.
 *
 * Built from the same primitives as the reading view but without the scroll
 * engine — no bar lines, no progress bar, no hit line, because there is no
 * clock here and drawing the furniture of one would only suggest otherwise.
 */
export const GUESS_X = 72;

export function drawGuessView(ctx, state) {
  const { prompt, fifths = 0 } = state;
  ctx.clear();
  R.drawStaff(ctx);

  /* Hearing mode withholds the notation until you have answered: the question
   * is what you heard, and showing it would answer it. Revealed on success,
   * which is where the teaching happens. */
  if (!state.hidden) {
    const notes = [];
    for (let i = 0; i < prompt.length; i++) {
      if (!inStaffRange(prompt[i])) continue;
      const sp = spell(prompt[i], fifths);
      notes.push({ y: pitchToY(prompt[i], fifths), alter: sp.alter, state: 'pending' });
    }
    if (notes.length) {
      R.drawEntry(ctx, { x: GUESS_X, notes, label: '' });
    }
  }

  /* The clef last, over the staff lines, as in the reading view. */
  ctx.fillRect(0, L.STAFF_AREA_TOP_Y, L.STAFF_LEFT_X, L.STAFF_AREA_BOTTOM_Y - L.STAFF_AREA_TOP_Y + 1, 0);
  R.drawClef(ctx);

  R.drawChrome(ctx, {
    left: state.title || 'GUESS',
    right: state.score || '',
  });

  /* The name is always shown: this drills finding the pitch on the grid, not
   * decoding the staff. Inverted for a moment on a correct answer, which reads
   * as "yes" without costing a pause. */
  if (state.hidden) {
    drawCentreCallout(ctx, '?', 4);
    if (state.footer) drawFooterHint(ctx, state.footer);
    return ctx;
  }

  /* The chord symbol when the drill is about qualities — naming the chord is
   * the exercise there, and the notes are already on the staff. Otherwise the
   * note names, which is all there is to say about a single note or a triad. */
  const label = state.label || chordLabel(prompt, fifths);
  if (label) {
    const w = ctx.textWidth(label);
    const x = (L.SCREEN_W - w) >> 1;
    if (state.solved) {
      ctx.fillRect(x - 2, L.NAME_LANE_Y - 1, w + 4, 9, 1);
      ctx.text(x, L.NAME_LANE_Y, label, 0);
    } else {
      ctx.text(x, L.NAME_LANE_Y, label, 1);
    }
  }

  if (state.footer) drawFooterHint(ctx, state.footer);
  return ctx;
}

/* End-of-run card. */
export function drawSummary(ctx, chart, run) {
  const s = runStats(run);
  ctx.clear();
  R.drawChrome(ctx, { left: 'RESULT', right: chart.name ? '' : '' });
  ctx.text(2, 12, 'Hit    ' + s.hits + '/' + s.total, 1);
  ctx.text(2, 21, 'Perfect ' + s.perfects, 1);
  ctx.text(2, 30, 'Missed ' + s.misses, 1);
  ctx.text(2, 39, 'Streak ' + s.bestCombo, 1);
  const pct = Math.round(s.accuracy * 100) + '%';
  ctx.text(L.SCREEN_W - ctx.textWidth(pct) - 3, 22, pct, 1);
  ctx.text(2, L.FOOTER_Y - 1, 'PLAY again  JOG pick', 1);
  return ctx;
}

/* A boxed, knocked-out line of big text across the middle of the staff. */
export function drawCentreCallout(ctx, text, scale) {
  const w = R.bigTextWidth(text, scale);
  const h = R.bigDigitHeight(scale);
  const x = (L.SCREEN_W - w) >> 1;
  const y = L.STAFF_TOP_Y + ((L.STAFF_BOTTOM_Y - L.STAFF_TOP_Y - h) >> 1);
  ctx.fillRect(x - 3, y - 2, w + 6, h + 4, 0);
  ctx.drawRect(x - 3, y - 2, w + 6, h + 4, 1);
  R.drawBigText(ctx, x, y, text, scale);
  return { x: x - 3, y: y - 2, w: w + 6, h: h + 4 };
}

/*
 * The end of a round. The rate is the headline, so it gets the big font; the
 * rest is context for it. "best yet" or the number to beat, because a rate on
 * its own tells you nothing about whether you are improving.
 */
export function drawRoundResult(ctx, state) {
  ctx.clear();
  R.drawChrome(ctx, { left: 'ROUND', right: state.drill ? '' : '' });

  const rate = Math.round(state.rate);
  const big = String(rate);
  const scale = 4;
  const w = R.bigTextWidth(big, scale);
  R.drawBigText(ctx, 4, 12, big, scale);
  ctx.text(4 + w + 4, 12 + R.bigDigitHeight(scale) - 7, 'per min', 1);

  const secs = (state.ms / 1000).toFixed(1) + 's';
  ctx.text(4, 36, state.n + ' in ' + secs, 1);
  ctx.text(4, 45, 'wrong ' + state.wrong + '   streak ' + state.bestStreak, 1);

  const note = state.isBest ? 'best yet' : 'best ' + Math.round(state.best) + '/min';
  ctx.text(L.SCREEN_W - ctx.textWidth(note) - 3, 45, note, 1);
  drawFooterHint(ctx, 'PLAY again   BACK list');
  return ctx;
}

/*
 * How you have developed, one drill at a time. Comparing across drills would be
 * meaningless — hearing seventh chords is not the same task as naming a white
 * note — so the plot only ever shows one, and the jog changes which.
 */
export const PLOT = { x: 4, y: 18, w: 120, h: 24 };

export function drawProgress(ctx, state) {
  const records = state.records || [];
  ctx.clear();
  R.drawChrome(ctx, {
    left: 'PROGRESS',
    right: state.drillIndex != null && state.drillCount
      ? state.drillIndex + 1 + '/' + state.drillCount
      : '',
  });

  const title = state.drill ? drillLabel(state.drill) : 'nothing yet';
  ctx.text(2, 9, title.length > 21 ? title.slice(0, 21) : title, 1);

  if (!records.length) {
    const msg = 'no rounds yet';
    ctx.text((L.SCREEN_W - ctx.textWidth(msg)) >> 1, 28, msg, 1);
    drawFooterHint(ctx, state.drillCount > 1 ? 'jog: another drill' : 'play a round');
    return ctx;
  }

  const pts = sparkline(records, PLOT.w, PLOT.h);
  /* A baseline, so a flat run still reads as a chart rather than a stray line. */
  ctx.fillRect(PLOT.x, PLOT.y + PLOT.h, PLOT.w, 1, 1);
  for (let i = 0; i < pts.length; i++) {
    const px = PLOT.x + pts[i].x;
    const py = PLOT.y + pts[i].y;
    if (i > 0) {
      ctx.line(PLOT.x + pts[i - 1].x, PLOT.y + pts[i - 1].y, px, py, 1);
    }
    /* Mark each round, so a two-round history is visibly two rounds. */
    ctx.fillRect(px - 1, py - 1, 3, 3, 1);
  }

  const s = summarise(records);
  const line = 'best ' + Math.round(s.best) + '  avg ' + Math.round(s.average)
    + '  now ' + Math.round(s.last);
  ctx.text(2, L.FOOTER_Y - 9, line, 1);
  drawFooterHint(ctx, state.drillCount > 1 ? 'jog: another drill' : String(s.count) + ' rounds');
  return ctx;
}

/* Scrolling list used for both the exercise picker and the settings page. */
export function drawList(ctx, title, rows, cursor, opts = {}) {
  const lineH = 9;
  const top = 11;
  const perPage = 4;
  ctx.clear();
  R.drawChrome(ctx, { left: title, right: rows.length ? cursor + 1 + '/' + rows.length : '' });
  const first = Math.max(0, Math.min(cursor - (perPage >> 1), rows.length - perPage));
  for (let i = 0; i < perPage; i++) {
    const idx = first + i;
    if (idx < 0 || idx >= rows.length) break;
    const y = top + i * lineH;
    const selected = idx === cursor;
    if (selected) ctx.fillRect(0, y - 1, L.SCREEN_W, lineH, 1);
    const row = rows[idx];
    const label = typeof row === 'string' ? row : row.label;
    let value = typeof row === 'string' ? '' : row.value || '';
    /* Brackets mark the row the jog is currently changing, so "turn to change"
     * has something to point at. */
    if (value && selected && opts.editing) value = '[' + value + ']';
    ctx.text(2, y, truncate(ctx, label, 84), selected ? 0 : 1);
    if (value) {
      ctx.text(L.SCREEN_W - ctx.textWidth(value) - 2, y, value, selected ? 0 : 1);
    }
  }
  if (opts.footer) {
    if (opts.centreFooter) drawFooterHint(ctx, opts.footer);
    else ctx.text(2, L.FOOTER_Y - 1, opts.footer, 1);
  }
  return ctx;
}
