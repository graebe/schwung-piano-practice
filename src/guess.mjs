// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * guess.mjs — the note guesser. Pure: no host calls, no rendering, no clock.
 *
 * A different skill from the scrolling reader. The Move's grid is isomorphic —
 * one semitone right, five semitones up — so the same pitch appears on several
 * pads and nothing looks like a keyboard. Finding a pitch is its own problem,
 * and the reading mode can never drill it because the note is always moving.
 * Here it waits, until you play it.
 *
 * The Play drills read it one of two ways, and show what is coming next:
 *
 *   name   the letter or chord symbol only — any octave, any voicing counts,
 *          since a name carries no octave; this drills the grid
 *   staff  the notation only, no name — the written pitches exactly; this
 *          drills reading
 *
 * Either way a row of prompts is queued up, like the notes of a song, and it
 * moves on one prompt per right answer.
 */

import { MODES, scalePitches, playableRange, triadOn, fitsTriad, rng } from './generator.mjs';
import { inStaffRange } from './notation.mjs';
import { DEFAULT_TRANSPOSE, padsForPitch } from './padmap.mjs';
import {
  QUALITIES, ADVANCED_QUALITIES, nameChord, chordPool, matchChord, qualityById, chordOf,
} from './chords.mjs';
import { CORRECT, WRONG, INCOMPLETE } from './verdict.mjs';
import { buildChoices } from './choices.mjs';
import { itemHistory } from './stats.mjs';
import { spell, chordLabel } from './notation.mjs';
import {
  exerciseByKey, levelByKey, buildEarPool, answersFor, groupByAnswer, pickEntry, slowed,
  exerciseSubject,
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

/* How a Play drill is read. Null for everything else: hearing, picking. */
export const READ_NAME = 'name';
export const READ_STAFF = 'staff';
/* Prompts in a Play drill's row: the one to play and the five after it. Four
 * fit on the Move's screen at the staff's spacing; the fifth is coming in at
 * the edge and the sixth is already there to glide in behind it. */
export const LOOKAHEAD = 6;

export { CORRECT, WRONG, INCOMPLETE };

/*
 * Everything the quiz can ask, worked out once at the start.
 *
 * Constrained three ways at once: in the key, drawable on the staff, and
 * reachable on a pad (chords.mjs playable). A prompt that fails any of those
 * is unanswerable — it would be invisible, or there would be no pad for it.
 *
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
     * tones are on, otherwise the notes of the key. The quality is what the
     * tally files it under: a few dozen kinds read better than hundreds of
     * chords. */
    return chordPool({
      qualities: qualities.map((q) => q.id),
      roots: halfTones ? 'chromatic' : 'key',
      rootPc, mode, transpose, fifths,
    }).map((e) => ({
      pitches: e.pitches, label: e.label, quality: qualityById(e.qualityId).suffix || 'maj',
      qualityId: e.qualityId, root: e.root,
    }));
  }

  if (kind === CHORDS) {
    /* Triads built from the scale: diatonic by construction, so they come out
     * major, minor or diminished according to where in the key they sit. */
    for (let i = 0; i < scale.length; i++) {
      if (!fitsTriad(scale, i)) continue;
      const chord = triadOn(scale, i);
      if (chord.length < 3) continue;
      if (!chord.every((p) => inStaffRange(p))) continue;
      /* A stack of a non-tertian scale is no chord, and no item to file. */
      const named = chordOf(chord);
      pool.push(named ? { pitches: chord, label: null, qualityId: named.qualityId, root: named.root } : { pitches: chord, label: null });
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
  exercise = null,      /* EAR: which exercise of ear.mjs, by key — or a trainer's own */
  level = null,         /* EAR: and which of its levels */
  roundSize = 0,        /* 0 = endless: measure nothing, record nothing */
  read = null,          /* Play drills: READ_NAME or READ_STAFF */
  history = null,       /* the drill's tally over every round: { key: [asked, right] } */
  itemTable = null,     /* the per-item table, stats.items: weights by item, per mode */
  seed = 1,
  /* A trainer's round (trainer.mjs) brings its own: */
  pool: given = null,   /* the prompts, instead of the ones the kind would build */
  how = null,           /* 'exact' | 'name': how a played answer is judged */
  subject = null,       /* what the per-item table files it under */
  choicesFor = null,    /* entry -> the answers to offer for it, of the exercise's */
} = {}) {
  const ear = kind === EAR ? (typeof exercise === 'object' && exercise ? exercise : exerciseByKey(exercise)) : null;
  const earLevel = ear ? levelByKey(ear, level) : null;
  let pool = given;
  if (!pool) {
    pool = ear
      ? buildEarPool(ear, earLevel.key, transpose)
      : buildPool(kind, rootPc, mode, transpose, halfTones, chordSet, fifths);
  }
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
    read: read === READ_NAME || read === READ_STAFF ? read : null,
    /* The prompt and what follows it, head first. A Play drill shows them all;
     * everything else only ever has the one. */
    queue: [],
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
    missed: false,      /* any wrong attempt on this prompt, for the tally */
    /* Per answer, this round: { key: [asked, right] }, and the order to show
     * them in. Filled as each prompt is solved. */
    tally: {},
    tallyOrder: [],
    tallyLabels: {},
    /* What the drill has asked before, and how it went: the answers you get
     * wrong come round more often. */
    history: history && typeof history === 'object' ? history : null,
    itemHistory: null,
    keyCache: new Map(),
    itemCache: new Map(),
    /* This round per item, for the per-item table (stats.addItems): { item:
     * { n: [asked, right], keys: { pc: [a, r] }, ways: { way: [a, r] } } }. */
    items: {},
    /* Prompts answered wrong, to ask again a few prompts later. */
    reask: [],
    draws: 0,
    roundSize,
    /*
     * Null until the first press. A round is timed from when you start
     * playing, not from when the screen appeared — the seconds spent getting
     * your bearings are not part of how fast you can answer.
     */
    startedAt: null,
    finishedAt: null,
  };
  quiz.how = how === 'exact' || how === 'name' ? how : null;
  quiz.choicesFor = typeof choicesFor === 'function' ? choicesFor : null;
  quiz.subject = subject || quizSubject(quiz);
  quiz.mode = quizMode(quiz);
  /* What this subject has asked before in this mode, whichever drill asked:
   * the items you miss come round more often. */
  if (itemTable && typeof itemTable === 'object' && quiz.subject) {
    quiz.itemHistory = itemHistory({ items: itemTable }, quiz.subject, quiz.mode);
  }
  nextPrompt(quiz);
  return quiz;
}

