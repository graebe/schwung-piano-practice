import test from 'node:test';
import assert from 'node:assert/strict';

import {
  drillId, drillLabel, ratePerMinute, makeRecord, recordRate, emptyStats, addRecord,
  parseStats, serialiseStats, forDrill, drillsWithHistory, summarise, isPersonalBest,
  sparkline, MAX_RECORDS,
} from '../src/stats.mjs';

const rec = (drill, ms, n = 20, at = 0) => makeRecord({ drill, n, ms, at });

/* ---- The metric -------------------------------------------------------------- */

test('the rate is correct answers per minute', () => {
  assert.equal(ratePerMinute(20, 60000), 20);
  assert.equal(ratePerMinute(20, 30000), 40, 'twice as fast is twice the rate');
  assert.equal(ratePerMinute(10, 60000), 10);
});

test('a slower round scores lower — which is how a wrong answer costs you', () => {
  /* A prompt stays until you get it right, so errors show up as time, not as a
   * separate penalty. */
  assert.ok(recordRate(rec('d', 70000)) < recordRate(rec('d', 50000)));
});

test('a zero-length round reads as zero rather than dividing by zero', () => {
  assert.equal(ratePerMinute(20, 0), 0);
  assert.equal(ratePerMinute(20, -5), 0);
});

/* ---- Drill identity ----------------------------------------------------------- */

test('drills that are different tasks get different ids', () => {
  const ids = new Set([
    drillId({ kind: 'notes', halfTones: false }),
    drillId({ kind: 'notes', halfTones: true }),
    drillId({ kind: 'chords', chordSet: 'triads' }),
    drillId({ kind: 'chords', chordSet: 'types' }),
    drillId({ hear: true, kind: 'notes', halfTones: false }),
    drillId({ hear: true, kind: 'notes', halfTones: true }),
    drillId({ hear: true, kind: 'chords', chordSet: 'triads' }),
    drillId({ hear: true, kind: 'chords', chordSet: 'types' }),
  ]);
  assert.equal(ids.size, 8, 'two unlike tasks must never share a trend line');
});

test('a setting that does not change the task does not split the history', () => {
  /* Key and octave change which notes, not how hard the task is. */
  assert.equal(drillId({ kind: 'notes', halfTones: true }),
               drillId({ kind: 'notes', halfTones: true, chordSet: 'types' }),
               'chordSet is irrelevant to a note drill');
});

test('every drill id reads as something a person can understand', () => {
  for (const hear of [false, true]) {
    for (const kind of ['notes', 'chords']) {
      for (const v of [true, false]) {
        const id = drillId({ hear, kind, halfTones: v, chordSet: v ? 'types' : 'triads' });
        const label = drillLabel(id);
        assert.ok(label.length > 3 && !label.includes(':'), `${id} -> ${label}`);
        assert.ok(label.length <= 21, `${label} is too wide for the screen`);
      }
    }
  }
});

/* ---- Storage ------------------------------------------------------------------ */

test('records survive a round trip through the file', () => {
  const s = emptyStats();
  addRecord(s, rec('guess:notes:half', 52000, 20, 1700000000000));
  const back = parseStats(serialiseStats(s));
  assert.deepEqual(back.records, s.records);
});

test('a corrupt or truncated file reads as no history, never a throw', () => {
  /* Losing the plot is much better than failing to open the module. */
  for (const junk of ['', '{', 'null', '[]', '{"records":3}', 'not json at all']) {
    assert.doesNotThrow(() => parseStats(junk));
    assert.deepEqual(parseStats(junk).records, []);
  }
});

test('individually broken records are dropped, the rest kept', () => {
  const text = JSON.stringify({
    version: 1,
    records: [
      { d: 'a', n: 20, ms: 50000 },
      { d: 'a', n: 0, ms: 50000 },        /* no prompts */
      { n: 20, ms: 50000 },               /* no drill */
      { d: 'a', n: 20, ms: -1 },          /* impossible time */
      'nonsense',
      { d: 'a', n: 10, ms: 30000 },
    ],
  });
  assert.equal(parseStats(text).records.length, 2);
});

test('the history is capped, oldest dropped first', () => {
  const s = emptyStats();
  for (let i = 0; i < MAX_RECORDS + 25; i++) addRecord(s, rec('d', 60000, 20, i));
  assert.equal(s.records.length, MAX_RECORDS);
  assert.equal(s.records[s.records.length - 1].t, Math.round((MAX_RECORDS + 24) / 1000));
});

/* ---- Reading it back ----------------------------------------------------------- */

test('a drill only ever sees its own rounds', () => {
  const s = emptyStats();
  addRecord(s, rec('guess:notes:key', 60000));
  addRecord(s, rec('hear:chords:types', 90000));
  addRecord(s, rec('guess:notes:key', 50000));
  assert.equal(forDrill(s, 'guess:notes:key').length, 2);
  assert.equal(forDrill(s, 'hear:chords:types').length, 1);
  assert.deepEqual(forDrill(s, 'never:played:this'), []);
});

