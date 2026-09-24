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
  visibleEvents, visibleBars, barBeatOf, labelLimitPx, chartTotalBeats, beatToX,
} from './chart.mjs';
import { runStats, blockingNotes, blockingEntryIndex } from './scoring.mjs';
import { countInRemaining } from './controls.mjs';
import { drillLabel, sparkline, summarise, errorFraction } from './stats.mjs';

export const SETTINGS_HINT = 'shift + jog: settings';

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
    drawStuckLabel(ctx, blockingNotes(run).map((n) => n.pitch), fifths);
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
  drawReadingView(ctx, {
    ...state,
    songBeats: state.songBeats || 0,
    run: state.run,
    rightLabel: state.outLabel || '',
  });

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

  /* Where the notes are going is in the header (rightLabel, above), on the one
   * screen you always pass through: a silent channel mismatch is otherwise
   * indistinguishable from broken. */

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
export function drawStuckLabel(ctx, pitches, fifths) {
  if (!pitches.length) return;
  const notes = chordLabel(pitches, fifths);
  /* nameChord answers null for a stack that is not a chord — a cluster from
   * stacking degrees of a non-tertian scale — and the notes alone are the
   * honest answer there rather than the nearest invented symbol. */
  const symbol = pitches.length > 1 ? nameChord(pitches, fifths) : null;
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
 * rest is context for it, laid out as a two-column grid so no pair of numbers
 * can ever collide. The chart underneath answers the question a single rate
 * cannot — whether this was better than last time.
 */
export function drawRoundResult(ctx, state) {
  ctx.clear();
  R.drawChrome(ctx, {
    left: 'ROUND',
    right: state.isBest ? 'BEST YET' : 'best ' + Math.round(state.best) + '/min',
  });

  /* Scale 3 rather than 4: the 5px it gives up is exactly what the chart below
   * is drawn in, and two digits at 9x15 are still the largest thing on screen. */
  const big = String(Math.round(state.rate));
  const w = R.bigTextWidth(big, L.RESULT_BIG_SCALE);
  R.drawBigText(ctx, L.RESULT_LEFT_X, L.RESULT_BIG_Y, big, L.RESULT_BIG_SCALE);
  ctx.text(L.RESULT_LEFT_X + w + 5,
    L.RESULT_BIG_Y + R.bigDigitHeight(L.RESULT_BIG_SCALE) - L.TEXT_H, 'per min', 1);

  const pct = Math.round(errorFraction(state.n, state.wrong) * 100);
  twoCell(ctx, L.RESULT_ROW_A_Y,
    state.n + ' in ' + Math.round(state.ms / 1000) + 's',
    'streak ' + state.bestStreak, L.RESULT_LEFT_X, L.RESULT_RIGHT_X);
  twoCell(ctx, L.RESULT_ROW_B_Y,
    'wrong ' + state.wrong + '  ' + pct + '%',
    state.hints ? 'hints ' + state.hints : '', L.RESULT_LEFT_X, L.RESULT_RIGHT_X);

  drawPlot(ctx, L.RESULT_PLOT, state.records || []);
  drawFooterHint(ctx, 'PLAY again  BACK list');
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
 * Multiple choice: the grid is the question, the screen is the answer sheet.
 *
 * Three options stacked with the chosen one inverted, exactly as the settings
 * list marks its row, so the jog behaves the way it already does everywhere
 * else. The staff plays no part — what is being asked is lit on the pads.
 */
export function drawPick(ctx, state) {
  const options = state.options || [];
  ctx.clear();
  R.drawChrome(ctx, { left: state.title || 'NAME', right: state.score || '' });

  const msg = truncate(ctx, state.hint || 'which pad is lit?', L.TEXT_MAX_PX);
  ctx.text((L.SCREEN_W - ctx.textWidth(msg)) >> 1, 10, msg, 1);

  const rowH = 11;
  const top = 21;
  for (let i = 0; i < options.length; i++) {
    const y = top + i * rowH;
    const selected = i === state.index;
    const text = options[i];
    const tw = ctx.textWidth(text);
    const x = (L.SCREEN_W - tw) >> 1;
    const struck = state.eliminated && state.eliminated.indexOf(i) >= 0;
    if (selected) {
      ctx.fillRect(x - 5, y - 2, tw + 10, rowH - 1, 1);
      ctx.text(x, y, text, 0);
    } else {
      ctx.text(x, y, text, 1);
    }
    /* A hint strikes an option through rather than removing it: the list
     * keeps its shape, so the remaining choice does not jump under your hand. */
    if (struck) ctx.fillRect(x - 3, y + 3, tw + 6, 1, selected ? 0 : 1);
  }

  if (state.footer) drawFooterHint(ctx, state.footer);
  return ctx;
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
    const label = typeof row === 'string' ? row : row.label;
    let value = typeof row === 'string' ? '' : row.value || '';
    /* Brackets mark the row the jog is currently changing, so "turn to change"
     * has something to point at. */
    if (value && selected && opts.editing) value = '[' + value + ']';
    /* The label is fitted against what the value actually takes, not against a
     * fixed budget: the widest real row is 114px, but a longer value added
     * later would otherwise be printed over the end of its own label. */
    const vw = value ? ctx.textWidth(value) : 0;
    ctx.text(2, y, truncate(ctx, label, L.SCREEN_W - 4 - vw - (vw ? 4 : 0)), selected ? 0 : 1);
    if (value) ctx.text(L.SCREEN_W - vw - 2, y, value, selected ? 0 : 1);
  }
  if (opts.footer) {
    if (opts.centreFooter) drawFooterHint(ctx, opts.footer);
    else ctx.text(2, L.FOOTER_Y - 1, truncate(ctx, opts.footer, L.SCREEN_W - 4), 1);
  }
  return ctx;
}
