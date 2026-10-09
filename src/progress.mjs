// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * progress.mjs — how far you have got with every exercise. Pure: no host calls.
 *
 * Every playable row of the lesson tree — a song's rung, a scale drill, a quiz
 * drill — is an ITEM, keyed by the stable id catalog.mjs stamps on it. An item
 * is practised in two stages:
 *
 *   Stage 1   the target pads light up as the notes arrive
 *   Stage 2   nothing lights: reading alone
 *
 * A stage is PASSED by one attempt at PASS or better, at any tempo. Passing
 * stage 2 is full completion (✓); passing stage 1 is half (◐). A quiz has no
 * lit pads, so its stages are "with hints" and "without".
 *
 * What a row shows is the LATEST attempt, because that is where you are now —
 * except that a stage once passed never reads lower again. Practising
 * something you have finished must never feel like losing it, so after a pass
 * the stage shows its best instead, and repetition (below) has its own place
 * to report a slip.
 */

export const PROGRESS_VERSION = 1;
export const PASS = 0.9;
export const STAGES = 2;
/* Attempts kept per item for its chart. The stage summaries above it are kept
 * whole, so dropping old attempts never loses a pass. */
export const HISTORY_CAP = 24;

const DAY_S = 86400;
/* Days until a finished item comes up for repetition, growing with every
 * clean repeat and starting over after a slip. */
export const REP_INTERVALS = [1, 3, 7, 14, 30];
export const REP_SESSION = 5;

/* ---- The store ------------------------------------------------------------ */

export function emptyProgress() {
  /* `rev` is not saved: it moves on every change, so a cache can tell whether
   * what it holds is still true without comparing the whole store. `seen`
   * is which Info pages have been shown, by page key. */
  return { version: PROGRESS_VERSION, items: {}, seen: {}, rev: 0 };
}

function emptyStage() {
  return { last: -1, best: 0, passedAt: 0 };
}

function emptyItem() {
  return {
    stages: [emptyStage(), emptyStage()],
    plays: 0,
    t: 0,          /* last attempt, unix seconds */
    skip: 0,       /* when you chose to skip it, or 0 */
    movedOn: 0,    /* when you chose to stop after stage 1, or 0 */
    rep: null,     /* { due, step, at, ok } once finished */
    h: [],         /* [t, percent, stage, bpm, repeat] */
  };
}

export function item(progress, id) {
  return progress.items[id] || null;
}

function ensure(progress, id) {
  if (!progress.items[id]) progress.items[id] = emptyItem();
  return progress.items[id];
}

const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

function readStage(s) {
  if (!s || typeof s !== 'object') return emptyStage();
  return {
    last: num(s.last, -1),
    best: num(s.best),
    passedAt: num(s.passedAt),
  };
}

/* Never throws: a corrupt file reads as a fresh start, because losing the
 * history is a great deal better than failing to open the module. */
export function parseProgress(text) {
  if (!text) return emptyProgress();
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return emptyProgress();
  }
  const out = emptyProgress();
  if (obj && typeof obj === 'object' && obj.seen && typeof obj.seen === 'object') {
    for (const k in obj.seen) if (typeof obj.seen[k] === 'number') out.seen[k] = obj.seen[k];
  }
  if (!obj || typeof obj !== 'object' || !obj.items || typeof obj.items !== 'object') return out;
  for (const id in obj.items) {
    const src = obj.items[id];
    if (!src || typeof src !== 'object') continue;
    const it = emptyItem();
    const stages = Array.isArray(src.stages) ? src.stages : [];
    it.stages = [readStage(stages[0]), readStage(stages[1])];
    it.plays = num(src.plays);
    it.t = num(src.t);
    it.skip = num(src.skip);
    it.movedOn = num(src.movedOn);
    if (src.rep && typeof src.rep === 'object') {
      it.rep = { due: num(src.rep.due), step: num(src.rep.step), at: num(src.rep.at), ok: Boolean(src.rep.ok) };
    }
    if (Array.isArray(src.h)) {
      it.h = src.h.filter((r) => Array.isArray(r) && r.length >= 3
        && typeof r[0] === 'number' && typeof r[1] === 'number' && (r[2] === 1 || r[2] === 2));
    }
    out.items[id] = it;
  }
  return out;
}

