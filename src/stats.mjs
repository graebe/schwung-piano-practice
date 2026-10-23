// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * stats.mjs — what you scored, kept over time. Pure: no host calls.
 *
 * The metric is correct answers per minute, in the spirit of a typing test. A
 * round is a fixed number of prompts, and because a prompt stays until you get
 * it right, a round is always exactly N correct answers — so a wrong answer
 * costs you time and lowers the rate rather than needing a penalty of its own.
 *
 * A rate only means something within one drill. Guessing notes chromatically
 * and hearing seventh chords are different tasks, so every record carries a
 * drill id and nothing ever compares across them.
 */

import {
  exerciseByKey, levelByKey, answersFor, resolveLegacy, exerciseSubject, INTERVALS,
} from './ear.mjs';
import { ALL_QUALITIES, qualityById } from './chords.mjs';
import { scaleById } from './scales.mjs';
import { progressionById } from './progressions.mjs';
import { trainerLabel } from './trainer.mjs';

/*
 * 2: the per-item table (`items`) beside the per-drill tally. A version 1
 * file is migrated on load (migrateTally); its tally is kept as it was.
 */
export const STATS_VERSION = 2;
export const MAX_RECORDS = 200;   /* ~12KB; the file cannot grow without bound */

/* ---- Which drill a round belongs to ---------------------------------------- */

/*
 * A stable key from the settings that change what is being asked. Anything that
 * changes the difficulty has to be in here, or two unlike tasks would share a
 * trend line and the plot would be measuring the wrong thing.
 */
export function drillId({ hear = false, pick = false, kind = 'notes',
                          chordSet = 'triads', halfTones = false,
                          read = null, exercise = '', level = '', trainer = null } = {}) {
  /* A trainer's round: subject, circle, answer and level (trainer.mjs). */
  if (trainer) return trainer.id;
  /* A hearing drill is its exercise and level: ear:thirds:up. */
  if (kind === 'ear') return 'ear:' + exercise + ':' + level;
  /* Reading the staff is a different skill from finding a name on the grid, so
   * it is filed apart. The name drills keep 'guess': they are what Play asked
   * before the split, and their history carries on. */
  const mode = pick ? 'pick' : (hear ? 'hear' : (read === 'staff' ? 'staff' : 'guess'));
  if (kind === 'chords') {
    const set = chordSet === 'types' || chordSet === 'advanced' ? chordSet : 'triads';
    return mode + ':chords:' + set;
  }
  return mode + ':notes:' + (halfTones ? 'half' : 'key');
}

const DRILL_WORDS = {
  /* The Quiz folder's own words: Play finds it on the pads, Name names a lit pad. */
  guess: 'Play', hear: 'Hear', pick: 'Name', staff: 'Staff',
  notes: 'notes', chords: 'chords',
  half: 'chromatic', key: 'in key', types: 'types', triads: 'triads',
  advanced: 'advanced',
};

/* Readable, and inside 21 characters — the widest the 6px font fits on a
 * 128px line. "Guess chords all types" was 22 and overflowed. */
export function drillLabel(id) {
  const trained = trainerLabel(id);
  if (trained) return trained;
  const parts = String(id).split(':');
  if (parts.length !== 3) return String(id);
  if (parts[0] === 'ear') {
    /* An exercise the courses replaced is named as the course twin it opens. */
    const [exKey, levelKey] = resolveLegacy(parts[1], parts[2]);
    const ex = exerciseByKey(exKey);
    return ex ? (ex.tag || 'Hear') + ' ' + ex.short + ' ' + levelByKey(ex, levelKey).name : String(id);
  }
  return [DRILL_WORDS[parts[0]], DRILL_WORDS[parts[1]], DRILL_WORDS[parts[2]]]
    .filter(Boolean)
    .join(' ');
}

/* ---- Records ---------------------------------------------------------------- */

/* Correct answers per minute. Zero elapsed would divide by zero, and a round
 * that fast is a bug rather than a score, so it reads as 0. */
export function ratePerMinute(correct, ms) {
  if (!ms || ms <= 0) return 0;
  return (correct * 60000) / ms;
}

