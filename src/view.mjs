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
import { nameChord } from './chords.mjs';
import {
  visibleEvents, visibleBars, barBeatOf, labelLimitPx, chartTotalBeats, beatToX, fifthsAt,
} from './chart.mjs';
import { runStats, blockingNotes, blockingEntryIndex } from './scoring.mjs';
import { countInRemaining } from './controls.mjs';
import { drillLabel, sparkline, summarise, errorFraction } from './stats.mjs';
import { accuracySeries } from './progress.mjs';
import { LIST_MAX, shortLabel } from './answer_pads.mjs';

export const SETTINGS_HINT = 'shift + jog: settings';
/* Inside a folder of the lesson list, where Back no longer means leave. */
export const FOLDER_HINT = 'CLICK open  BACK up';

/*
 * Centred one-liner along the bottom edge.
 *
 * Fitted, because a line past 21 characters runs off both sides and the host
 * says nothing about it — four footers shipped that way, one of them losing its
 * last two words. Shortening the strings is the real fix; this is what stops
 * the next one being wrong.
 */
export function drawFooterHint(ctx, text) {
  const s = truncate(ctx, text, L.TEXT_MAX_PX);
  ctx.text((L.SCREEN_W - ctx.textWidth(s)) >> 1, L.FOOTER_Y - 2, s, 1);
}

function truncate(ctx, text, maxPx) {
  let s = text;
  while (s.length > 1 && ctx.textWidth(s) > maxPx) s = s.slice(0, -1);
  return s;
}

/*
 * One line of a two-column row: `left` from x0, `right` ending at x1.
 *
 * The right cell is capped at half the row and the left one gets what is left
 * minus a gutter, so the pair cannot collide however long the numbers grow.
 * Both used to be drawn at their natural width on one baseline, which is how
 * "wrong 3   streak 9   hints 2" (167px) came to be printed over "best 31/min".
 */
function twoCell(ctx, y, left, right, x0, x1) {
  const r = right ? truncate(ctx, right, (x1 - x0) >> 1) : '';
  const rw = r ? ctx.textWidth(r) : 0;
  if (r) ctx.text(x1 - rw, y, r, 1);
  if (left) ctx.text(x0, y, truncate(ctx, left, x1 - x0 - rw - (rw ? 6 : 0)), 1);
}

/*
 * The reading view.
 * state = { chart, run, songBeats, pxPerBeat, running, beatFlash }
 */
export function drawReadingView(ctx, state) {
  const { chart, run, songBeats, pxPerBeat } = state;

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
    const fifths = fifthsAt(chart, v.event.beat);
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
      R.drawPlayedMarker(ctx, mx, pitchToY(m.pitch, fifthsAt(chart, m.beat)));
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
    const stuck = chart.events[blockingEntryIndex(run)];
    drawStuckLabel(ctx, blockingNotes(run).map((n) => n.pitch),
      fifthsAt(chart, stuck ? stuck.beat : songBeats), stuck && stuck.symbol);
  }

  const bb = barBeatOf(chart, songBeats);
  const stats = run ? runStats(run) : null;
  /* One slot, one owner. The ready view used to print its MIDI-out label over
   * the top of bar.beat here, leaving the corner an unreadable smudge; it
   * passes rightLabel instead, and at beat 0 the bar.beat it displaces always
   * read "1.1" anyway. */
  const right = state.rightLabel || (bb.bar + '.' + bb.beat);
  R.drawChrome(ctx, {
    left: truncate(ctx, chart.name || 'Practice', L.SCREEN_W - ctx.textWidth(right) - 6),
    right,
    lane: true,
  });

  const total = chartTotalBeats(chart) || 1;
  R.drawFooter(ctx, songBeats / total, stats ? stats.hits + '/' + stats.misses : '');

  /* Paused and stuck both show a motionless scroll, and only one of them is
   * waiting for you to play something. */
  if (state.paused) {
    const tag = 'PAUSED';
    const w = ctx.textWidth(tag);
    const x = (L.SCREEN_W - w) >> 1;
    ctx.fillRect(x - 3, L.FOOTER_Y - 3, w + 6, L.TEXT_H + 1, 0);
    ctx.text(x, L.FOOTER_Y - 2, tag, 1);
  }
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
/*
 * Four rows taller than it was, to hold a third line. At the old geometry a
 * row at +26 ended on screen row 51 — outside a box ending at 46, and across
 * the name rule at 47.
 */
