/*
 * guess.mjs — the note guesser. Pure: no host calls, no rendering, no clock.
 *
 * A different skill from the scrolling reader. The Move's grid is isomorphic —
 * one semitone right, five semitones up — so the same pitch appears on several
 * pads and nothing looks like a keyboard. Finding a pitch is its own problem,
 * and the reading mode can never drill it because the note is always moving.
 * Here it sits still, named, until you play it.
 */

import { MODES, scalePitches, playableRange, triadOn, fitsTriad, rng } from './generator.mjs';
import { inStaffRange } from './notation.mjs';
import { DEFAULT_TRANSPOSE } from './padmap.mjs';

export const NOTES = 'notes';
export const CHORDS = 'chords';

export const CORRECT = 'correct';
export const WRONG = 'wrong';
export const INCOMPLETE = 'incomplete';

/*
 * Everything the quiz can ask, worked out once at the start.
 *
 * Constrained three ways at once: in the key, drawable on the staff, and
 * reachable on a pad. A prompt that fails any of those is unanswerable — it
 * would be invisible, or there would be no pad for it.
 */
function buildPool(kind, rootPc, mode, transpose, halfTones) {
  const { lo, hi } = playableRange(transpose);
  const scale = scalePitches(rootPc, MODES[mode] ? mode : 'major', lo, hi);
  const pool = [];

  if (kind === CHORDS) {
    /* Chords stay diatonic whatever the note pool does. A triad is built from
     * the scale by definition; "a chromatic triad" would mean picking a root
     * and a quality, which is a different drill from this one. */
    for (let i = 0; i < scale.length; i++) {
      if (!fitsTriad(scale, i)) continue;
      const chord = triadOn(scale, i);
      if (chord.length < 3) continue;
      if (!chord.every((p) => inStaffRange(p))) continue;
      pool.push(chord);
    }
    return pool;
  }

  if (halfTones) {
    /* Every semitone in reach, not just the seven of the key — the black notes
     * are the ones that are hard to find on an isomorphic grid, and skipping
     * them leaves five twelfths of the instrument undrilled. They are spelled
     * by the key signature, so C# in a sharp key and Db in a flat one. */
    for (let pitch = lo; pitch <= hi; pitch++) {
      if (inStaffRange(pitch)) pool.push([pitch]);
    }
    return pool;
  }

  for (let i = 0; i < scale.length; i++) {
    if (inStaffRange(scale[i])) pool.push([scale[i]]);
  }
  return pool;
}

export function createQuiz({
  kind = NOTES,
  rootPc = 0,
  mode = 'major',
  transpose = DEFAULT_TRANSPOSE,
  halfTones = false,
  seed = 1,
} = {}) {
  const quiz = {
    kind: kind === CHORDS ? CHORDS : NOTES,
    pool: buildPool(kind, rootPc, mode, transpose, halfTones),
    rand: rng(seed),
    prompt: [],
    held: [],
    asked: 0,
    correct: 0,
    wrong: 0,
    streak: 0,
    bestStreak: 0,
    solved: false,
    penalised: false,
  };
  nextPrompt(quiz);
  return quiz;
}

/* A new question. Never the same one twice running — a repeat reads as the
 * screen having failed to update. */
export function nextPrompt(quiz) {
  if (!quiz.pool.length) {
    quiz.prompt = [];
    return quiz.prompt;
  }
  const previous = quiz.prompt.join(',');
  let pick = quiz.pool[Math.floor(quiz.rand() * quiz.pool.length)];
  if (quiz.pool.length > 1) {
    let guard = 8;
    while (pick.join(',') === previous && guard-- > 0) {
      pick = quiz.pool[Math.floor(quiz.rand() * quiz.pool.length)];
    }
  }
  quiz.prompt = pick.slice();
  quiz.held = [];
  quiz.solved = false;
  quiz.penalised = false;
  quiz.asked++;
  return quiz.prompt;
}

function evaluate(quiz) {
  for (let i = 0; i < quiz.held.length; i++) {
    if (quiz.prompt.indexOf(quiz.held[i]) < 0) return WRONG;
  }
  /* Deduplicated on the way in, so equal lengths means the whole chord is
   * down — which is what makes a chord a chord rather than an arpeggio. */
  return quiz.held.length === quiz.prompt.length ? CORRECT : INCOMPLETE;
}

/*
 * A pad went down.
 *
 *   correct     the whole prompt is held
 *   wrong       something not in the prompt is held
 *   incomplete  a chord part-way down — not yet a mistake
 *
 * A wrong answer is counted but does NOT move on: the prompt stays until it is
 * played, which is the point of the mode.
 */
export function pressPitch(quiz, pitch) {
  if (quiz.solved) return CORRECT;
  /* Two pads can be the same pitch on this grid; count it once. */
  if (quiz.held.indexOf(pitch) < 0) quiz.held.push(pitch);

  const result = evaluate(quiz);
  if (result === CORRECT) {
    quiz.solved = true;
    quiz.correct++;
    quiz.streak++;
    if (quiz.streak > quiz.bestStreak) quiz.bestStreak = quiz.streak;
  } else if (result === WRONG && !quiz.penalised) {
    /* Once per prompt: holding a wrong note down should not keep scoring. */
    quiz.penalised = true;
    quiz.wrong++;
    quiz.streak = 0;
  }
  return result;
}

export function releasePitch(quiz, pitch) {
  const at = quiz.held.indexOf(pitch);
  if (at >= 0) quiz.held.splice(at, 1);
  if (!quiz.solved && quiz.held.length === 0) quiz.penalised = false;
}

export function quizStats(quiz) {
  return {
    asked: quiz.asked,
    correct: quiz.correct,
    wrong: quiz.wrong,
    streak: quiz.streak,
    bestStreak: quiz.bestStreak,
  };
}