/*
 * `context` is what the round was asked in that is not part of the drill's
 * identity — the key, which roots a chord drill drew from, a progression's
 * voicing and rhythm — kept on the record so the id stays one task.
 */
export function makeRecord({ drill, n, ms, wrong = 0, hints = 0, at = 0, context = null }) {
  const rec = {
    t: Math.round(at / 1000),   /* seconds: the file is read by humans too */
    d: drill,
    n,
    ms: Math.round(ms),
    w: wrong,
    h: hints,
  };
  if (context && typeof context === 'object' && Object.keys(context).length) rec.x = context;
  return rec;
}

export function recordRate(rec) {
  return ratePerMinute(rec.n, rec.ms);
}

/*
 * Wrong answers as a share of attempts, 0..1.
 *
 * A round is always exactly n correct answers, so attempts are n + w and this
 * is comparable between a 10-prompt round and a 30-prompt one — which is the
 * whole point of a rate rather than a count, since the round size is a setting.
 */
export function errorFraction(correct, wrong) {
  const attempts = correct + wrong;
  if (!attempts) return 0;
  return wrong / attempts;
}

export function recordError(rec) {
  return errorFraction(rec.n, rec.w);
}

export function emptyStats() {
  return { version: STATS_VERSION, records: [], tally: {}, items: {} };
}

/* Append, dropping the oldest once the cap is reached. */
export function addRecord(stats, rec, cap = MAX_RECORDS) {
  stats.records.push(rec);
  if (stats.records.length > cap) stats.records.splice(0, stats.records.length - cap);
  return stats;
}

/* Never throws: a corrupt or truncated file reads as no history, because losing
 * the plot is a great deal better than failing to open the module. */
export function parseStats(text) {
  if (!text) return emptyStats();
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return emptyStats();
  }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.records)) return emptyStats();
  const records = [];
  for (let i = 0; i < obj.records.length; i++) {
    const r = obj.records[i];
    if (!r || typeof r !== 'object') continue;
    if (typeof r.d !== 'string') continue;
    if (typeof r.n !== 'number' || r.n <= 0) continue;
    if (typeof r.ms !== 'number' || r.ms <= 0) continue;
    const rec = {
      t: typeof r.t === 'number' ? r.t : 0,
      d: r.d,
      n: r.n,
      ms: r.ms,
      w: typeof r.w === 'number' ? r.w : 0,
      h: typeof r.h === 'number' ? r.h : 0,
    };
    if (r.x && typeof r.x === 'object' && !Array.isArray(r.x)) rec.x = r.x;
    records.push(rec);
  }
  const tally = parseTally(obj.tally);
  /* Version 1 had no table: build it from the tally, once. The caller sees
   * `migrated` and keeps a copy of the old file before the first save. */
  if (!(obj.version >= 2)) {
    return { version: STATS_VERSION, records, tally, items: migrateTally(tally).items, migrated: true };
  }
  return { version: STATS_VERSION, records, tally, items: parseItems(obj.items) };
}

/* Older files have no tally; a damaged entry is dropped, the rest kept. */
function parseTally(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const drill of Object.keys(raw)) {
    const answers = raw[drill];
    if (!answers || typeof answers !== 'object') continue;
    for (const key of Object.keys(answers)) {
      const v = answers[key];
      if (!Array.isArray(v) || v.length !== 2) continue;
      const [asked, right] = v;
      if (!(asked > 0) || !(right >= 0) || right > asked) continue;
      (out[drill] || (out[drill] = {}))[key] = [asked, right];
    }
  }
  return out;
}

export function serialiseStats(stats) {
  return JSON.stringify({
    version: STATS_VERSION, records: stats.records, tally: stats.tally || {}, items: stats.items || {},
  });
}

/* ---- Success per answer ----------------------------------------------------- */
/*
 * Every answer of every drill, asked and right, added up over all rounds.
 * Kept apart from the records and never trimmed: the records are the last 200
 * rounds of everything, and "how am I at minor 6ths" should not forget the
 * rounds before them. Its size is bounded by drills times answers.
 */
