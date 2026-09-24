/*
 * levels.mjs — the lesson ladder. Pure, and a leaf: it imports nothing.
 *
 * A song is written ONCE, with every event tagged `hand: "l" | "r"`, and the
 * four levels are PROJECTIONS of that one file rather than four files:
 *
 *   1r  right hand, top note only     melody, single notes
 *   1l  left hand, bottom note only   the bass line, single notes
 *   2r  right hand as written         melody with its chords
 *   3   everything                    both hands
 *
 * Deriving rather than duplicating buys three things. The four levels are
 * provably the same piece — a wrong note is fixed once. Fourteen files are
 * parsed at boot instead of fifty-six, and ui.js reads every one of them
 * eagerly. And, most of all, derivation never TRANSPOSES: level 1's right hand
 * is played on the same pads as level 3's right hand, so what you learn at the
 * bottom of the ladder transfers literally instead of by analogy.
 *
 * That last property is why the reduce step takes the top note of a right-hand
 * chord and the bottom note of a left-hand one, rather than, say, always the
 * root: the melody is the top voice and the bass is the bottom one, and either
 * choice would otherwise move a note to a pad it does not live on at level 3.
 */

/*
 * `step` is the two characters the list prints in its value column, `label`
 * what the row says. Order is the ladder — the menu shows them top to bottom.
 */
export const LEVELS = [
  { id: '1r', step: 'L1', label: 'RH melody', hand: 'r', reduce: 'top' },
  { id: '1l', step: 'L1', label: 'LH bass', hand: 'l', reduce: 'bottom' },
  { id: '2r', step: 'L2', label: 'RH chords', hand: 'r', reduce: 'none' },
  { id: '3', step: 'L3', label: 'Both hands', hand: 'lr', reduce: 'none' },
];

export function levelById(id) {
  for (let i = 0; i < LEVELS.length; i++) {
    if (LEVELS[i].id === id) return LEVELS[i];
  }
  return null;
}

/* The rows the level menu draws, in ladder order. */
export function levelRows() {
  return LEVELS.map((lv) => ({ label: lv.label, value: lv.step, level: lv.id }));
}

function reduce(pitches, how) {
  if (how === 'top') return [pitches[pitches.length - 1]];
  if (how === 'bottom') return [pitches[0]];
  return pitches.slice();
}

/*
 * Level 3 has to MERGE events that land on the same beat, and this is the one
 * part of the projection that is load-bearing rather than tidy.
 *
 * scoring.createRun turns each event into one entry and walks a single cursor,
 * so a left-hand event and a right-hand event on beat 0 would be scored one
 * after the other — you would have to play the bass note before the grid would
 * accept the melody note above it. And chart.labelLimitPx sizes a name-lane
 * label by the distance to the next event, which for two events at the same
 * beat is zero, so one of the two names would be clipped to nothing.
 *
 * The merged event takes the LONGER duration. `durBeats` is read in exactly two
 * places — chartTotalBeats, and the note-off schedule Listen uses — and never
 * by scoring, which is onset-only. So the whole cost is that in Listen a
 * melody note under a held bass note rings as long as the bass note does. On a
 * decaying piano that is inaudible; it is written down because it is the one
 * thing the merge gives up.
 */
function mergeSameBeat(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const last = out[out.length - 1];
    if (last && last.beat === e.beat) {
      const seen = {};
      for (let n = 0; n < last.pitches.length; n++) seen[last.pitches[n]] = 1;
      for (let n = 0; n < e.pitches.length; n++) {
        if (!seen[e.pitches[n]]) last.pitches.push(e.pitches[n]);
      }
      last.pitches.sort((a, b) => a - b);
      if (e.durBeats > last.durBeats) last.durBeats = e.durBeats;
      continue;
    }
    out.push({ beat: e.beat, durBeats: e.durBeats, pitches: e.pitches.slice() });
  }
  return out;
}

/*
 * A chart for one rung of the ladder. Returns null for an unknown level id, and
 * for a level a song has no material for — a melody-only file has no `1l`.
 */
export function projectLevel(song, levelId) {
  const lv = levelById(levelId);
  if (!lv || !song || !Array.isArray(song.events)) return null;

  const kept = [];
  for (let i = 0; i < song.events.length; i++) {
    const e = song.events[i];
    const hand = e.hand || 'r';
    if (lv.hand.indexOf(hand) < 0) continue;
    kept.push({
      beat: e.beat,
      durBeats: e.durBeats == null ? 1 : e.durBeats,
      pitches: reduce(e.pitches, lv.reduce),
    });
  }
  if (!kept.length) return null;

  /* Events arrive beat-ordered from normalizeExercise, but a file lists a bar's
   * left hand and right hand in whatever order reads best, so two hands on one
   * beat can arrive either way round. Sorting here is what lets mergeSameBeat
   * look only at its immediate predecessor. */
  kept.sort((a, b) => a.beat - b.beat);

  return {
    id: song.id + ':' + lv.id,
    name: song.name + ' ' + lv.step,
    bpm: song.bpm,
    timeSig: song.timeSig ? song.timeSig.slice() : [4, 4],
    keySig: song.keySig == null ? 0 : song.keySig,
    events: mergeSameBeat(kept),
    source: 'file',
  };
}

/*
 * Which rungs this song actually has.
 *
 * Two filters, and the second one matters more than it looks. A level with no
 * material is dropped — a melody-only file has no `1l`. And a level that comes
 * out IDENTICAL to one already on the ladder is dropped too, which is what
 * keeps the three technique drills honest: a scale of single right-hand notes
 * is the same chart at `1r` and at `2r`, and offering it twice would say there
 * is something to progress to when there is not. `triads-i-iv-v` keeps both,
 * because the top line of its triads really is a different exercise from the
 * triads.
 */
export function availableLevels(song) {
  const out = [];
  const seen = [];
  for (let i = 0; i < LEVELS.length; i++) {
    const chart = projectLevel(song, LEVELS[i].id);
    if (!chart) continue;
    const shape = JSON.stringify(chart.events);
    if (seen.indexOf(shape) >= 0) continue;
    seen.push(shape);
    out.push(LEVELS[i]);
  }
  return out;
}
