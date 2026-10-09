// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * cues.mjs — the little sounds a quiz makes when you answer. Pure.
 *
 * Played on the module's own piano, like everything else, so they belong to
 * the instrument rather than sounding like a game console:
 *
 *   right   a quick rising arpeggio of the key's major chord, high and soft —
 *           root, 3rd, 5th, octave — a chime in the key you are working in
 *   wrong   a falling minor 3rd, low and quiet: the sung "uh-oh"
 *
 * Both are consonant on purpose. A wrong answer is information, not a
 * punishment, and a harsh buzz on every slip would make a round unpleasant to
 * sit through. The chime sits above the pads, out of the way of the answer.
 *
 * The uh-oh sits in the MIDDLE of the range, and that is a lesson from the
 * hardware: it first sat below the pads, at C2-G2, quiet — and on the Move's
 * small speaker that was silence. Under 100Hz the speaker gives almost
 * nothing back, and a soft strike on this piano is soft in its overtones too,
 * so there was nothing left to hear. It plays after a wrong answer, when no
 * note of the question is sounding, so sharing the pads' register costs
 * nothing.
 *
 * Each cue is [{ pitch, at, dur, vel }], milliseconds from now.
 */

const CHIME_OCTAVE = 84;     /* C6: above the pads (they end at G5) */
/* The uh-oh's upper note, the key's 5th, lands in D4..C#5 whatever the key. */
const UHOH_TOP_LO = 62;

export function successCue(rootPc = 0) {
  const root = CHIME_OCTAVE + (((rootPc % 12) + 12) % 12);
  const notes = [0, 4, 7, 12];
  const vels = [46, 52, 58, 66];
  return notes.map((iv, i) => ({ pitch: root + iv, at: i * 55, dur: 420 - i * 40, vel: vels[i] }));
}

export function failureCue(rootPc = 0) {
  const fifthPc = (((rootPc + 7) % 12) + 12) % 12;
  const top = UHOH_TOP_LO + ((fifthPc - (UHOH_TOP_LO % 12) + 12) % 12);
  /* Down from the 5th to the 3rd: sol-mi. */
  return [
    { pitch: top, at: 0, dur: 220, vel: 72 },
    { pitch: top - 3, at: 190, dur: 380, vel: 64 },
  ];
}