export const READY_BOX = { x: 12, y: 15, w: 104, h: 32 };

export function drawReadyView(ctx, state) {
  drawReadingView(ctx, {
    ...state,
    songBeats: state.songBeats || 0,
    run: state.run,
    rightLabel: state.outLabel || '',
  });

  /*
   * THE BOX GETS OUT OF THE WAY ONCE YOU LEAVE THE START. It is an overlay
   * across the middle of the staff, so it covers exactly the music you are
   * scrubbing through; keeping it up would defeat the scrubbing. It comes back
   * when you scroll home, which is also the only way to find it again.
   */
  if ((state.songBeats || 0) > 0) return ctx;

  const b = READY_BOX;
  ctx.fillRect(b.x, b.y, b.w, b.h, 0);
  ctx.drawRect(b.x, b.y, b.w, b.h, 1);

  /* Three controls, three symbols, three words. Which one does what is the
   * thing that has to be readable without being learned — and the knob was the
   * one you could only find by turning it. */
  const gh = 7;
  const gx = b.x + 6;
  const tx = gx + 12;

  R.drawPlayGlyph(ctx, gx, b.y + 4, gh);
  ctx.text(tx, b.y + 4, state.playLabel || 'PLAY  listen', 1);

  R.drawRecordGlyph(ctx, gx, b.y + 13, gh);
  ctx.text(tx, b.y + 13, state.recLabel || 'REC   practice', 1);

  R.drawScrubGlyph(ctx, gx, b.y + 22);
  ctx.text(tx, b.y + 22, state.scrubLabel || 'SCRUB view', 1);

  /* Where the notes are going is in the header (rightLabel, above), on the one
   * screen you always pass through: a silent channel mismatch is otherwise
   * indistinguishable from broken. */

  /* Replace the progress bar with the one thing here you cannot discover by
   * trying it: turning the jog swaps exercise and shows you it did, but
   * nothing hints that Shift is involved in anything. 21 characters at the
   * 6px advance is 125px, so it just fits the width. */
  ctx.fillRect(0, L.FOOTER_Y - 3, L.SCREEN_W, L.SCREEN_H - L.FOOTER_Y + 3, 0);
  drawFooterHint(ctx, state.footer || SETTINGS_HINT);
  return ctx;
}

/*
 * The ready screen's footer when the exercise has stages: which one is armed,
 * what it means, and that the jog changes it. Settings stays one Back away,
 * where the list's footer names it.
 */
export function stageFooter(stage) {
  return stage === 2 ? 'S2 pads dark  JOG: S1' : 'S1 pads lit  JOG: S2';
}

/*
 * The note guesser: one note or chord, still, named, until you play it.
 *
 * Built from the same primitives as the reading view but without the scroll
 * engine — no bar lines, no progress bar, no hit line, because there is no
 * clock here and drawing the furniture of one would only suggest otherwise.
 */
export const GUESS_X = 72;

/*
 * What the name lane says about a prompt: the chord symbol AND its notes.
 *
 * Both, because each drill used to show only the half it happened to have. The
 * triads drill builds from scale degrees, so it had note names and never said
 * "Em" — you could play the chord correctly for weeks without learning what it
 * was called. The types drill chose a quality, so it had "Em7" and not the
 * notes. A single note keeps its name alone; there is no chord to name.
 *
 * ONE space between them, and that is measured rather than chosen: across all
 * 2568 combinations of quality, root and key signature, one space peaks at
 * 125px against the 126px lane and never overflows, while two peak at 131 and
 * overflow sixteen of them.
 */
