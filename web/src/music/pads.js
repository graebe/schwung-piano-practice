// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * pads.js -- Move's pad grid as the browser draws it. Pure.
 *
 * The grid itself is the engine's (src/padmap.mjs): four rows of eight, pad
 * 68 bottom left, one semitone to the right and five up a row, transposed. The
 * answer bar is the engine's too (src/answer_pads.mjs). This file only decides
 * what each pad SHOWS, as a semantic state the stylesheet colours:
 *
 *   off      out of key                 a dark well
 *   scale    in key                     the dimmest lit value
 *   root     the key's root             a step brighter, its name in ink
 *   coming   the note is coming         a uv-deep outline: a ghost of what's next
 *   now      it is now / it sounds      uv, lit with glow-led
 *   held     your finger is on it       amber
 *   hit      you got it                 uv without the glow
 *   miss     you missed it              red
 *   answer   an answer pad              its answer colour (answer-blue ...)
 *   struck   an answer struck out       dark, as on the Move
 *
 * The Move lights a hit green; Ultraviolet has no green and says so (amber and
 * red are its only other hues, and they are states). In the browser a hit is
 * the system's own "on", and a miss its red: the same two meanings, in the
 * window's language.
 */
import { PAD_FIRST, DEFAULT_TRANSPOSE, padPitch, padRowCol, scalePcSet, padBaseColor,
  LED_ROOT, LED_SCALE } from '../../../src/padmap.mjs';
import { answerPads, answerColour, inAnswerBar } from '../../../src/answer_pads.mjs';

export const ROWS = 4;
export const COLS = 8;

/** Note states a caller may give per pitch, strongest first. */
export const NOTE_STATES = ['miss', 'hit', 'held', 'now', 'coming'];

/** The pads, top row first and each row left to right: the grid as it is
 * seen from the player's side. */
export function padRows() {
  const rows = [];
  for (let r = ROWS - 1; r >= 0; r--) {
    const row = [];
    for (let c = 0; c < COLS; c++) row.push(PAD_FIRST + r * COLS + c);
    rows.push(row);
  }
  return rows;
}

/** What a pad shows of the key: 'root', 'scale' or 'off'. Without a root
 * there is no key, and every pad is a plain well. */
export function keyState(pad, transpose, rootPc, intervals) {
  if (rootPc === undefined || rootPc === null) return 'off';
  const led = padBaseColor(pad, transpose, scalePcSet(rootPc, intervals), rootPc);
  return led === LED_ROOT ? 'root' : led === LED_SCALE ? 'scale' : 'off';
}

const stateOf = (states, pitch) => {
  if (!states) return undefined;
  if (states instanceof Map) return states.get(pitch);
  return states[pitch];
};

/**
 * Every pad's view: { pad, row, col, pitch, state, answer, inert }.
 *
 *   transpose   the grid's transpose (padmap's DEFAULT_TRANSPOSE, +12, if absent)
 *   rootPc      the key's root pitch class, or null for no key colouring
 *   intervals   the scale, as semitones above the root (padmap's major if absent)
 *   states      pitch -> one of NOTE_STATES, a Map or a plain object; every
 *               pad that sounds the pitch shows it, as every twin counts
 *   answers     [{ struck }] -- the answer bar: its pads show their colours,
 *               and the dark pads between them are inert, as on the Move
 *
 * A note state outranks the key; the answer bar outranks both.
 */
export function padViews({ transpose = DEFAULT_TRANSPOSE, rootPc = null, intervals, states, answers } = {}) {
  const count = answers?.length ?? 0;
  const answerAt = new Map(answerPads(count).map((pad, i) => [pad, i]));
  const out = [];
  for (const row of padRows()) {
    for (const pad of row) {
      const { row: r, col } = padRowCol(pad);
      const pitch = padPitch(pad, transpose);
      const view = { pad, row: r, col, pitch, state: 'off', answer: null, inert: false };
      if (inAnswerBar(count, pad)) {
        view.inert = true;
        if (answerAt.has(pad)) {
          const i = answerAt.get(pad);
          const struck = !!answers[i]?.struck;
          view.answer = { ...answers[i], index: i, colour: answerColour(i).name, label: answers[i]?.label ?? '' };
          view.state = struck ? 'struck' : 'answer';
        }
      } else {
        const s = stateOf(states, pitch);
        view.state = NOTE_STATES.includes(s) ? s : keyState(pad, transpose, rootPc, intervals);
      }
      out.push(view);
    }
  }
  return out;
}
