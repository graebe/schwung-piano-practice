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

export const STATS_VERSION = 1;
export const MAX_RECORDS = 200;   /* ~12KB; the file cannot grow without bound */

/* ---- Which drill a round belongs to ---------------------------------------- */

/*
 * A stable key from the settings that change what is being asked. Anything that
 * changes the difficulty has to be in here, or two unlike tasks would share a
 * trend line and the plot would be measuring the wrong thing.
 */
export function drillId({ hear = false, pick = false, kind = 'notes',
                          chordSet = 'triads', halfTones = false } = {}) {
  const mode = pick ? 'pick' : (hear ? 'hear' : 'guess');
  if (kind === 'chords') return mode + ':chords:' + (chordSet === 'types' ? 'types' : 'triads');
  return mode + ':notes:' + (halfTones ? 'half' : 'key');
}

const DRILL_WORDS = {
  guess: 'Guess', hear: 'Hear', pick: 'Name',
  notes: 'notes', chords: 'chords',
  half: 'chromatic', key: 'in key', types: 'types', triads: 'triads',
};

/* Readable, and inside 21 characters — the widest the 6px font fits on a
 * 128px line. "Guess chords all types" was 22 and overflowed. */
export function drillLabel(id) {
  const parts = String(id).split(':');
  if (parts.length !== 3) return String(id);
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

export function makeRecord({ drill, n, ms, wrong = 0, hints = 0, at = 0 }) {
  return {
    t: Math.round(at / 1000),   /* seconds: the file is read by humans too */
    d: drill,
    n,
    ms: Math.round(ms),
    w: wrong,
    h: hints,
  };
}

export function recordRate(rec) {
  return ratePerMinute(rec.n, rec.ms);
}

export function emptyStats() {
  return { version: STATS_VERSION, records: [] };
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
    records.push({
      t: typeof r.t === 'number' ? r.t : 0,
      d: r.d,
      n: r.n,
      ms: r.ms,
      w: typeof r.w === 'number' ? r.w : 0,
      h: typeof r.h === 'number' ? r.h : 0,
    });
  }
  return { version: STATS_VERSION, records };
}

export function serialiseStats(stats) {
  return JSON.stringify({ version: STATS_VERSION, records: stats.records });
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
  if (!records.length) return { count: 0, best: 0, average: 0, last: 0 };
  let best = 0;
  let total = 0;
  for (let i = 0; i < records.length; i++) {
    const r = recordRate(records[i]);
    if (r > best) best = r;
    total += r;
  }
  return {
    count: records.length,
    best,
    average: total / records.length,
    last: recordRate(records[records.length - 1]),
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
    return { x, y: Math.round(lastY - t * lastY), rate };
  });
}
