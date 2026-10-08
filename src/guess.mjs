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
import { DEFAULT_TRANSPOSE, padsForPitch } from './padmap.mjs';
import {
  QUALITIES, ADVANCED_QUALITIES, buildChord, chordSymbol, qualitySpan, nameChord,
} from './chords.mjs';
import { buildChoices } from './choices.mjs';
import { spell, chordLabel } from './notation.mjs';
import {
  exerciseByKey, levelByKey, buildEarPool, answersFor, groupByAnswer, pickEntry, slowed,
} from './ear.mjs';

export const NOTES = 'notes';
export const CHORDS = 'chords';
export const EAR = 'ear';         /* hear a prompt, name it: see ear.mjs */

/* Which chords the chord drill asks for. */
export const PICK_COUNT = 3;      /* options in the multiple-choice mode */
export const MAX_HINT = 2;        /* rungs on the help ladder */

export const TRIADS = 'triads';   /* diatonic triads on scale degrees */
export const TYPES = 'types';     /* a quality chosen deliberately: dim, sus, 7ths... */
export const ADVANCED = 'advanced'; /* ...and ninths, and altered dominants */

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
function playable(pitches, transpose) {
  for (let i = 0; i < pitches.length; i++) {
    if (!inStaffRange(pitches[i])) return false;
    if (!padsForPitch(pitches[i], transpose).length) return false;
  }
  return true;
}

/*
 * Pool entries are { pitches, label }. The label is null for notes and for
 * diatonic triads, where the note names say everything there is to say, and a
 * chord symbol for the quality drill — there, naming the chord IS the exercise
 * and the notes are already on the staff to be read.
 */
function buildPool(kind, rootPc, mode, transpose, halfTones, chordSet, fifths) {
  const { lo, hi } = playableRange(transpose);
  const scale = scalePitches(rootPc, MODES[mode] ? mode : 'major', lo, hi);
  const pool = [];

  if (kind === CHORDS && (chordSet === TYPES || chordSet === ADVANCED)) {
    const qualities = chordSet === ADVANCED
      ? QUALITIES.concat(ADVANCED_QUALITIES)
      : QUALITIES;
    /* Roots follow the same setting the note drill uses: chromatic when half
     * tones are on, otherwise the notes of the key. */
    const roots = [];
    if (halfTones) {
      for (let pitch = lo; pitch <= hi; pitch++) roots.push(pitch);
    } else {
      for (let i = 0; i < scale.length; i++) roots.push(scale[i]);
    }
    for (let r = 0; r < roots.length; r++) {
      for (let q = 0; q < qualities.length; q++) {
        const quality = qualities[q];
        if (roots[r] + qualitySpan(quality) > hi) continue;
        const pitches = buildChord(roots[r], quality);
        if (!playable(pitches, transpose)) continue;
        pool.push({ pitches, label: chordSymbol(roots[r], quality, fifths) });
      }
    }
    return pool;
  }

  if (kind === CHORDS) {
    /* Triads built from the scale: diatonic by construction, so they come out
     * major, minor or diminished according to where in the key they sit. */
    for (let i = 0; i < scale.length; i++) {
      if (!fitsTriad(scale, i)) continue;
      const chord = triadOn(scale, i);
      if (chord.length < 3) continue;
      if (!chord.every((p) => inStaffRange(p))) continue;
      pool.push({ pitches: chord, label: null });
    }
    return pool;
  }

  if (halfTones) {
    /* Every semitone in reach, not just the seven of the key — the black notes
     * are the ones that are hard to find on an isomorphic grid, and skipping
     * them leaves five twelfths of the instrument undrilled. They are spelled
     * by the key signature, so C# in a sharp key and Db in a flat one. */
    for (let pitch = lo; pitch <= hi; pitch++) {
      if (inStaffRange(pitch)) pool.push({ pitches: [pitch], label: null });
    }
    return pool;
  }

  for (let i = 0; i < scale.length; i++) {
    if (inStaffRange(scale[i])) pool.push({ pitches: [scale[i]], label: null });
  }
  return pool;
}

