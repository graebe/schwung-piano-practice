/*
 * choices.mjs — the wrong answers. Pure.
 *
 * In a three-way multiple choice the distractors ARE the difficulty. Two
 * obviously-wrong options make it a one-option quiz: you answer from a rough
 * sense of high-or-low without ever locating the pad, which is the one thing
 * the drill exists to teach.
 *
 * So the wrong options are the most confusable entries the pool has — a
 * semitone away, or the same chord root with a different quality.
 */

/*
 * How confusable two pool entries are: lower is more confusable, and therefore
 * a better distractor. The scale is arbitrary but the ordering is not.
 */
export function nearness(a, b) {
  const ap = a.pitches;
  const bp = b.pitches;

  /* Chords: the interesting confusion is the same root with another quality —
   * Cm7 against C7 against Cmaj7 — because that is the distinction a player
   * actually has to learn to hear and see. A different root is a much easier
   * tell. */
  if (ap.length > 1 || bp.length > 1) {
    if (ap[0] === bp[0]) return 1;                  /* same root, other quality */
    const rootGap = Math.abs(ap[0] - bp[0]);
    if (ap.length === bp.length) return 10 + rootGap;   /* same shape, moved */
    return 20 + rootGap;
  }

  /* Notes: a semitone out is the hardest miss to spot, then a tone. */
  const gap = Math.abs(ap[0] - bp[0]);
  if (gap === 0) return 0;
  if (gap % 12 === 0) return 6;    /* same note, wrong octave — a real mistake */
  return gap;                      /* 1 semitone is nearest, and so on */
}

function labelOf(entry, fallback) {
  return entry.label || (fallback ? fallback(entry.pitches) : entry.pitches.join(','));
}

/*
 * `count` options including the right one, shuffled.
 *
 * Every option comes from the pool, so each is a legitimate answer to some
 * question rather than a pitch that could never be asked. And no two options
 * may READ the same: two entries with different pitches can carry the same
 * label, and an option list with two identical lines has two right answers.
 */
export function buildChoices(pool, correct, rand, count = 3, labelFn = null) {
  /* No answer means no question. Only reachable from an empty pool, but the
   * caller maps straight over the result and a throw would take it down. */
  if (!correct || !correct.pitches) return [];
  const right = labelOf(correct, labelFn);
  const seen = { [right]: 1 };

  const candidates = [];
  for (let i = 0; i < pool.length; i++) {
    const entry = pool[i];
    if (entry === correct) continue;
    const label = labelOf(entry, labelFn);
    if (seen[label]) continue;      /* reads identically to something already in */
    seen[label] = 1;
    candidates.push({ entry, score: nearness(correct, entry) });
  }

  candidates.sort((a, b) => a.score - b.score);

  /*
   * Take from the nearest few rather than strictly the two nearest, so the same
   * answer does not always come with the same pair — otherwise you learn the
   * question rather than the note.
   */
  const want = Math.max(0, count - 1);
  const window = Math.min(candidates.length, Math.max(want, Math.min(5, candidates.length)));
  const picked = [];
  const taken = {};
  let guard = 40;
  while (picked.length < want && picked.length < candidates.length && guard-- > 0) {
    const at = Math.floor(rand() * window);
    if (taken[at]) continue;
    taken[at] = 1;
    picked.push(candidates[at].entry);
  }
  /* A tiny pool cannot supply distractors; give back what exists rather than
   * padding with duplicates or throwing. */
  for (let i = 0; picked.length < want && i < candidates.length; i++) {
    if (!taken[i]) { taken[i] = 1; picked.push(candidates[i].entry); }
  }

  const out = picked.concat([correct]);
  /* Fisher-Yates, so the answer is not always last. */
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}