/*
 * What the per-item table files this quiz's answers under (stats.mjs): the
 * subject — notes, chords, or an exercise's own — and the mode. Picking a lit
 * pad's name and reading the staff are reading; finding a name is playing.
 */
export function quizSubject(quiz) {
  if (quiz.kind === EAR) return exerciseSubject(quiz.exercise);
  return quiz.kind === CHORDS ? 'chord' : 'note';
}

export function quizMode(quiz) {
  if (quiz.kind === EAR) return quiz.exercise.read ? 'read' : 'hear';
  if (quiz.pick || quiz.read === READ_STAFF) return 'read';
  return quiz.read === READ_NAME ? 'play' : 'hear';
}

/*
 * The item an entry asks about: { item, pc, way }, or null when it is none —
 * a stack that is no chord, an answer of an exercise with no subject. `pc` is
 * the prompt root's pitch class where there is one.
 */
export function itemOf(quiz, entry) {
  if (!quiz.subject || !entry) return null;
  const pcOf = (p) => (p == null ? null : ((p % 12) + 12) % 12);
  if (quiz.kind === EAR) {
    const item = entry.judged || entry.answer;
    if (quiz.subject === 'int' && !entry.judged && !/^[mMPTd]/.test(item)) return null;
    return { item, pc: pcOf(entry.root), way: entry.way || null };
  }
  if (quiz.kind === NOTES) {
    return { item: spell(entry.pitches[0], quiz.fifths).label, pc: pcOf(entry.pitches[0]), way: null };
  }
  return entry.qualityId ? { item: entry.qualityId, pc: pcOf(entry.root), way: null } : null;
}

/* A new question. Never the same one twice running — a repeat reads as the
 * screen having failed to update. */
export function nextPrompt(quiz) {
  if (!quiz.pool.length) {
    quiz.prompt = [];
    quiz.label = null;
    return quiz.prompt;
  }
  let chosen;
  if (quiz.kind === EAR) {
    chosen = dueReask(quiz, quiz.entry)
      || pickEntry(quiz.groups, quiz.rand, quiz.entry, groupWeights(quiz));
    quiz.draws++;
  } else {
    /* Drawn in order, each against the one before it, so a row reads exactly
     * as the same prompts would have arrived one at a time. */
    const depth = quiz.read ? LOOKAHEAD : 1;
    quiz.queue.shift();
    while (quiz.queue.length < depth) {
      const before = quiz.queue[quiz.queue.length - 1] || quiz.entry;
      quiz.queue.push(dueReask(quiz, before) || randomEntry(quiz, before));
      quiz.draws++;
    }
    chosen = quiz.queue[0];
  }
  quiz.prompt = chosen.pitches.slice();
  quiz.label = chosen.label;
  quiz.entry = chosen;
  if (quiz.kind === EAR) {
    /* Same list, same order, cursor back on top: the answer's place is
     * something you learn, so it must not move. */
    quiz.choices = quiz.choicesFor ? quiz.choicesFor(chosen) : quiz.answers;
    quiz.choiceIndex = 0;
  } else if (quiz.pick) {
    quiz.choices = buildChoices(quiz.pool, chosen, quiz.rand, PICK_COUNT,
      (pitches) => labelFor(quiz, pitches));
    quiz.choiceIndex = 0;
  }
  quiz.held = [];
  quiz.solved = false;
  quiz.penalised = false;
  quiz.missed = false;
  quiz.hint = 0;
  quiz.eliminated = [];
  quiz.asked++;
  return quiz.prompt;
}