export function createQuiz({
  kind = NOTES,
  rootPc = 0,
  mode = 'major',
  transpose = DEFAULT_TRANSPOSE,
  halfTones = false,
  chordSet = TRIADS,
  fifths = 0,
  pick = false,         /* multiple choice: a pad lights, you name it */
  exercise = null,      /* EAR: which exercise of ear.mjs, by key */
  level = null,         /* EAR: and which of its levels */
  roundSize = 0,        /* 0 = endless: measure nothing, record nothing */
  seed = 1,
} = {}) {
  const ear = kind === EAR ? exerciseByKey(exercise) : null;
  const earLevel = ear ? levelByKey(ear, level) : null;
  const pool = ear
    ? buildEarPool(ear, earLevel.key, transpose)
    : buildPool(kind, rootPc, mode, transpose, halfTones, chordSet, fifths);
  const answers = ear ? answersFor(ear, earLevel) : null;
  const quiz = {
    kind: ear ? EAR : (kind === CHORDS ? CHORDS : NOTES),
    pool,
    rand: rng(seed),
    prompt: [],
    label: null,   /* the chord symbol, when the drill is about qualities */
    /* Hearing is always multiple choice: the answers are the exercise's own,
     * in a fixed order, and the pool is drawn answer-first. */
    pick: Boolean(pick) || Boolean(ear),
    exercise: ear,
    level: earLevel,
    answers,
    groups: ear ? groupByAnswer(pool, answers) : null,
    fifths,
    entry: null,        /* the pool entry behind the current prompt */
    choices: [],        /* the options offered, when picking */
    choiceIndex: 0,
    eliminated: [],     /* options a hint has struck out */
    hint: 0,            /* rungs taken on this prompt */
    hintsUsed: 0,       /* across the round, for the record */
    held: [],
    asked: 0,
    correct: 0,
    wrong: 0,
    streak: 0,
    bestStreak: 0,
    solved: false,
    penalised: false,
    roundSize,
    /*
     * Null until the first press. A round is timed from when you start
     * playing, not from when the screen appeared — the seconds spent getting
     * your bearings are not part of how fast you can answer.
     */
    startedAt: null,
    finishedAt: null,
  };
  nextPrompt(quiz);
  return quiz;
}

/* A new question. Never the same one twice running — a repeat reads as the
 * screen having failed to update. */
export function nextPrompt(quiz) {
  if (!quiz.pool.length) {
    quiz.prompt = [];
    quiz.label = null;
    return quiz.prompt;
  }
  const chosen = quiz.kind === EAR
    ? pickEntry(quiz.groups, quiz.rand, quiz.entry)
    : randomEntry(quiz);
  quiz.prompt = chosen.pitches.slice();
  quiz.label = chosen.label;
  quiz.entry = chosen;
  if (quiz.kind === EAR) {
    /* Same list, same order, cursor back on top: the answer's place is
     * something you learn, so it must not move. */
    quiz.choices = quiz.answers;
    quiz.choiceIndex = 0;
  } else if (quiz.pick) {
    quiz.choices = buildChoices(quiz.pool, chosen, quiz.rand, PICK_COUNT,
      (pitches) => labelFor(quiz, pitches));
    quiz.choiceIndex = 0;
  }
  quiz.held = [];
  quiz.solved = false;
  quiz.penalised = false;
  quiz.hint = 0;
  quiz.eliminated = [];
  quiz.asked++;
  return quiz.prompt;
}

function randomEntry(quiz) {
  const previous = quiz.prompt.join(',') + '|' + (quiz.label || '');
  const same = (e) => e.pitches.join(',') + '|' + (e.label || '') === previous;
  let chosen = quiz.pool[Math.floor(quiz.rand() * quiz.pool.length)];
  if (quiz.pool.length > 1) {
    let guard = 8;
    while (same(chosen) && guard-- > 0) {
      chosen = quiz.pool[Math.floor(quiz.rand() * quiz.pool.length)];
    }
  }
  return chosen;
}

/*
 * What to play for the prompt, or null when it is just its pitches at once.
 * After the first hint a hearing prompt plays slower, chords broken first.
 */
export function promptEvents(quiz) {
  if (quiz.kind !== EAR || !quiz.entry) return null;
  return quiz.hint >= 1 ? slowed(quiz.entry.events) : quiz.entry.events;
}