test('the drill list is most recently played first, without duplicates', () => {
  const s = emptyStats();
  addRecord(s, rec('a', 60000));
  addRecord(s, rec('b', 60000));
  addRecord(s, rec('a', 60000));
  assert.deepEqual(drillsWithHistory(s), ['a', 'b'], 'so Progress opens on what you just played');
});

test('summarise handles none, one and many', () => {
  assert.deepEqual(summarise([]), { count: 0, best: 0, average: 0, last: 0 });
  const one = summarise([rec('d', 60000)]);
  assert.equal(one.count, 1);
  assert.equal(one.best, one.average);
  assert.equal(one.best, one.last);
  const many = summarise([rec('d', 60000), rec('d', 30000), rec('d', 120000)]);
  assert.equal(Math.round(many.best), 40);
  assert.equal(Math.round(many.last), 10, 'last is the latest, not the best');
  assert.ok(many.average > many.last && many.average < many.best);
});

test('the first round of a drill is always a personal best', () => {
  const s = emptyStats();
  assert.equal(isPersonalBest(s, rec('d', 90000)), true);
  addRecord(s, rec('d', 60000));
  assert.equal(isPersonalBest(s, rec('d', 50000)), true, 'faster');
  assert.equal(isPersonalBest(s, rec('d', 70000)), false, 'slower');
  assert.equal(isPersonalBest(s, rec('other', 70000)), true, 'a different drill starts fresh');
});

/* ---- The plot ------------------------------------------------------------------ */

test('the sparkline fits inside the box it is given', () => {
  const records = [90000, 70000, 60000, 55000, 50000].map((ms) => rec('d', ms));
  for (const [w, h] of [[120, 24], [40, 10], [8, 4]]) {
    for (const p of sparkline(records, w, h)) {
      assert.ok(p.x >= 0 && p.x < w, `x ${p.x} outside 0..${w - 1}`);
      assert.ok(p.y >= 0 && p.y < h, `y ${p.y} outside 0..${h - 1}`);
    }
  }
});

test('faster rounds plot higher — y is inverted for the screen', () => {
  const pts = sparkline([rec('d', 120000), rec('d', 30000)], 100, 20);
  assert.ok(pts[1].y < pts[0].y, 'the faster round should be nearer the top');
});

test('a single round plots without dividing by zero', () => {
  const pts = sparkline([rec('d', 60000)], 100, 20);
  assert.equal(pts.length, 1);
  assert.ok(isFinite(pts[0].x) && isFinite(pts[0].y));
});

test('a flat run draws down the middle instead of collapsing', () => {
  const pts = sparkline([rec('d', 60000), rec('d', 60000), rec('d', 60000)], 100, 20);
  assert.equal(new Set(pts.map((p) => p.y)).size, 1, 'all the same height');
  assert.ok(pts[0].y > 0 && pts[0].y < 19, 'and not jammed against an edge');
});

test('a realistic spread of rounds is visibly a spread', () => {
  /* Rounds vary maybe twofold between a bad day and a good one; at that range
   * the points must not collapse onto each other. */
  const pts = sparkline(
    [rec('d', 90000), rec('d', 75000), rec('d', 60000), rec('d', 50000)], 100, 24);
  assert.equal(new Set(pts.map((p) => p.y)).size, 4, 'four different rounds, four heights');
});

test('an extreme value compresses the rest, and that is the honest answer', () => {
  /* The scale is linear between the lowest and highest round. One freak result
   * therefore squashes the others toward the baseline — which is true, and
   * preferable to a chart that quietly rescales and flatters you. It must still
   * stay inside its box. */
  const pts = sparkline(
    [rec('d', 60000), rec('d', 58000), rec('d', 62000), rec('d', 5000)], 100, 24);
  for (const p of pts) {
    assert.ok(p.x >= 0 && p.x < 100 && p.y >= 0 && p.y < 24);
  }
  assert.equal(pts[3].y, 0, 'the freak round is at the top');
});

test('a long history is trimmed to the most recent, left to right', () => {
  const records = [];
  for (let i = 0; i < 120; i++) records.push(rec('d', 60000 - i * 100));
  const pts = sparkline(records, 100, 20, 40);
  assert.equal(pts.length, 40);
  assert.equal(pts[0].x, 0);
  assert.equal(pts[pts.length - 1].x, 99, 'the newest round is at the right edge');
  assert.ok(pts[pts.length - 1].rate > pts[0].rate, 'and it is the most recent, not the oldest');
});

test('an empty history plots nothing rather than throwing', () => {
  assert.deepEqual(sparkline([], 100, 20), []);
});

test('the multiple-choice drills get their own trends', () => {
  const ids = new Set();
  for (const pick of [false, true]) {
    for (const hear of [false, true]) {
      for (const kind of ['notes', 'chords']) {
        for (const v of [false, true]) {
          ids.add(drillId({ pick, hear, kind, halfTones: v, chordSet: v ? 'types' : 'triads' }));
        }
      }
    }
  }
  /* pick overrides hear, so the pick half collapses to four, not eight. */
  assert.equal(ids.size, 12, 'eight existing drills plus four new ones');
  assert.ok(ids.has('pick:notes:half'));
  assert.ok(ids.has('pick:chords:types'));
});