const promptKey = (e) => e.pitches.join(',') + '|' + (e.label || '');

function randomEntry(quiz, before) {
  const previous = before ? promptKey(before) : '';
  const same = (e) => promptKey(e) === previous;
  const draw = quiz.history || quiz.itemHistory
    ? () => weightedEntry(quiz)
    : () => quiz.pool[Math.floor(quiz.rand() * quiz.pool.length)];
  let chosen = draw();
  if (quiz.pool.length > 1) {
    let guard = 8;
    while (same(chosen) && guard-- > 0) chosen = draw();
  }
  return chosen;
}

/* ---- Practising what you get wrong ---------------------------------------------- */
/*
 * Two habits of a good teacher. What you have got wrong before comes round
 * more often: an answer's weight is 1 + 3 x its error rate over every round
 * of the drill, so one you always miss comes four times as often as one you
 * never do — and every answer still comes. And a prompt you get wrong now is
 * asked again three to five prompts later, while it is still fresh.
 */
const MISS_WEIGHT = 3;
export const REASK_MIN = 3;
export const REASK_SPREAD = 3;

/* An entry's history: its item's in the table when it is one, else its
 * answer's in the drill's own tally. */
function historyOf(quiz, entry) {
  if (quiz.itemHistory) {
    const at = entryItem(quiz, entry);
    if (at) return quiz.itemHistory[at.item];
  }
  return quiz.history && quiz.history[entryKey(quiz, entry)];
}

function weightOf(t) {
  if (!t || !(t[0] > 0)) return 1;
  return 1 + MISS_WEIGHT * ((t[0] - t[1]) / t[0]);
}

function weightOfEntry(quiz, entry) {
  return weightOf(historyOf(quiz, entry));
}

function entryItem(quiz, entry) {
  if (!quiz.itemCache.has(entry)) quiz.itemCache.set(entry, itemOf(quiz, entry));
  return quiz.itemCache.get(entry);
}

/* One answer into the round's per-item count. */
function countItem(quiz, entry, right) {
  const at = entryItem(quiz, entry);
  if (!at) return;
  const row = quiz.items[at.item] || (quiz.items[at.item] = { n: [0, 0], keys: {}, ways: {} });
  const bump = (into, k) => {
    const v = into[k] || (into[k] = [0, 0]);
    v[0]++;
    if (right) v[1]++;
  };
  bump(row, 'n');
  if (at.pc != null) bump(row.keys, at.pc);
  if (at.way) bump(row.ways, at.way);
}

function entryKey(quiz, entry) {
  let k = quiz.keyCache.get(entry);
  if (k === undefined) {
    k = answerKey(quiz, entry).key;
    quiz.keyCache.set(entry, k);
  }
  return k;
}

function weightedEntry(quiz) {
  let total = 0;
  for (const e of quiz.pool) total += weightOfEntry(quiz, e);
  let r = quiz.rand() * total;
  for (const e of quiz.pool) {
    r -= weightOfEntry(quiz, e);
    if (r < 0) return e;
  }
  return quiz.pool[quiz.pool.length - 1];
}

/* Hearing draws an answer first, then a prompt for it: the answers weigh. */
function groupWeights(quiz) {
  if (!quiz.history && !quiz.itemHistory) return null;
  return quiz.groups.map((g) => {
    const at = quiz.itemHistory ? entryItem(quiz, g[0]) : null;
    /* A comparison's groups are its answers, not intervals: by the tally. */
    if (at && !g[0].judged) return weightOf(quiz.itemHistory[at.item]);
    return weightOf(quiz.history && quiz.history[g[0].answer]);
  });
}

