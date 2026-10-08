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
 * sit through. They are kept out of the way of the answer itself: the chime
 * sits above the pads, the uh-oh below, so neither is mistaken for a note of
 * the question.
 *
 * Each cue is [{ pitch, at, dur, vel }], milliseconds from now.
 */

const CHIME_OCTAVE = 84;     /* C6: above the pads (they end at G5) */
const UHOH_OCTAVE = 36;      /* C2: below them in every key (they start at A3) */

export function successCue(rootPc = 0) {
  const root = CHIME_OCTAVE + (((rootPc % 12) + 12) % 12);
  const notes = [0, 4, 7, 12];
  const vels = [46, 52, 58, 66];
  return notes.map((iv, i) => ({ pitch: root + iv, at: i * 55, dur: 420 - i * 40, vel: vels[i] }));
}

export function failureCue(rootPc = 0) {
  const root = UHOH_OCTAVE + (((rootPc % 12) + 12) % 12);
  /* Down from the 5th to the 3rd: sol-mi. */
  return [
    { pitch: root + 7, at: 0, dur: 200, vel: 44 },
    { pitch: root + 4, at: 170, dur: 320, vel: 38 },
  ];
}