export function serialiseProgress(progress) {
  return JSON.stringify({ version: PROGRESS_VERSION, items: progress.items, seen: progress.seen });
}

/* ---- Info pages seen ------------------------------------------------------- */

export function infoSeen(progress, key) {
  return Boolean(progress.seen && progress.seen[key]);
}

export function markInfoSeen(progress, key, at = 0) {
  if (!progress.seen) progress.seen = {};
  progress.seen[key] = Math.round(at / 1000) || 1;
}

/* ---- Scoring an attempt --------------------------------------------------- */

/*
 * The share of a run that was right: notes hit over notes asked PLUS stray
 * presses. Without the strays a player could sweep the pads under every note
 * and score full marks.
 */
export function exerciseScore(stats) {
  const asked = (stats.total || 0) + (stats.strays || 0);
  return asked > 0 ? Math.min(1, (stats.hits || 0) / asked) : 0;
}

/* A quiz round: right answers over attempts. A round is always N correct, so
 * this is 1 - the error rate the quiz already reports. */
export function quizScore(correct, wrong) {
  const attempts = correct + wrong;
  return attempts > 0 ? correct / attempts : 0;
}

/* Hints are the quiz's lit pads: a round that used one is a stage 1 round. */
export function quizStage(hintsUsed) {
  return hintsUsed > 0 ? 1 : 2;
}

/*
 * Record one finished attempt. Returns what it changed, for the result screen:
 *   { passed: 0|1|2  the stage this attempt passed for the first time,
 *     repeat         it was a repetition of something already finished,
 *     before         the stage's shown score before this attempt }
 */
export function recordAttempt(progress, id, { stage, score, at = 0, bpm = 0 }) {
  const s = stage === 2 ? 2 : 1;
  const it = ensure(progress, id);
  const t = Math.round(at / 1000);
  const repeat = isFinished(it);
  const before = stageScore(it, s);
  const st = it.stages[s - 1];

  st.last = score;
  if (score > st.best) st.best = score;
  let passed = 0;
  if (score >= PASS && !st.passedAt) {
    st.passedAt = t;
    passed = s;
  }
  /* Reading it unaided proves you can read it with help. */
  if (s === 2 && st.passedAt) {
    const one = it.stages[0];
    if (!one.passedAt) one.passedAt = t;
    if (st.best > one.best) one.best = st.best;
  }

  it.plays++;
  it.t = t;
  /* Playing something you skipped means you are working on it after all. */
  it.skip = 0;
  if (repeat) scheduleRepeat(it, score >= PASS, t);
  else if (isFinished(it)) startRepeats(it, t);

  it.h.push([t, Math.round(score * 100), s, Math.round(bpm) || 0, repeat ? 1 : 0]);
  if (it.h.length > HISTORY_CAP) it.h.splice(0, it.h.length - HISTORY_CAP);
  progress.rev++;
  return { passed, repeat, before };
}

/* ---- Reading an item ------------------------------------------------------ */

export function stagePassed(it, stage) {
  return Boolean(it && it.stages[stage - 1].passedAt);
}

/* 0..1. The latest attempt, or the best once the stage is passed. */
export function stageScore(it, stage) {
  if (!it) return 0;
  const st = it.stages[stage - 1];
  if (st.passedAt) return Math.max(st.best, st.last);
  return st.last < 0 ? 0 : st.last;
}

export function stagePlayed(it, stage) {
  return Boolean(it && (it.stages[stage - 1].last >= 0 || it.stages[stage - 1].passedAt));
}

/*
 * The row's percentage, 0..100: the two stages averaged, stage 1 counting at
 * least what stage 2 does. Stage 1 passed and stage 2 untouched reads just
 * under half — "half way through this exercise" is exactly the truth.
 */
export function itemPercent(it) {
  if (!it) return 0;
  const two = stageScore(it, 2);
  const one = Math.max(stageScore(it, 1), two);
  return Math.round(((one + two) / 2) * 100);
}