function promptLabel(state, prompt, fifths) {
  const notes = state.label && prompt.length < 2
    ? state.label
    : chordLabel(prompt, fifths);
  if (prompt.length < 2) return notes;
  const symbol = state.label || nameChord(prompt, fifths);
  /* No symbol is a real answer, not a gap: in a chromatic or whole-tone scale
   * the triad drill stacks degrees that are not a chord, and the notes without
   * a name beat the nearest invented one. */
  return symbol ? symbol + ' ' + notes : notes;
}

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
    lane: true,
  });

  /* The name is always shown: this drills finding the pitch on the grid, not
   * decoding the staff. Inverted for a moment on a correct answer, which reads
   * as "yes" without costing a pause. */
  if (state.hidden) {
    drawCentreCallout(ctx, '?', 4);
    /* A hint names it without giving back the notation: you asked what it was,
     * not to be shown the staff. */
    if (state.hint > 0) {
      const named = promptLabel(state, prompt, fifths);
      if (named) ctx.text((L.SCREEN_W - ctx.textWidth(named)) >> 1, L.NAME_LANE_Y, named, 1);
    }
    if (state.footer) drawFooterHint(ctx, state.footer);
    return ctx;
  }

  const label = promptLabel(state, prompt, fifths);
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

/*
 * What you are stuck on, named, in the name lane.
 *
 * It used to be a big boxed callout across the middle of the staff — which
 * covered the notes it was describing, so the chord you were being asked for
 * was invisible behind its own label while the lane below already repeated the
 * note names in small text. Reading the staff is the skill; once you have
 * missed it you need telling, not hiding.
 *
 * So: the chord symbol AND its notes, inverted so it still reads as "this one,
 * now", in the lane where names already live. The lane is cleared first
 * because the frozen entry's own scrolling label is drawn there too, and the
 * two would overprint.
 */