/* Picking a pad's name: the option IS the entry. Hearing: it names the answer. */
function isRight(quiz, option) {
  if (quiz.kind === EAR) return Boolean(option && quiz.entry && option.key === quiz.entry.answer);
  return option === quiz.entry;
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
export function pressPitch(quiz, pitch, nowMs = 0) {
  if (quiz.startedAt === null && nowMs) quiz.startedAt = nowMs;
  if (quiz.solved) return CORRECT;
  /* Two pads can be the same pitch on this grid; count it once. */
  if (quiz.held.indexOf(pitch) < 0) quiz.held.push(pitch);

  const result = evaluate(quiz);
  if (result === CORRECT) {
    quiz.solved = true;
    quiz.correct++;
    quiz.streak++;
    if (quiz.streak > quiz.bestStreak) quiz.bestStreak = quiz.streak;
    if (quiz.roundSize > 0 && quiz.correct >= quiz.roundSize && quiz.finishedAt === null) {
      quiz.finishedAt = nowMs || quiz.startedAt || 0;
    }
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

/* ---- Rounds ------------------------------------------------------------------ */
/*
 * A round is a fixed number of prompts — a sprint over a fixed distance, so two
 * rounds cover the same work and can be compared. Since a prompt stays until
 * you get it right, finishing means exactly `roundSize` correct answers, and a
 * wrong answer costs time rather than needing a penalty of its own.
 */

export function roundComplete(quiz) {
  return quiz.roundSize > 0 && quiz.correct >= quiz.roundSize;
}

/* Milliseconds of actual playing: first press to last correct answer. */
export function roundElapsed(quiz, nowMs = 0) {
  if (quiz.startedAt === null) return 0;
  const end = quiz.finishedAt !== null ? quiz.finishedAt : nowMs;
  return Math.max(0, end - quiz.startedAt);
}

/* How far through the round, for the header. */
export function roundProgress(quiz) {
  return { done: quiz.correct, total: quiz.roundSize };
}

/* ---- Multiple choice ---------------------------------------------------------- */
/*
 * The other drills run name -> pad. This one runs pad -> name: the grid lights
 * and you say what it is, choosing with the jog. Recognising is easier than
 * recalling, so it is where someone starts.
 *
 * Note options carry their octave. On an isomorphic grid the same name sits in
 * several places, so knowing WHICH A# you are on is most of the skill — and
 * without the octave two options could read alike and the question would have
 * two right answers.
 */
export function labelFor(quiz, pitches) {
  if (pitches.length === 1) return spell(pitches[0], quiz.fifths).name;
  /* Name the chord when it has a name. The triads drill carries no label of
   * its own — it builds from scale degrees rather than choosing a quality — so
   * without this the multiple-choice options were three note spellings and the
   * question was which letters, not which chord. */
  return nameChord(pitches, quiz.fifths) || chordLabel(pitches, quiz.fifths);
}

export function optionLabel(quiz, entry) {
  return entry.label || labelFor(quiz, entry.pitches);
}

export function isEliminated(quiz, index) {
  return quiz.eliminated.indexOf(index) >= 0;
}

/* Skips anything a hint has struck out — landing on a crossed-out option and
 * being allowed to pick it would make the hint pointless. */
export function moveChoice(quiz, delta, nowMs = 0) {
  if (quiz.startedAt === null && nowMs) quiz.startedAt = nowMs;
  const n = quiz.choices.length;
  if (!n) return quiz.choiceIndex;
  const step = delta > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    quiz.choiceIndex = ((quiz.choiceIndex + step) % n + n) % n;
    if (!isEliminated(quiz, quiz.choiceIndex)) break;
  }
  return quiz.choiceIndex;
}

/*
 * Answer. A wrong pick is counted and the question STAYS, exactly as a wrong
 * pad does elsewhere, so "a round is N correct answers" holds and the rate is
 * comparable with every other drill.
 */
export function pickChoice(quiz, nowMs = 0) {
  if (quiz.startedAt === null && nowMs) quiz.startedAt = nowMs;
  if (quiz.solved) return CORRECT;
  const chosen = quiz.choices[quiz.choiceIndex];
  if (!chosen) return WRONG;

  if (isRight(quiz, chosen)) {
    quiz.solved = true;
    quiz.correct++;
    quiz.streak++;
    if (quiz.streak > quiz.bestStreak) quiz.bestStreak = quiz.streak;
    if (quiz.roundSize > 0 && quiz.correct >= quiz.roundSize && quiz.finishedAt === null) {
      quiz.finishedAt = nowMs || quiz.startedAt || 0;
    }
    return CORRECT;
  }
  if (!quiz.penalised) {
    quiz.penalised = true;
    quiz.wrong++;
    quiz.streak = 0;
  }
  return WRONG;
}

/* ---- Help -------------------------------------------------------------------- */
/*
 * Two rungs, and what each does depends on what the drill is withholding:
 *
 *   hearing   1: show the name it would normally show   2: light the pads
 *   reading   1: sound the notes                        2: light the pads
 *   picking   1: strike out one wrong option            2: strike out the other
 *   naming    1: play it again, slower, chords broken   2: strike out a wrong option
 *
 * The picking ladder is the same escalation in that mode's terms: its level 2
 * leaves one option standing, which is what "show me the answer" means there.
 *
 * A hinted answer still counts and keeps the streak — a hint you are afraid to
 * use is a hint that does not help you learn — but they are counted and shown,
 * so the score does not quietly overstate how you did.
 */
export function takeHint(quiz, rand) {
  if (quiz.hint >= MAX_HINT) return quiz.hint;
  quiz.hint++;
  quiz.hintsUsed++;

  /* Hearing spends its first rung on a slower replay — promptEvents — and
   * only the second strikes an option, which with two answers is the answer. */
  const replay = quiz.kind === EAR && quiz.hint === 1;
  if (quiz.pick && !replay) eliminateOne(quiz, rand);
  return quiz.hint;
}

export function hintsLeft(quiz) {
  return MAX_HINT - quiz.hint;
}

/* Strike out a wrong option, never the right one. */
function eliminateOne(quiz, rand) {
  const wrong = [];
  for (let i = 0; i < quiz.choices.length; i++) {
    if (isRight(quiz, quiz.choices[i])) continue;
    if (isEliminated(quiz, i)) continue;
    wrong.push(i);
  }
  if (!wrong.length) return;
  const at = wrong[Math.floor((rand ? rand() : Math.random()) * wrong.length)];
  quiz.eliminated.push(at);
  /* If the cursor was sitting on it, move off. */
  if (quiz.choiceIndex === at) moveChoice(quiz, 1);
}
