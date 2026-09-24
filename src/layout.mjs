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
