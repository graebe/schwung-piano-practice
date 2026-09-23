/*
 * staff_render.mjs — every glyph the reading view draws.
 *
 * Draws through a `ctx` object rather than calling the host globals directly.
 * On the Move `ctx` is a thin wrapper over clear_screen/fill_rect/draw_line/
 * print (one extra property lookup per call, ~nothing next to the ~490ns
 * QuickJS binding crossing); in tests it is a 128x64 byte buffer. That is what
 * makes the rendering testable and `npm run preview` possible.
 *
 * ctx: { clear(), fillRect(x,y,w,h,v), drawRect(x,y,w,h,v),
 *        line(x0,y0,x1,y1,v), text(x,y,s,v), textWidth(s) }
 */

import * as L from './layout.mjs';
import { ledgerYs } from './notation.mjs';

/* ---- Treble clef -------------------------------------------------------- */
/*
 * 13x33, drawn to y 12..44 so the spiral sits over the G line (y=32) and the
 * tail drops below the staff. Authored as text because that is the only way to
 * edit a 1-bit glyph sanely; converted to horizontal runs once at import time
 * and blitted with fill_rect, never with per-pixel writes (~45 runs = 22us vs
 * 125us for 255 set_pixel calls).
 */
export const CLEF_ROWS = [
  '.......###...',
  '......##..##.',
  '.....##....#.',
  '.....##......',
  '.....###.....',
  '......##.....',
  '......##.....',
  '......##.....',
  '......##.....',
  '......##.....',
  '......##.....',
  '.....###.....',
  '....####.....',
  '...###.##....',
  '..###...##...',
  '..##....##...',
  '.##.....##...',
  '.##.....##...',
  '##......##...',
  '##......##...',
  '##......##...',
  '##......##...',
  '.##.....##...',
  '.##.....##...',
  '..##....##...',
  '..###...##...',
  '...###.##....',
  '....#####....',
  '.....###.....',
  '....####.....',
  '..####.......',
  '.###.........',
  '##...........',
];

/* [dx, dy, width] horizontal runs. */
export function rowsToRuns(rows) {
  const runs = [];
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    let x = 0;
    while (x < row.length) {
      if (row[x] === '#') {
        const start = x;
        while (x < row.length && row[x] === '#') x++;
        runs.push([start, y, x - start]);
      } else {
        x++;
      }
    }
  }
  return runs;
}

const CLEF_RUNS = rowsToRuns(CLEF_ROWS);

export function drawClef(ctx, x = L.CLEF_X, y = L.CLEF_Y) {
  for (let i = 0; i < CLEF_RUNS.length; i++) {
    const r = CLEF_RUNS[i];
    ctx.fillRect(x + r[0], y + r[1], r[2], 1, 1);
  }
}

/* ---- Accidentals -------------------------------------------------------- */
const SHARP_ROWS = ['#.#', '###', '#.#', '###', '#.#'];
const FLAT_ROWS = ['#..', '#..', '##.', '#.#', '##.'];
const SHARP_RUNS = rowsToRuns(SHARP_ROWS);
const FLAT_RUNS = rowsToRuns(FLAT_ROWS);

export function drawAccidental(ctx, x, y, alter) {
  const runs = alter > 0 ? SHARP_RUNS : alter < 0 ? FLAT_RUNS : null;
  if (!runs) return;
  const top = y - ((L.ACCIDENTAL_H - 1) >> 1);
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    ctx.fillRect(x + r[0], top + r[1], r[2], 1, 1);
  }
}

/* ---- Transport glyph ---------------------------------------------------- */
/*
 * A filled right-pointing triangle, drawn as one fill_rect per row. Used in the
 * ready prompt because "PLAY" as a word is ambiguous at a keyboard — it is both
 * a button and the thing you do with your hands — while the transport symbol is
 * only ever the button.
 */
export function drawPlayGlyph(ctx, x, y, h) {
  const height = h | 1; /* odd, so the tip is a single row */
  const half = (height - 1) >> 1;
  for (let row = 0; row < height; row++) {
    const w = half + 1 - Math.abs(row - half);
    ctx.fillRect(x, y + row, w, 1, 1);
  }
}

export function playGlyphWidth(h) {
  return ((h | 1) - 1) / 2 + 1;
}

/* ---- Big digits --------------------------------------------------------- */
/*
 * 3x5 digits blown up by whole-pixel blocks, for the count-in. The host font
 * has no size argument (size comes only from set_font), and draw_image
 * re-decodes its PNG on every call, so a scaled bitmap is the only way to get
 * a number big enough to read at a glance without paying for it every frame.
 */
