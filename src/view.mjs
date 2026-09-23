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
import { runStats, blockingNotes } from './scoring.mjs';
import { countInRemaining } from './controls.mjs';

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

  const notes = [];
  for (let i = 0; i < prompt.length; i++) {
    if (!inStaffRange(prompt[i])) continue;
    const sp = spell(prompt[i], fifths);
    notes.push({ y: pitchToY(prompt[i], fifths), alter: sp.alter, state: 'pending' });
  }
  if (notes.length) {
    R.drawEntry(ctx, { x: GUESS_X, notes, label: '' });
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
  const label = chordLabel(prompt, fifths);
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
