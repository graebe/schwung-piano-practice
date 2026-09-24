/*
 * layout.mjs — every screen coordinate the module uses, in one leaf module.
 *
 * A LEAF: it imports nothing, on purpose. The renderer, the scroll engine and
 * the desktop preview harness all read their geometry from here, so the staff
 * can be re-proportioned by editing this file alone and re-running
 * `npm run preview`.
 *
 * Screen is 128x64 and 1-bit: every colour argument is truthy/falsy only.
 *
 *   y 0..6    header (title, tempo, bar.beat, score)
 *   y 8       rule
 *   y 10..45  staff area  — 5 lines 4px apart, 2 ledger steps either side
 *   y 47      rule
 *   y 48..56  note-name lane (scrolls with the notes)
 *   y 58..63  progress bar + combo
 */

export const SCREEN_W = 128;
export const SCREEN_H = 64;

/* ---- Header ------------------------------------------------------------- */
export const HEADER_H = 7;
export const HEADER_RULE_Y = 8;

/* ---- Staff -------------------------------------------------------------- */
/* One diatonic step (line -> adjacent space) is STEP_PX pixels, so a
 * line-to-line gap is 2*STEP_PX. At 2px/step the five lines land on
 * 20,24,28,32,36 and two ledger steps fit either side inside the area. */
export const STEP_PX = 2;
export const STAFF_LINE_GAP = STEP_PX * 2;
export const STAFF_TOP_Y = 20;                       /* F5, top line        */
export const STAFF_BOTTOM_Y = STAFF_TOP_Y + 4 * STAFF_LINE_GAP;  /* E4 = 36 */
export const STAFF_LINE_YS = [20, 24, 28, 32, 36];
export const STAFF_LEFT_X = 13;   /* lines begin where the clef ends */

/* The anchor the pitch->y mapping is built on: E4 sits on the bottom line.
 * E4 = MIDI 64, diatonic index 4*7 + 2 = 30 (see notation.mjs). */
export const ANCHOR_DIATONIC = 30;
export const ANCHOR_Y = STAFF_BOTTOM_Y;

/* Playable window: two ledger steps above F5 and below E4. */
export const STAFF_AREA_TOP_Y = 10;
export const STAFF_AREA_BOTTOM_Y = 45;

/* ---- Clef --------------------------------------------------------------- */
export const CLEF_X = 1;
export const CLEF_Y = 12;   /* top row of the clef bitmap                    */

/* ---- Scroll ------------------------------------------------------------- */
export const HIT_X = 30;            /* the "now" line                        */
export const SPAWN_X = SCREEN_W;    /* notes enter here                      */
export const DESPAWN_X = 20;        /* ...and vanish shortly before the clef */
export const ACCIDENTAL_MIN_X = 26; /* below this the accidental is clipped  */
/*
 * Where a note the scroll is frozen on is pinned, if its own position would put
 * it off screen. A frozen note sits at hitX - grace*pxPerBeat, which at a wide
 * read-ahead lands past DESPAWN_X and is filtered out — so the one note you are
 * being asked to play is the one that is not drawn. At or above
 * ACCIDENTAL_MIN_X on purpose, so a missed F# still shows its sharp.
 */
export const BLOCKED_MIN_X = 27;
/* Bar lines sit just before their downbeat, as engraved, so they do not cut
 * through the notehead that falls on beat 1. */
export const BAR_OFFSET_PX = -4;
export const HIT_LINE_TOP_Y = 16;
export const HIT_LINE_BOTTOM_Y = 40;

export const PX_PER_BEAT_DEFAULT = 24;
export const PX_PER_BEAT_MIN = 12;
export const PX_PER_BEAT_MAX = 48;

/* ---- Note glyphs -------------------------------------------------------- */
export const HEAD_W = 5;            /* pending notehead                      */
export const HEAD_H = 3;
export const HEAD_MISS = 5;         /* the X is HEAD_MISS square             */
export const RING = 5;              /* hit notehead, and the played marker   */
export const LEDGER_W = 9;
export const ACCIDENTAL_DX = -6;    /* glyph origin relative to head centre  */
export const ACCIDENTAL_W = 3;
export const ACCIDENTAL_H = 5;

/* ---- Name lane ---------------------------------------------------------- */
export const NAME_RULE_Y = 47;
export const NAME_LANE_Y = 49;

/* ---- Footer ------------------------------------------------------------- */
export const FOOTER_Y = 58;
export const PROGRESS_H = 3;

/* ---- Text metrics ------------------------------------------------------- */
/*
 * The host font is a 5px glyph on a 6px advance, and a line occupies 7 rows
 * once descenders are counted. TEXT_H is what every band below is measured
 * against, and what the layout audit uses to decide that two lines collide.
 *
 * 21 characters is 126px, so TEXT_MAX_PX is the real limit on any single line:
 * past it the host simply stops plotting and a number goes missing in silence.
 */
export const TEXT_H = 7;
export const TEXT_MAX_PX = SCREEN_W - 2;

/* ---- Round result ------------------------------------------------------- */
/*
 * Two columns, so no pair of cells can collide whatever the numbers do: the
 * left cell starts at RESULT_LEFT_X, the right one is right-aligned to
 * RESULT_RIGHT_X, and each is fitted to its own budget before it is drawn.
 *
 *   y 10..24  the rate, big        y 26..32  row A
 *   y 34..40  row B                y 42..53  the chart
 */
export const RESULT_BIG_Y = 10;
export const RESULT_BIG_SCALE = 3;          /* 15px tall; scale 4 left no room */
export const RESULT_LEFT_X = 3;
export const RESULT_RIGHT_X = SCREEN_W - 3;
export const RESULT_ROW_A_Y = 26;
export const RESULT_ROW_B_Y = 34;
export const RESULT_PLOT = { x: 3, y: 42, w: SCREEN_W - 6, h: 12 };

/* ---- Progress ----------------------------------------------------------- */
export const PROGRESS_TITLE_Y = 9;
export const PROGRESS_PLOT = { x: 3, y: 17, w: SCREEN_W - 6, h: 30 };
export const PROGRESS_ROW_Y = 48;

/* The share of a plot's height given to the error bars, which grow up from the
 * baseline while the rate line lives above them. A third leaves the line the
 * two thirds it needs to read as a trend at either box size. */
export const PLOT_ERR_FRACTION = 1 / 3;
export const PLOT_ERR_MIN_H = 3;
/*
 * What a full-height error bar means. Against the true 0..100% the band is
 * ~10px, so a typical 13% round drew one pixel and the series read as noise.
 * A fixed ceiling keeps two visits comparable — scaling to the series maximum
 * would redraw the same history differently every time a bad round dropped off
 * the end — and 50% wrong is already far worse than any drill should get.
 */
export const PLOT_ERR_FULL = 0.5;
