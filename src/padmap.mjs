/*
 * padmap.mjs — Move's isomorphic pad grid. Pure.
 *
 * The grid is 4 rows of 8, notes 68..99, bottom-left to top-right. A pad's
 * position in semitones is 9 + row*5 + col, so moving right is +1 semitone and
 * moving up a row is +5 — which means the same pitch appears on several pads
 * ("twins"), and any of them counts as the right note.
 *
 * Sounding pitch = absSemi + MIDI_BASE_NOTE + transpose. At transpose 0 that
 * spans A2..G4 (45..67), which sits almost entirely BELOW the treble staff —
 * so the module defaults to +12, giving A3..G5 and putting the whole staff
 * within reach.
 */

export const PAD_FIRST = 68;
export const PAD_LAST = 99;
export const PAD_COUNT = 32;
export const MIDI_BASE_NOTE = 36;
export const DEFAULT_TRANSPOSE = 12;
export const ABS_SEMI_LO = 9;   /* bottom-left pad  */
export const ABS_SEMI_HI = 31;  /* top-right pad    */

export function isPad(note) {
  return note >= PAD_FIRST && note <= PAD_LAST;
}

export function padRowCol(pad) {
  const base = pad - PAD_FIRST;
  const row = Math.floor(base / 8);
  return { row, col: base - row * 8 };
}

export function padAbsSemi(pad) {
  const { row, col } = padRowCol(pad);
  return ABS_SEMI_LO + row * 5 + col;
}

export function padPitch(pad, transpose = DEFAULT_TRANSPOSE) {
  return padAbsSemi(pad) + MIDI_BASE_NOTE + transpose;
}

/* Every pad that sounds this pitch — light or accept all of them. */
export function padsForPitch(pitch, transpose = DEFAULT_TRANSPOSE) {
  const want = pitch - MIDI_BASE_NOTE - transpose;
  const out = [];
  for (let pad = PAD_FIRST; pad <= PAD_LAST; pad++) {
    if (padAbsSemi(pad) === want) out.push(pad);
  }
  return out;
}

export function pitchRange(transpose = DEFAULT_TRANSPOSE) {
  return {
    lo: ABS_SEMI_LO + MIDI_BASE_NOTE + transpose,
    hi: ABS_SEMI_HI + MIDI_BASE_NOTE + transpose,
  };
}

/* The transpose that best centres `pitches` in the pad grid. */
export function fitTranspose(pitches) {
  if (!pitches.length) return DEFAULT_TRANSPOSE;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pitches) {
    if (p < lo) lo = p;
    if (p > hi) hi = p;
  }
  const mid = (lo + hi) / 2;
  const gridMid = (ABS_SEMI_LO + ABS_SEMI_HI) / 2 + MIDI_BASE_NOTE;
  return Math.round(mid - gridMid);
}

/* ---- LED colours (indices into Schwung's 0..127 palette) ---------------- */
export const LED_OFF = 0;
export const LED_ROOT = 120;      /* White      */
export const LED_SCALE = 1;       /* BrightRed  */
export const LED_PRESSED = 8;     /* BrightYellow */
export const LED_TARGET_FAR = 95; /* DimAzure   */
export const LED_TARGET_NEAR = 16;/* AzureBlue  */
export const LED_HIT = 126;       /* Green      */
export const LED_MISS = 127;      /* Red        */

const MAJOR_PCS = [0, 2, 4, 5, 7, 9, 11];

export function scalePcSet(rootPc, intervals = MAJOR_PCS) {
  const set = {};
  for (const iv of intervals) set[(((rootPc + iv) % 12) + 12) % 12] = true;
  return set;
}

export function padBaseColor(pad, transpose, scaleSet, rootPc) {
  const pc = (((padPitch(pad, transpose) % 12) + 12) % 12);
  if (pc === (((rootPc % 12) + 12) % 12)) return LED_ROOT;
  return scaleSet[pc] ? LED_SCALE : LED_OFF;
}