const GLYPH_ROWS = {
  0: ['###', '#.#', '#.#', '#.#', '###'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],  /* with a foot: a bare bar reads as a stroke */
  2: ['###', '..#', '###', '#..', '###'],
  3: ['###', '..#', '###', '..#', '###'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
  5: ['###', '#..', '###', '..#', '###'],
  6: ['###', '#..', '###', '#.#', '###'],
  7: ['###', '..#', '..#', '..#', '..#'],
  8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '###'],
  /* Note names: the seven letters, plus the two accidentals. */
  A: ['###', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['###', '#..', '#..', '#..', '###'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '###', '#..', '###'],
  F: ['###', '#..', '###', '#..', '#..'],
  G: ['###', '#..', '#.#', '#.#', '###'],
  '#': ['#.#', '###', '#.#', '###', '#.#'],
  b: ['#..', '#..', '##.', '#.#', '##.'],
  ' ': ['...', '...', '...', '...', '...'],
};

export const DIGIT_W = 3;
export const DIGIT_H = 5;
export const BIG_GAP = 1;   /* columns between characters, before scaling */

export function bigDigitWidth(scale) {
  return DIGIT_W * scale;
}

export function bigDigitHeight(scale) {
  return DIGIT_H * scale;
}

export function bigTextWidth(text, scale) {
  if (!text.length) return 0;
  return text.length * (DIGIT_W + BIG_GAP) * scale - BIG_GAP * scale;
}

export function drawBigDigit(ctx, x, y, digit, scale) {
  const rows = GLYPH_ROWS[digit];
  if (!rows) return;
  for (let r = 0; r < DIGIT_H; r++) {
    const row = rows[r];
    let c = 0;
    while (c < DIGIT_W) {
      if (row[c] === '#') {
        const start = c;
        while (c < DIGIT_W && row[c] === '#') c++;
        ctx.fillRect(x + start * scale, y + r * scale, (c - start) * scale, scale, 1);
      } else {
        c++;
      }
    }
  }
}

/*
 * A whole string in the big font — used to name the note the scroll is stuck
 * on. Reading the staff is the skill, but when you are stuck you need telling,
 * not testing, so it wants to be legible without being read.
 */
export function drawBigText(ctx, x, y, text, scale) {
  let cx = x;
  for (let i = 0; i < text.length; i++) {
    drawBigDigit(ctx, cx, y, text[i], scale);
    cx += (DIGIT_W + BIG_GAP) * scale;
  }
}

/* The Record symbol: a filled disc, to sit beside the play triangle. */
export function drawRecordGlyph(ctx, x, y, d) {
  const size = d | 1;
  const r = (size - 1) >> 1;
  for (let row = 0; row < size; row++) {
    /* Clip the corners so it reads round rather than square. */
    const inset = Math.abs(row - r) === r ? 1 : 0;
    ctx.fillRect(x + inset, y + row, size - inset * 2, 1, 1);
  }
}

export function recordGlyphWidth(d) {
  return d | 1;
}

/* ---- Staff -------------------------------------------------------------- */
export function drawStaff(ctx) {
  for (let i = 0; i < L.STAFF_LINE_YS.length; i++) {
    ctx.fillRect(L.STAFF_LEFT_X, L.STAFF_LINE_YS[i], L.SCREEN_W - L.STAFF_LEFT_X, 1, 1);
  }
}

/* The "now" line. `strong` thickens it on the beat. */
export function drawHitLine(ctx, strong = false) {
  const h = L.HIT_LINE_BOTTOM_Y - L.HIT_LINE_TOP_Y + 1;
  ctx.fillRect(L.HIT_X, L.HIT_LINE_TOP_Y, strong ? 2 : 1, h, 1);
}

export function drawBarLine(ctx, x) {
  if (x < L.DESPAWN_X || x >= L.SCREEN_W) return;
  const h = L.STAFF_BOTTOM_Y - L.STAFF_TOP_Y + 1;
  ctx.fillRect(Math.round(x), L.STAFF_TOP_Y, 1, h, 1);
}

/* ---- Noteheads ---------------------------------------------------------- */
/*
 * state: 'pending' | 'hit' | 'missed'
 *   pending  5x3 head
 *   hit      7x5 solid block — "it gets fatter"
 *   missed   5x5 X
 */
/*
 * A 5x5 ring, used both for a notehead you hit and for the marker showing where
 * you actually played. Deliberately the same glyph: play in time and the two
 * land on top of each other as one mark; play late and you see two, and the gap
 * between them is your error, read straight off the staff.
 *
 * Authored as rows and blitted as runs like the clef, rather than the host's
 * draw_circle — that is draw_arc underneath, and the desktop test buffer would
 * have to reproduce its rasterisation exactly or the rendering tests would be
 * asserting a shape the Move never draws.
 */
export const RING_ROWS = [
  '.###.',
  '#...#',
  '#...#',
  '#...#',
  '.###.',
];

const RING_RUNS = rowsToRuns(RING_ROWS);

export function drawRing(ctx, cx, cy) {
  const half = L.RING >> 1;
  for (let i = 0; i < RING_RUNS.length; i++) {
    const r = RING_RUNS[i];
    ctx.fillRect(cx - half + r[0], cy - half + r[1], r[2], 1, 1);
  }
}

/* Where a key actually went down: same ring, placed at the true time. */
export function drawPlayedMarker(ctx, x, y) {
  drawRing(ctx, Math.round(x), y);
}

export function drawNote(ctx, x, y, state, alter = 0) {
  const cx = Math.round(x);
  if (state === 'hit') {
    drawRing(ctx, cx, y);
  } else if (state === 'missed') {
    const r = L.HEAD_MISS >> 1;
    ctx.line(cx - r, y - r, cx + r, y + r, 1);
    ctx.line(cx - r, y + r, cx + r, y - r, 1);
  } else {
    ctx.fillRect(cx - (L.HEAD_W >> 1), y - (L.HEAD_H >> 1), L.HEAD_W, L.HEAD_H, 1);
  }
  if (alter !== 0 && cx >= L.ACCIDENTAL_MIN_X) {
    drawAccidental(ctx, cx + L.ACCIDENTAL_DX, y, alter);
  }
}

/* Ledger lines for one note, clipped to the staff area. */
export function drawLedgers(ctx, x, y) {
  const cx = Math.round(x);
  const ys = ledgerYs(y);
  for (let i = 0; i < ys.length; i++) {
    const ly = ys[i];
    if (ly < L.STAFF_AREA_TOP_Y || ly > L.STAFF_AREA_BOTTOM_Y) continue;
    ctx.fillRect(cx - (L.LEDGER_W >> 1), ly, L.LEDGER_W, 1, 1);
  }
}

/*
 * One scrolling entry: the stacked noteheads of a chord plus its name.
 * item = { x, notes: [{ y, state, alter }], label, labelLimitPx }
 */
export function drawEntry(ctx, item) {
  for (let i = 0; i < item.notes.length; i++) {
    const n = item.notes[i];
    drawLedgers(ctx, item.x, n.y);
  }
  for (let i = 0; i < item.notes.length; i++) {
    const n = item.notes[i];
    drawNote(ctx, item.x, n.y, n.state, n.alter);
  }
  separateStackedHeads(ctx, item);
  if (item.label) drawLabel(ctx, item.x, item.label, item.labelLimitPx);
}

/*
 * Keep stacked noteheads from merging into a bar.
 *
 * A root-position triad puts its heads a third apart — 4px here — and a head is
 * 3px tall, so only a single row separates them. When that row happens to be a
 * staff line, the line fills the gap and the chord renders as one solid block.
 * Engraving gets this for free from white space around an oval notehead; at
 * 5x3 on a 1-bit screen it has to be cut deliberately.
 *
 * Only between adjacent heads of a chord, and only where they are close enough
 * to touch: a single note must keep the staff lines running past it.
 */
function separateStackedHeads(ctx, item) {
  if (item.notes.length < 2) return;
  const ys = item.notes.map((n) => n.y).sort((a, b) => a - b);
  const cx = Math.round(item.x);
  const half = L.HEAD_W >> 1;
  for (let i = 1; i < ys.length; i++) {
    const gap = ys[i] - ys[i - 1];
    if (gap <= 0 || gap > L.STEP_PX * 2) continue;
    const mid = (ys[i - 1] + ys[i]) >> 1;
    ctx.fillRect(cx - half, mid, L.HEAD_W, 1, 0);
  }
}

/*
 * Name lane. Labels are left-aligned under the notehead and truncated to the
 * gap before the next entry, so a dense passage degrades to "F#" rather than
 * overprinting its neighbour.
 */
export function drawLabel(ctx, x, label, limitPx) {
  let text = label;
  if (limitPx != null && limitPx > 0) {
    while (text.length > 0 && ctx.textWidth(text) > limitPx) text = text.slice(0, -1);
  }
  if (!text) return;
  const lx = Math.round(x) - 2;
  if (lx + ctx.textWidth(text) < L.DESPAWN_X || lx >= L.SCREEN_W) return;
  ctx.text(lx, L.NAME_LANE_Y, text, 1);
}

/* ---- Chrome ------------------------------------------------------------- */
export function drawChrome(ctx, info) {
  ctx.fillRect(0, 0, L.SCREEN_W, L.HEADER_H, 1);
  if (info.left) ctx.text(1, 0, info.left, 0);
  if (info.right) ctx.text(L.SCREEN_W - ctx.textWidth(info.right) - 1, 0, info.right, 0);
  if (info.mid) {
    ctx.text(((L.SCREEN_W - ctx.textWidth(info.mid)) >> 1), 0, info.mid, 0);
  }
  ctx.fillRect(0, L.HEADER_RULE_Y, L.SCREEN_W, 1, 1);
  ctx.fillRect(0, L.NAME_RULE_Y, L.SCREEN_W, 1, 1);
}

export function drawFooter(ctx, progress, right) {
  const w = Math.max(0, Math.min(1, progress)) * (L.SCREEN_W - 44);
  ctx.drawRect(1, L.FOOTER_Y, L.SCREEN_W - 44, L.PROGRESS_H, 1);
  if (w > 0) ctx.fillRect(1, L.FOOTER_Y, Math.round(w), L.PROGRESS_H, 1);
  if (right) ctx.text(L.SCREEN_W - ctx.textWidth(right) - 1, L.FOOTER_Y - 2, right, 1);
}