export function drawStuckLabel(ctx, pitches, fifths, written) {
  if (!pitches.length) return;
  const notes = chordLabel(pitches, fifths);
  /* nameChord answers null for a stack that is not a chord — a cluster from
   * stacking degrees of a non-tertian scale — and the notes alone are the
   * honest answer there rather than the nearest invented symbol. A symbol the
   * chart wrote down wins: it is the name of the whole chord, where `pitches`
   * are only the notes still missing from it. */
  const symbol = written || (pitches.length > 1 ? nameChord(pitches, fifths) : null);
  const text = truncate(ctx, symbol ? symbol + '  ' + notes : notes, L.TEXT_MAX_PX - 4);
  const w = ctx.textWidth(text);
  const x = (L.SCREEN_W - w) >> 1;
  /* TEXT_H + 1: the lane's own scrolling label is drawn at NAME_LANE_Y and
   * runs to NAME_LANE_Y + TEXT_H - 1, one row below where a TEXT_H-tall clear
   * starting at the rule would reach — so its descenders survived underneath. */
  ctx.fillRect(0, L.NAME_RULE_Y + 1, L.SCREEN_W, L.TEXT_H + 1, 0);
  ctx.fillRect(x - 2, L.NAME_LANE_Y - 1, w + 4, L.TEXT_H + 1, 1);
  ctx.text(x, L.NAME_LANE_Y, text, 0);
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
 * The chart, at whatever size the caller has room for.
 *
 * Two series on a 1-bit screen: the rate as a connected line across the upper
 * band, the error rate as bars growing from the baseline below it. They are
 * drawn from ONE call to sparkline() rather than from a line function and a bar
 * function — two calls would each take their own `limit`, and the bars would
 * silently stop lining up with the line they sit under.
 */
export function drawPlot(ctx, box, records) {
  const baseY = box.y + box.h;
  /* A baseline, so a flat run still reads as a chart rather than a stray line. */
  ctx.fillRect(box.x, baseY, box.w, 1, 1);
  if (!records.length) return ctx;

  const errH = Math.max(L.PLOT_ERR_MIN_H, Math.round(box.h * L.PLOT_ERR_FRACTION));
  /* One row spare below the line band, so a point's 3x3 marker can never reach
   * into the bars and be read as one. */
  const lineH = Math.max(1, box.h - errH - 1);
  const pts = sparkline(records, box.w, lineH);

  /* Two pixels wide while the rounds are far enough apart to stay distinct, so
   * a short history reads as bars rather than as specks. */
  const barW = pts.length > 1 && pts[1].x - pts[0].x >= 4 ? 2 : 1;
  for (let i = 0; i < pts.length; i++) {
    const px = box.x + pts[i].x;
    /* A round with any wrong answer gets at least one pixel: rounding a single
     * mistake away to nothing is the one error the bars must not make. */
    const t = Math.min(1, pts[i].err / L.PLOT_ERR_FULL);
    const h = pts[i].err > 0 ? Math.max(1, Math.round(t * errH)) : 0;
    if (h) ctx.fillRect(Math.min(px, box.x + box.w - barW), baseY - h, barW, h, 1);
  }

  for (let i = 0; i < pts.length; i++) {
    const px = box.x + pts[i].x;
    const py = box.y + pts[i].y;
    if (i > 0) ctx.line(box.x + pts[i - 1].x, box.y + pts[i - 1].y, px, py, 1);
    /* Mark each round, so a two-round history is visibly two rounds. The 3px
     * mark is clamped rather than centred at the edges: the last point sits on
     * the box's final column and the best one on its top row, so a centred mark
     * would hang a pixel outside the rect the caller reserved — which is how it
     * came to be drawn over the row above the plot on both screens. */
    ctx.fillRect(
      Math.min(Math.max(px - 1, box.x), box.x + box.w - 3),
      Math.min(Math.max(py - 1, box.y), box.y + box.h - 3), 3, 3, 1);
  }
  return ctx;
}

/*
 * The end of a round. The rate is the headline, so it gets the big font; the
 * two figures that qualify it — how many were wrong, how much help — sit to
 * its right, one row of detail runs under it, and the chart of the drill's
 * recent rounds takes the rest: the rate on its own says nothing, the trend
 * says whether you are getting better.
 */
export function drawRoundResult(ctx, state) {
  ctx.clear();
  R.drawChrome(ctx, {
    /* The status replaces the title rather than joining it: beside a
     * three-digit best, "ROUND  S1 DONE" ran into it. */
    left: state.passed === 2 ? 'DONE' : state.passed === 1 ? 'S1 DONE' : 'ROUND',
    right: state.isBest ? 'BEST YET' : 'best ' + Math.round(state.best) + '/min',
  });

  const big = String(Math.round(state.rate));
  const w = R.bigTextWidth(big, L.RESULT_BIG_SCALE);
  R.drawBigText(ctx, L.RESULT_LEFT_X, L.RESULT_BIG_Y, big, L.RESULT_BIG_SCALE);
  const unitX = L.RESULT_LEFT_X + w + 5;
  ctx.text(unitX, L.RESULT_BIG_Y + R.bigDigitHeight(L.RESULT_BIG_SCALE) - L.TEXT_H, 'per min', 1);

  /* Right-aligned beside the headline: the wrong answers on the row above
   * "per min", the hints on its row, fitted to what is left of it. */
  const pct = Math.round(errorFraction(state.n, state.wrong) * 100);
  rightText(ctx, L.RESULT_SIDE_A_Y, 'wrong ' + state.wrong + '  ' + pct + '%', L.RESULT_LEFT_X + w + 4);
  if (state.hints) {
    rightText(ctx, L.RESULT_SIDE_B_Y, 'hints ' + state.hints, unitX + ctx.textWidth('per min') + 4);
  }
  twoCell(ctx, L.RESULT_ROW_A_Y,
    state.n + ' in ' + Math.round(state.ms / 1000) + 's',
    'streak ' + state.bestStreak, L.RESULT_LEFT_X, L.RESULT_RIGHT_X);

  drawPlot(ctx, L.RESULT_PLOT, state.records || []);
  drawFooterHint(ctx, state.footer || 'PLAY again  CLICK next');
  return ctx;
}

/* Right-aligned to the result's right edge, never reaching left of `minX`. */
function rightText(ctx, y, text, minX) {
  const s = truncate(ctx, text, L.RESULT_RIGHT_X - minX);
  if (s) ctx.text(L.RESULT_RIGHT_X - ctx.textWidth(s), y, s, 1);
}

/*
 * Accuracy per attempt, on a fixed 0..100% scale with the pass mark ruled
 * dotted across it — the line you are trying to stay above. Stage 1 attempts
 * are hollow points and stage 2 attempts solid, so the move from playing with
 * the pads lit to reading alone shows as the points filling in.
 */
export function drawAccuracyPlot(ctx, box, history) {
  const baseY = box.y + box.h;
  ctx.fillRect(box.x, baseY, box.w, 1, 1);
  if (!history || !history.length) return ctx;
  /* The marks are 3x3, so the series lives one pixel in from every edge of
   * the box and a mark can never hang outside the rect the caller reserved. */
  const inner = { x: box.x + 1, y: box.y + 1, w: box.w - 2, h: box.h - 2 };
  const { points, passY } = accuracySeries(history, inner.w, inner.h);
  for (let x = 0; x < box.w; x += 3) ctx.fillRect(box.x + x, inner.y + passY, 1, 1, 1);
  for (let i = 0; i < points.length; i++) {
    const px = inner.x + points[i].x;
    const py = inner.y + points[i].y;
    if (i > 0) ctx.line(inner.x + points[i - 1].x, inner.y + points[i - 1].y, px, py, 1);
  }
  for (let i = 0; i < points.length; i++) {
    const px = inner.x + points[i].x;
    const py = inner.y + points[i].y;
    if (points[i].stage === 2) {
      ctx.fillRect(px - 1, py - 1, 3, 3, 1);
    } else {
      ctx.fillRect(px - 1, py - 1, 3, 3, 0);
      ctx.drawRect(px - 1, py - 1, 3, 3, 1);
      ctx.fillRect(px, py, 1, 1, 0);
    }
  }
  return ctx;
}

/*
 * The end of a played exercise. The headline is the share you got right; the
 * chart beneath is every recent attempt at THIS exercise, so the number is
 * read against where you were, not on its own.
 *
 * state = { name, percent, hits, total, wrong, stage, passed: 0|1|2,
 *           isBest, history, footer }
 */
export function drawExerciseResult(ctx, state) {
  ctx.clear();
  const status = state.passed === 2 ? 'DONE'
    : state.passed === 1 ? 'S1 DONE'
      : state.isBest ? 'BEST YET' : 'stage ' + state.stage;
  const mark = state.passed === 2 ? 'done' : state.passed === 1 ? 'half' : null;
  const statusW = ctx.textWidth(status) + (mark ? R.MARK_W + 2 : 0);
  R.drawChrome(ctx, {
    left: truncate(ctx, state.name || 'Exercise', L.SCREEN_W - statusW - 6),
    right: status,
  });
  if (mark) R.drawMark(ctx, L.SCREEN_W - statusW - 1, 1, mark, 0);

  const big = String(Math.round(state.percent));
  const w = R.bigTextWidth(big, L.RESULT_BIG_SCALE);
  R.drawBigText(ctx, L.RESULT_LEFT_X, L.RESULT_BIG_Y, big, L.RESULT_BIG_SCALE);
  ctx.text(L.RESULT_LEFT_X + w + 3,
    L.RESULT_BIG_Y + R.bigDigitHeight(L.RESULT_BIG_SCALE) - L.TEXT_H, '%', 1);

  const minX = L.RESULT_LEFT_X + w + 3 + ctx.textWidth('%') + 4;
  rightText(ctx, L.RESULT_SIDE_A_Y, state.hits + ' of ' + state.total + ' hit', minX);
  rightText(ctx, L.RESULT_SIDE_B_Y,
    state.wrong ? state.wrong + ' wrong' : 'stage ' + state.stage, minX);

  drawAccuracyPlot(ctx, L.EXERCISE_PLOT, state.history || []);
  drawFooterHint(ctx, state.footer || 'REC again  CLICK next');
  return ctx;
}

/*
 * How you have developed, one drill at a time. Comparing across drills would be
 * meaningless — hearing seventh chords is not the same task as naming a white
 * note — so the plot only ever shows one, and the jog changes which.
 */
export function drawProgress(ctx, state) {
  const records = state.records || [];
  ctx.clear();
  const s = summarise(records);
  R.drawChrome(ctx, {
    left: 'PROGRESS',
    right: records.length ? 'best ' + Math.round(s.best) : '',
  });

  const title = state.drill ? drillLabel(state.drill) : 'nothing yet';
  ctx.text(2, L.PROGRESS_TITLE_Y, truncate(ctx, title, L.TEXT_MAX_PX), 1);

  if (!records.length) {
    const msg = 'no rounds yet';
    ctx.text((L.SCREEN_W - ctx.textWidth(msg)) >> 1, 28, msg, 1);
    drawFooterHint(ctx, state.drillCount > 1 ? 'jog: another drill' : 'play a round');
    return ctx;
  }

  drawPlot(ctx, L.PROGRESS_PLOT, records);
  /* The plot shows the trend; the row states the two numbers it cannot — where
   * you are now, and what it cost you in wrong answers to get there. */
  twoCell(ctx, L.PROGRESS_ROW_Y, 'now ' + Math.round(s.last),
    'err ' + Math.round(s.lastError * 100) + '%', 2, L.SCREEN_W - 2);
  drawFooterHint(ctx, state.drillCount > 1
    ? 'jog: drill ' + (state.drillIndex + 1) + '/' + state.drillCount
    : String(s.count) + ' rounds');
  return ctx;
}

/*
 * One exercise's history: its attempts on the accuracy chart, and under it
 * where you are now and which stage you have reached.
 *
 * state = { title, history, percent, best, mark, index, count }
 */
export function drawItemProgress(ctx, state) {
  const history = state.history || [];
  ctx.clear();
  R.drawChrome(ctx, {
    left: 'PROGRESS',
    right: history.length ? 'best ' + Math.round(state.best) + '%' : '',
  });
  ctx.text(2, L.PROGRESS_TITLE_Y, truncate(ctx, state.title || '', L.TEXT_MAX_PX), 1);
  drawAccuracyPlot(ctx, L.PROGRESS_PLOT, history);
  const stage = state.mark === 'done' ? 'finished' : state.mark === 'half' ? 'stage 1 done'
    : state.mark === 'skip' ? 'skipped' : '';
  twoCell(ctx, L.PROGRESS_ROW_Y, 'now ' + Math.round(state.percent) + '%', stage, 2, L.SCREEN_W - 2);
  drawFooterHint(ctx, state.count > 1
    ? 'jog: ' + (state.index + 1) + '/' + state.count
    : history.length + ' plays');
  return ctx;
}

/*
 * The long view: every stage you have passed, as a line that rises by one at
 * each pass, along real time. Flat stretches are weeks off; steep ones are
 * where it clicked.
 *
 * state = { title, percent, done, half, count, timeline, index, total }
 */
export function drawOverview(ctx, state) {
  ctx.clear();
  R.drawChrome(ctx, { left: (state.title || 'OVERALL').toUpperCase(), right: state.percent + '%' });
  ctx.text(2, L.PROGRESS_TITLE_Y, truncate(ctx,
    state.done + ' done  ' + state.half + ' half  of ' + state.count, L.TEXT_MAX_PX), 1);

  const box = L.PROGRESS_PLOT;
  ctx.fillRect(box.x, box.y + box.h, box.w, 1, 1);
  const pts = state.timeline ? state.timeline.points : [];
  if (!pts.length) {
    const msg = 'nothing passed yet';
    ctx.text((L.SCREEN_W - ctx.textWidth(msg)) >> 1, 28, msg, 1);
  } else {
    /* A step line: flat until the next pass, then up. */
    let prevX = box.x;
    let prevY = box.y + box.h - 1;
    for (let i = 0; i < pts.length; i++) {
      const x = box.x + pts[i].x;
      const y = box.y + pts[i].y;
      ctx.line(prevX, prevY, x, prevY, 1);
      ctx.line(x, prevY, x, y, 1);
      prevX = x;
      prevY = y;
    }
    ctx.line(prevX, prevY, box.x + box.w - 1, prevY, 1);
  }
  twoCell(ctx, L.PROGRESS_ROW_Y, 'stages passed',
    String(state.timeline ? state.timeline.total : 0), 2, L.SCREEN_W - 2);
  drawFooterHint(ctx, state.total > 1 ? 'jog: ' + (state.index + 1) + '/' + state.total : '');
  return ctx;
}

/*
 * Multiple choice. The answers are pads on the bottom of the grid, each in its
 * own colour (answer_pads.mjs), and this is their legend: which colour means
 * which answer. The jog can still choose too, so its choice is marked here
 * and pulses on its pad.
 */
export function drawPick(ctx, state) {
  const options = state.options || [];
  ctx.clear();
  R.drawChrome(ctx, { left: state.title || 'NAME', right: state.score || '' });

  const msg = truncate(ctx, state.hint || 'which pad is lit?', L.TEXT_MAX_PX);
  ctx.text((L.SCREEN_W - ctx.textWidth(msg)) >> 1, 10, msg, 1);

  if (options.length <= LIST_MAX) drawAnswerList(ctx, state, options);
  else drawAnswerMap(ctx, state, options);

  if (state.footer) drawFooterHint(ctx, state.footer);
  return ctx;
}

/*
 * Four answers or fewer: one row each, the answer on the left and the colour
 * of its pad on the right. The panel is one colour, so the pad's colour is
 * named rather than shown — and the jog's choice is inverted, as everywhere.
 */
const ANSWER_ROW_Y = 20;
const ANSWER_ROW_H = 9;

function drawAnswerList(ctx, state, options) {
  for (let i = 0; i < options.length; i++) {
    const y = ANSWER_ROW_Y + i * ANSWER_ROW_H;
    const selected = i === state.index;
    const v = selected ? 0 : 1;
    if (selected) ctx.fillRect(0, y - 1, L.SCREEN_W, ANSWER_ROW_H, 1);
    const colour = state.colours ? state.colours[i] || '' : '';
    const cw = colour ? ctx.textWidth(colour) : 0;
    const label = truncate(ctx, options[i], L.SCREEN_W - 8 - cw - (cw ? 6 : 0));
    ctx.text(4, y, label, v);
    if (colour) ctx.text(L.SCREEN_W - 4 - cw, y, colour, v);
    /* A hint strikes an answer through rather than removing it: the list
     * keeps its shape, and its pad goes dark. */
    if (state.eliminated && state.eliminated.indexOf(i) >= 0) {
      ctx.fillRect(2, y + 3, L.SCREEN_W - 4, 1, v);
    }
  }
}

/*
 * More than four: a map of the answer pads, in the shape they sit on the
 * grid — the bottom row at the bottom — each with its short name, and the
 * jog's choice spelled out in full underneath. Past four answers a list of
 * colour names stops being readable; the position carries the meaning.
 */
const MAP_CELL_W = 16;
const MAP_CELL_H = 11;
const MAP_TOP_Y = 20;
const MAP_NAME_Y = 46;

function drawAnswerMap(ctx, state, options) {
  const rows = options.length > 8 ? 2 : 1;
  for (let i = 0; i < options.length; i++) {
    const row = i >> 3;
    const col = i & 7;
    /* Row 0 is the bottom row of pads, so with two rows it is drawn lower. */
    const y = rows === 2
      ? MAP_TOP_Y + (1 - row) * (MAP_CELL_H + 1)
      : MAP_TOP_Y + ((MAP_CELL_H + 1) >> 1);
    const x = col * MAP_CELL_W;
    const selected = i === state.index;
    const short = state.short ? state.short[i] : shortLabel({ label: options[i] });
    if (selected) ctx.fillRect(x + 1, y, MAP_CELL_W - 1, MAP_CELL_H, 1);
    else ctx.drawRect(x + 1, y, MAP_CELL_W - 1, MAP_CELL_H, 1);
    const tw = ctx.textWidth(short);
    ctx.text(x + 1 + ((MAP_CELL_W - 1 - tw) >> 1), y + 2, short, selected ? 0 : 1);
    if (state.eliminated && state.eliminated.indexOf(i) >= 0) {
      ctx.line(x + 2, y + MAP_CELL_H - 2, x + MAP_CELL_W - 2, y + 1, selected ? 0 : 1);
    }
  }
  const name = truncate(ctx, options[state.index] || '', L.TEXT_MAX_PX);
  ctx.text((L.SCREEN_W - ctx.textWidth(name)) >> 1, MAP_NAME_Y, name, 1);
}

/* Scrolling list used for both the exercise picker and the settings page. */
export function drawList(ctx, title, rows, cursor, opts = {}) {
  const lineH = 9;
  const top = 11;
  const perPage = 4;
  ctx.clear();
  /* The title is fitted against the counter, not printed at its natural width:
   * the level list is titled with the song's name, and drawChrome does not
   * clip, so 'SCARBOROUGH FAIR' would have been printed straight through the
   * '2/4' in the corner. */
  const count = rows.length ? cursor + 1 + '/' + rows.length : '';
  R.drawChrome(ctx, {
    left: truncate(ctx, title, L.SCREEN_W - ctx.textWidth(count) - 4),
    right: count,
  });
  const first = Math.max(0, Math.min(cursor - (perPage >> 1), rows.length - perPage));
  for (let i = 0; i < perPage; i++) {
    const idx = first + i;
    if (idx < 0 || idx >= rows.length) break;
    const y = top + i * lineH;
    const selected = idx === cursor;
    if (selected) ctx.fillRect(0, y - 1, L.SCREEN_W, lineH, 1);
    const row = rows[idx];
    /* What a row says about your progress is decided by the caller, at draw
     * time: the tree holds what the lessons ARE, not how far you have got. */
    const deco = opts.decorate && typeof row !== 'string' ? opts.decorate(row) : null;
    const label = deco && deco.label ? deco.label : typeof row === 'string' ? row : row.label;
    let value = deco && deco.value !== undefined ? deco.value
      : typeof row === 'string' ? '' : row.value || '';
    const mark = deco ? deco.mark : null;
    /* Brackets mark the row the jog is currently changing, so "turn to change"
     * has something to point at. */
    if (value && selected && opts.editing) value = '[' + value + ']';
    /* The label is fitted against what the value actually takes, not against a
     * fixed budget: the widest real row is 114px, but a longer value added
     * later would otherwise be printed over the end of its own label. */
    const tw = value ? ctx.textWidth(value) : 0;
    const mw = mark ? R.MARK_W + (tw ? 2 : 0) : 0;
    const vw = tw + mw;
    const v = selected ? 0 : 1;
    ctx.text(2, y, truncate(ctx, label, L.SCREEN_W - 4 - vw - (vw ? 4 : 0)), v);
    if (mark) R.drawMark(ctx, L.SCREEN_W - vw - 2, y + 1, mark, v);
    if (value) ctx.text(L.SCREEN_W - tw - 2, y, value, v);
  }
  if (opts.footer) {
    if (opts.centreFooter) drawFooterHint(ctx, opts.footer);
    else ctx.text(2, L.FOOTER_Y - 1, truncate(ctx, opts.footer, L.SCREEN_W - 4), 1);
  }
  return ctx;
}