export const MARK_DONE = 'done';
export const MARK_HALF = 'half';
export const MARK_SKIP = 'skip';

export function itemMark(it) {
  if (!it) return null;
  if (stagePassed(it, 2)) return MARK_DONE;
  if (stagePassed(it, 1)) return MARK_HALF;
  if (it.skip) return MARK_SKIP;
  return null;
}

/* Finished, for the program: unaided, or passed with help and left there. */
export function isFinished(it) {
  return Boolean(it && (stagePassed(it, 2) || (stagePassed(it, 1) && it.movedOn)));
}

/* Where to start when an item is opened: the first stage not yet passed. */
export function recommendedStage(it) {
  return stagePassed(it, 1) ? 2 : 1;
}

export function skipItem(progress, id, at = 0) {
  const it = ensure(progress, id);
  it.skip = Math.round(at / 1000) || 1;
  progress.rev++;
}

/* Stop after stage 1. Only means something once stage 1 is passed. */
export function moveOn(progress, id, at = 0) {
  const it = ensure(progress, id);
  if (!stagePassed(it, 1)) return false;
  it.movedOn = Math.round(at / 1000) || 1;
  if (!it.rep) startRepeats(it, it.movedOn);
  progress.rev++;
  return true;
}

/* ---- Repetition ----------------------------------------------------------- */

function startRepeats(it, t) {
  it.rep = { due: t + REP_INTERVALS[0] * DAY_S, step: 0, at: 0, ok: false };
}

function scheduleRepeat(it, ok, t) {
  if (!it.rep) startRepeats(it, t);
  const step = ok ? Math.min(it.rep.step + 1, REP_INTERVALS.length - 1) : 0;
  it.rep = { due: t + REP_INTERVALS[step] * DAY_S, step, at: t, ok };
}

/* The last attempt slipped under the pass mark on something finished. */
function slipped(it) {
  const last = it.h[it.h.length - 1];
  return Boolean(last && last[1] < PASS * 100);
}

function sameDay(a, b) {
  return Math.floor(a / DAY_S) === Math.floor(b / DAY_S);
}

/*
 * Today's repetition session: finished items that slipped first, oldest slip
 * first, then the ones whose interval has run out, most overdue first — at
 * most REP_SESSION of them. Items repeated cleanly today come back marked
 * `done`, so the list shows what the session has already covered.
 */
export function repetitionSession(progress, atMs, limit = REP_SESSION) {
  const now = Math.round(atMs / 1000);
  const slips = [];
  const due = [];
  const done = [];
  for (const id in progress.items) {
    const it = progress.items[id];
    if (!isFinished(it) || !it.rep) continue;
    if (it.rep.at && it.rep.ok && sameDay(it.rep.at, now)) {
      done.push({ id, done: true, at: it.rep.at });
    } else if (slipped(it)) {
      slips.push({ id, done: false, at: it.t });
    } else if (it.rep.due <= now) {
      due.push({ id, done: false, at: it.rep.due });
    }
  }
  slips.sort((a, b) => a.at - b.at);
  due.sort((a, b) => a.at - b.at);
  done.sort((a, b) => a.at - b.at);
  return slips.concat(due).slice(0, limit).concat(done);
}

export function dueCount(session) {
  let n = 0;
  for (let i = 0; i < session.length; i++) if (!session[i].done) n++;
  return n;
}

/* ---- Folders -------------------------------------------------------------- */

/*
 * A folder's progress is the mean of its leaves, and finding the leaves is the
 * expensive half: Basics › Chords is forty-odd lessons voiced chord by chord,
 * built only when a folder is first opened. So the leaf ids of a folder are
 * cached by the folder's ID — not the node, which is rebuilt every time the
 * key changes — and the tree's shape never depends on the key, so they stay
 * true across rebuilds. The sums are cached too, against the store's rev.
 */
export function createAggregator() {
  return { leaves: new Map(), sums: new Map() };
}

/* Forget the shape: the tree changed in a way the ids depend on. */
export function resetShape(agg) {
  agg.leaves.clear();
  agg.sums.clear();
}