export function addTally(stats, drill, round) {
  if (!stats.tally) stats.tally = {};
  const into = stats.tally[drill] || (stats.tally[drill] = {});
  for (const key of Object.keys(round)) {
    const [asked, right] = round[key];
    const had = into[key] || [0, 0];
    into[key] = [had[0] + asked, had[1] + right];
  }
  return stats;
}

export function tallyFor(stats, drill) {
  return (stats.tally && stats.tally[drill]) || {};
}

/*
 * A drill's answers over every round, for Progress: [{ key, label, allAsked,
 * allRight }]. A hearing or reading drill names and orders them by its own
 * answers; any other in the order they were first answered.
 */
export function answerRows(stats, drill) {
  const t = tallyFor(stats, drill);
  let keys = Object.keys(t);
  const parts = String(drill).split(':');
  const ex = parts[0] === 'ear' ? exerciseByKey(parts[1]) : null;
  const answers = ex ? answersFor(ex, levelByKey(ex, parts[2])) : [];
  if (answers.length) {
    const order = answers.map((a) => a.key);
    keys = keys.filter((k) => order.indexOf(k) >= 0).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }
  return keys.map((k) => {
    const a = answers.find((x) => x.key === k);
    return { key: k, label: a ? a.label : k, allAsked: t[k][0], allRight: t[k][1] };
  });
}

/* Right, of all attempts, per round — what Progress scores a quiz round by —
 * as the accuracy plot reads a history: [t, percent, stage]. A round that took
 * a hint is a stage 1 round, drawn hollow. */
export function successPercent(n, wrong) {
  return Math.round((1 - errorFraction(n, wrong)) * 100);
}

export function successSeries(records) {
  return records.map((r) => [r.t, (1 - errorFraction(r.n, r.w)) * 100, r.h ? 1 : 2]);
}

/* ---- Success per item ------------------------------------------------------ */
/*
 * The tally answers "how did this drill go"; the table answers "which chords
 * am I good at", whatever drill asked them. Five subjects, each a set of
 * items — a note name, an interval, a scale, a chord quality, a progression —
 * and for each item how often it was asked and answered right, per mode:
 *
 *   items[subject][item] = { read: [a, r], hear: [a, r], play: [a, r],
 *                            keys: { pc: [a, r] }, ways: { up: [a, r] } }
 *
 * `keys` is by the pitch class of the prompt's root, where there is one;
 * `ways` the direction an interval was asked in. Never trimmed: bounded by
 * items times keys.
 */
export const SUBJECTS = ['note', 'int', 'scale', 'chord', 'prog'];
export const MODES = ['read', 'hear', 'play'];

const pair = (v) => Array.isArray(v) && v.length === 2 && v[0] > 0 && v[1] >= 0 && v[1] <= v[0];

function emptyItem() {
  return { read: [0, 0], hear: [0, 0], play: [0, 0], keys: {} };
}

function addPair(into, key, [a, r]) {
  const had = into[key] || [0, 0];
  into[key] = [had[0] + a, had[1] + r];
}

/*
 * A round's answers into the table. `round` is { item: { n: [a, r], keys?:
 * { pc: [a, r] }, ways?: { way: [a, r] } } }, filed under `mode`.
 */
export function addItems(stats, subject, mode, round) {
  if (SUBJECTS.indexOf(subject) < 0 || MODES.indexOf(mode) < 0) return stats;
  if (!stats.items) stats.items = {};
  const table = stats.items[subject] || (stats.items[subject] = {});
  for (const item of Object.keys(round)) {
    const r = round[item];
    const row = table[item] || (table[item] = emptyItem());
    addPair(row, mode, r.n);
    for (const pc of Object.keys(r.keys || {})) addPair(row.keys, pc, r.keys[pc]);
    for (const w of Object.keys(r.ways || {})) addPair(row.ways || (row.ways = {}), w, r.ways[w]);
  }
  return stats;
}