/* A missed prompt whose turn has come, unless it would repeat the last one. */
function dueReask(quiz, before) {
  const at = quiz.reask.findIndex((r) => r.due <= quiz.draws && !(before && promptKey(r.entry) === promptKey(before)));
  if (at < 0) return null;
  return quiz.reask.splice(at, 1)[0].entry;
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

/* A name has no octave, so a name drill is judged by pitch classes — any F
 * for "F", A C E in any inversion for "Am"; the staff drills by the written
 * pitches (chords.mjs matchChord). */
function evaluate(quiz) {
  return matchChord(quiz.held, quiz.prompt, quiz.how || (quiz.read === READ_NAME ? 'name' : 'exact'));
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
  if (result === CORRECT) solve(quiz, nowMs);
  else if (result === WRONG) miss(quiz);
  return result;
}

/* A prompt answered: the round's count, the streak, and the answer's tally. */
function solve(quiz, nowMs) {
  quiz.solved = true;
  quiz.correct++;
  quiz.streak++;
  if (quiz.streak > quiz.bestStreak) quiz.bestStreak = quiz.streak;
  if (quiz.roundSize > 0 && quiz.correct >= quiz.roundSize && quiz.finishedAt === null) {
    quiz.finishedAt = nowMs || quiz.startedAt || 0;
  }
  if (quiz.entry) {
    const { key, label } = answerKey(quiz, quiz.entry);
    if (!quiz.tally[key]) {
      quiz.tally[key] = [0, 0];
      quiz.tallyOrder.push(key);
      quiz.tallyLabels[key] = label;
    }
    quiz.tally[key][0]++;
    if (!quiz.missed) quiz.tally[key][1]++;
    countItem(quiz, quiz.entry, !quiz.missed);
    /* Missed: ask it again a few prompts on (the row already holds the next
     * few, so it lands after them). */
    if (quiz.missed) {
      const due = quiz.draws + REASK_MIN - 1 + Math.floor(quiz.rand() * REASK_SPREAD);
      quiz.reask.push({ entry: quiz.entry, due });
    }
  }
}

/* A wrong attempt. Counted once per prompt: holding a wrong note down should
 * not keep scoring — but the prompt stays missed for its answer's tally. */
function miss(quiz) {
  quiz.missed = true;
  if (quiz.penalised) return;
  quiz.penalised = true;
  quiz.wrong++;
  quiz.streak = 0;
}

export function releasePitch(quiz, pitch) {
  const at = quiz.held.indexOf(pitch);
  if (at >= 0) quiz.held.splice(at, 1);
  if (!quiz.solved && quiz.held.length === 0) quiz.penalised = false;
}

/* ---- Success per answer -------------------------------------------------------- */
/*
 * What an answer is, for the tally: the thing you would name.
 *
 *   hearing and reading    the exercise's answer ("Major 6th")
 *   notes                  the note's name without its octave ("C#")
 *   triads of the key      the chord ("Em") — seven of them
 *   chord types            the quality ("m7") — hundreds of chords, a few
 *                          dozen kinds, and the kind is what is being learned
 */
export function answerKey(quiz, entry) {
  if (quiz.kind === EAR) {
    const a = (quiz.answers || []).find((x) => x.key === entry.answer);
    return { key: entry.answer, label: a ? a.label : entry.answer };
  }
  if (entry.pitches.length === 1) {
    const name = spell(entry.pitches[0], quiz.fifths).label;
    return { key: name, label: name };
  }
  if (entry.quality) return { key: entry.quality, label: entry.quality };
  const name = labelFor(quiz, entry.pitches);
  return { key: name, label: name };
}

const NOTE_ORDER = (name) => {
  const LET = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  return (LET[name[0]] ?? 99) + (name[1] === '#' ? 0.5 : name[1] === 'b' ? -0.5 : 0);
};

/*
 * The round's tally as rows, in the order to show them: a hearing or reading
 * exercise's own answer order, notes from C up, anything else as first asked.
 */
export function tallyRows(quiz) {
  let keys = quiz.tallyOrder.slice();
  if (quiz.kind === EAR && quiz.answers) {
    const order = quiz.answers.map((a) => a.key);
    keys.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  } else if (quiz.kind === NOTES) {
    keys.sort((a, b) => NOTE_ORDER(a) - NOTE_ORDER(b));
  }
  return keys.map((k) => ({ key: k, label: quiz.tallyLabels[k], asked: quiz.tally[k][0], right: quiz.tally[k][1] }));
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

/*
 * What a name drill shows for an entry: the letter without its octave, or the
 * chord's symbol. A stack that is not a chord — degrees of a non-tertian scale —
 * shows its notes, which is the honest name for it.
 */
export function entryName(quiz, entry) {
  if (entry.pitches.length === 1) return spell(entry.pitches[0], quiz.fifths).label;
  return entry.label || nameChord(entry.pitches, quiz.fifths) || chordLabel(entry.pitches, quiz.fifths);
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
    solve(quiz, nowMs);
    return CORRECT;
  }
  miss(quiz);
  return WRONG;
}

/*
 * Answer by pressing an answer's pad: the same as moving the cursor there and
 * clicking. A struck-out answer cannot be chosen — the hint took it away.
 * Returns null when the press means nothing (out of range, struck, solved).
 */
export function chooseAnswer(quiz, index, nowMs = 0) {
  if (quiz.solved || index < 0 || index >= quiz.choices.length) return null;
  if (isEliminated(quiz, index)) return null;
  quiz.choiceIndex = index;
  return pickChoice(quiz, nowMs);
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