/* A node that holds progress of its own: it has an id and opens something. */
export function isTracked(node) {
  return Boolean(node && node.id && !('children' in node) && (node.build || node.guess || node.step));
}

function collectLeaves(node, out, seen) {
  if (!node) return;
  if ('children' in node) {
    if (node.untracked) return;
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) collectLeaves(kids[i], out, seen);
    return;
  }
  if (isTracked(node) && !seen.has(node.id)) {
    seen.add(node.id);
    out.push(node.id);
  }
}

export function leafIds(agg, node) {
  const key = node.id || '';
  let ids = key ? agg.leaves.get(key) : null;
  if (!ids) {
    ids = [];
    collectLeaves(node, ids, new Set());
    if (key) agg.leaves.set(key, ids);
  }
  return ids;
}

/* { percent, count, done, half } over the distinct leaves under a folder. */
export function summariseIds(progress, ids) {
  let sum = 0;
  let done = 0;
  let half = 0;
  for (let i = 0; i < ids.length; i++) {
    const it = progress.items[ids[i]];
    if (!it) continue;
    sum += itemPercent(it);
    const mark = itemMark(it);
    if (mark === MARK_DONE) done++;
    else if (mark === MARK_HALF) half++;
  }
  return {
    percent: ids.length ? Math.round(sum / ids.length) : 0,
    count: ids.length,
    done,
    half,
  };
}

export function folderSummary(agg, progress, node) {
  const key = node.id || '';
  const hit = key ? agg.sums.get(key) : null;
  if (hit && hit.rev === progress.rev) return hit.summary;
  const summary = summariseIds(progress, leafIds(agg, node));
  if (key) agg.sums.set(key, { rev: progress.rev, summary });
  return summary;
}

/* Everything played, most recent first — the Progress screen's list. */
export function recentIds(progress) {
  const ids = Object.keys(progress.items).filter((id) => progress.items[id].plays > 0);
  ids.sort((a, b) => progress.items[b].t - progress.items[a].t);
  return ids;
}

/* ---- Charts --------------------------------------------------------------- */

/*
 * One point per attempt inside a w x h box, oldest left. The scale is FIXED,
 * 0..100%: an autoscaled axis turns 96 -> 98 into a cliff, and two visits to
 * the same item would draw the same history differently. The pass mark comes
 * back as `passY` so the caller can rule it.
 */
export function accuracySeries(history, w, h, limit = HISTORY_CAP) {
  const use = history.length > limit ? history.slice(history.length - limit) : history;
  const lastX = w - 1;
  const lastY = h - 1;
  const yOf = (pct) => Math.round(lastY - (Math.max(0, Math.min(100, pct)) / 100) * lastY);
  const points = use.map((r, i) => ({
    x: use.length === 1 ? lastX : Math.round((i * lastX) / (use.length - 1)),
    y: yOf(r[1]),
    percent: r[1],
    stage: r[2],
    repeat: Boolean(r[4]),
  }));
  return { points, passY: yOf(PASS * 100) };
}

/*
 * Stages passed over time, for the overview: a step line rising by one at
 * every pass. Time runs along x from the first pass to `atMs`, and y is scaled
 * to the count reached, so the shape is the story — steady, a burst, a stall.
 */
export function passTimeline(progress, ids, w, h, atMs) {
  const times = [];
  for (let i = 0; i < ids.length; i++) {
    const it = progress.items[ids[i]];
    if (!it) continue;
    for (let s = 0; s < STAGES; s++) if (it.stages[s].passedAt) times.push(it.stages[s].passedAt);
  }
  times.sort((a, b) => a - b);
  if (!times.length) return { points: [], total: 0 };
  const t0 = times[0];
  const t1 = Math.max(Math.round(atMs / 1000), times[times.length - 1]);
  const span = Math.max(1, t1 - t0);
  const lastX = w - 1;
  const lastY = h - 1;
  const points = times.map((t, i) => ({
    x: Math.round(((t - t0) / span) * lastX),
    y: Math.round(lastY - ((i + 1) / times.length) * lastY),
  }));
  return { points, total: times.length };
}