/* One subject and mode as a drill's history: { item: [asked, right] }. */
export function itemHistory(stats, subject, mode) {
  const table = (stats.items && stats.items[subject]) || {};
  const out = {};
  for (const item of Object.keys(table)) {
    const v = table[item][mode];
    if (v && v[0] > 0) out[item] = v.slice();
  }
  return out;
}

/* Right of asked, over every mode. */
export function itemShare(row) {
  let a = 0;
  let r = 0;
  for (const m of MODES) { a += row[m][0]; r += row[m][1]; }
  return a ? r / a : null;
}

/*
 * A subject's items for its Stats page, weakest first: those asked, by their
 * share right over every mode, fewest right first; ties by name.
 */
export function itemRows(stats, subject) {
  const table = (stats.items && stats.items[subject]) || {};
  return Object.keys(table)
    .map((item) => ({ item, ...table[item], share: itemShare(table[item]) }))
    .filter((row) => row.share !== null)
    .sort((x, y) => x.share - y.share || (x.item < y.item ? -1 : x.item > y.item ? 1 : 0));
}

/* A damaged entry is dropped, the rest kept, as the tally does. */
function parseItems(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const subject of SUBJECTS) {
    const table = raw[subject];
    if (!table || typeof table !== 'object') continue;
    for (const item of Object.keys(table)) {
      const src = table[item];
      if (!src || typeof src !== 'object') continue;
      const row = emptyItem();
      let any = false;
      for (const m of MODES) if (pair(src[m])) { row[m] = src[m].slice(); any = true; }
      if (!any) continue;
      for (const key of ['keys', 'ways']) {
        const map = src[key];
        if (!map || typeof map !== 'object') continue;
        for (const k of Object.keys(map)) if (pair(map[k])) (row[key] || (row[key] = {}))[k] = map[k].slice();
      }
      (out[subject] || (out[subject] = {}))[item] = row;
    }
  }
  return out;
}

/* ---- From the tally to the table: the version 2 migration ---------------- */

const NOTE_NAME = /^[A-G][#b]?$/;
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const pcOfName = (name) => (LETTER_PC[name[0]] + (name[1] === '#' ? 1 : name[1] === 'b' ? -1 : 0) + 12) % 12;
const qualityOfSuffix = (suffix) => {
  const q = ALL_QUALITIES.find((x) => x.suffix === suffix);
  return q ? q.id : null;
};
const OLD_MODE = { guess: 'play', staff: 'read', pick: 'read', hear: 'hear' };

/* Whether `item` is a real item of `subject`. */
export function isItem(subject, item) {
  if (subject === 'note') return NOTE_NAME.test(item);
  if (subject === 'int') return INTERVALS.some((i) => i.key === item);
  if (subject === 'scale') return Boolean(scaleById(item));
  if (subject === 'chord') return Boolean(qualityById(item));
  if (subject === 'prog') return Boolean(progressionById(item));
  return false;
}

/*
 * Where one old tally entry belongs: { subject, mode, item, pc? }, or null
 * for an answer that is no item — Higher or lower's "higher", a comparison's
 * "first bigger", a scale degree. Those stay in the tally, where they were.
 */
export function itemOfTally(drill, answer) {
  const parts = String(drill).split(':');
  if (parts.length !== 3) return null;
  if (parts[0] === 'ear') {
    const [exKey] = resolveLegacy(parts[1], parts[2]);
    const ex = exerciseByKey(exKey);
    const subject = exerciseSubject(ex);
    if (!subject || !isItem(subject, answer)) return null;
    return { subject, mode: ex.read ? 'read' : 'hear', item: answer };
  }
  const mode = OLD_MODE[parts[0]];
  if (!mode) return null;
  if (parts[1] === 'notes') {
    return NOTE_NAME.test(answer) ? { subject: 'note', mode, item: answer, pc: pcOfName(answer) } : null;
  }
  if (parts[1] !== 'chords') return null;
  /* The quality drills filed by quality ("m7", "maj"); the triads by name. */
  if (parts[2] !== 'triads') {
    const id = answer === 'maj' ? 'maj' : qualityOfSuffix(answer);
    return id ? { subject: 'chord', mode, item: id } : null;
  }
  const m = /^([A-G][#b]?)(.*)$/.exec(answer);
  const id = m ? qualityOfSuffix(m[2]) : null;
  return id ? { subject: 'chord', mode, item: id, pc: pcOfName(m[1]) } : null;
}

/*
 * The table, from a version 1 tally: { items, unmapped: [{ drill, answer }] }.
 * The tally is read, never changed.
 */
export function migrateTally(tally) {
  const items = {};
  const unmapped = [];
  const stats = { items };
  for (const drill of Object.keys(tally || {})) {
    for (const answer of Object.keys(tally[drill])) {
      const at = itemOfTally(drill, answer);
      if (!at) { unmapped.push({ drill, answer }); continue; }
      const n = tally[drill][answer];
      const round = { [at.item]: { n, keys: at.pc == null ? {} : { [at.pc]: n } } };
      addItems(stats, at.subject, at.mode, round);
    }
  }
  return { items, unmapped };
}

/* ---- Reading the history ---------------------------------------------------- */

export function forDrill(stats, id) {
  const out = [];
  for (let i = 0; i < stats.records.length; i++) {
    if (stats.records[i].d === id) out.push(stats.records[i]);
  }
  return out;
}

/* Every drill that has anything recorded, most recently played first, so the
 * Progress screen opens on what you were just doing. */
export function drillsWithHistory(stats) {
  const seen = {};
  const out = [];
  for (let i = stats.records.length - 1; i >= 0; i--) {
    const d = stats.records[i].d;
    if (seen[d]) continue;
    seen[d] = 1;
    out.push(d);
  }
  return out;
}

export function summarise(records) {
  if (!records.length) {
    return { count: 0, best: 0, average: 0, last: 0, errorRate: 0, lastError: 0 };
  }
  let best = 0;
  let total = 0;
  let correct = 0;
  let wrong = 0;
  for (let i = 0; i < records.length; i++) {
    const r = recordRate(records[i]);
    if (r > best) best = r;
    total += r;
    correct += records[i].n;
    wrong += records[i].w;
  }
  const last = records[records.length - 1];
  return {
    count: records.length,
    best,
    average: total / records.length,
    last: recordRate(last),
    /* Pooled over every attempt, not the mean of the per-round percentages:
     * a short round would otherwise weigh as heavily as a long one. */
    errorRate: correct + wrong ? wrong / (correct + wrong) : 0,
    lastError: recordError(last),
  };
}

/* Is this the best round yet for its drill? Called before the record is added. */
export function isPersonalBest(stats, rec) {
  const previous = summarise(forDrill(stats, rec.d));
  return previous.count === 0 || recordRate(rec) > previous.best;
}

/* ---- The plot ---------------------------------------------------------------- */

/*
 * Points for a sparkline inside a w x h box, oldest left, newest right, y
 * inverted for the screen. The arithmetic lives here rather than in the
 * renderer so the cases that make a tiny chart look broken can be tested: one
 * point, every value identical, and a single outlier flattening the rest.
 */
export function sparkline(records, w, h, limit = 40) {
  const use = records.length > limit ? records.slice(records.length - limit) : records;
  if (!use.length) return [];

  const rates = use.map(recordRate);
  let lo = rates[0];
  let hi = rates[0];
  for (let i = 1; i < rates.length; i++) {
    if (rates[i] < lo) lo = rates[i];
    if (rates[i] > hi) hi = rates[i];
  }
  /* A flat run would divide by zero; draw it down the middle instead. */
  const flat = hi - lo < 1e-9;
  const span = flat ? 1 : hi - lo;

  const lastX = w - 1;
  const lastY = h - 1;
  return rates.map((rate, i) => {
    const x = rates.length === 1 ? lastX : Math.round((i * lastX) / (rates.length - 1));
    const t = flat ? 0.5 : (rate - lo) / span;
    /* The error series rides on the same points rather than being computed by a
     * sibling function: two functions would each take their own `limit` and the
     * bars would silently stop lining up with the line they sit under. */
    return { x, y: Math.round(lastY - t * lastY), rate, err: recordError(use[i]) };
  });
}
