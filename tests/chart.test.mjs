import test from 'node:test';
import assert from 'node:assert/strict';

import {
  beatToX, xToBeat, msToBeats, beatsToMs, chartTotalBeats,
  visibleEvents, visibleBars, beatsPerBar, barBeatOf, labelLimitPx, isBeatEdge, applyWait,
} from '../src/chart.mjs';
import { HIT_X, DESPAWN_X, SPAWN_X, SCREEN_W, BAR_OFFSET_PX } from '../src/layout.mjs';

const chart = {
  bpm: 90,
  timeSig: [4, 4],
  keySig: 0,
  events: [
    { beat: 0, durBeats: 1, pitches: [60] },
    { beat: 1, durBeats: 1, pitches: [64] },
    { beat: 2, durBeats: 1, pitches: [67] },
    { beat: 8, durBeats: 1, pitches: [72] },
  ],
};

test('the event being played sits exactly on the hit line', () => {
  assert.equal(beatToX(4, 4, 24), HIT_X);
});

test('x moves left as time advances, at pxPerBeat per beat', () => {
  assert.equal(beatToX(2, 0, 24) - beatToX(2, 1, 24), 24);
  assert.ok(beatToX(2, 1, 24) < beatToX(2, 0, 24));
});

test('beatToX and xToBeat round-trip', () => {
  for (const px of [12, 24, 48]) {
    for (const beat of [0, 1.5, 7.25]) {
      assert.ok(Math.abs(xToBeat(beatToX(beat, 3, px), 3, px) - beat) < 1e-9);
    }
  }
});

test('ms and beats convert both ways at any tempo', () => {
  for (const bpm of [40, 90, 200]) {
    assert.ok(Math.abs(beatsToMs(msToBeats(1234, bpm), bpm) - 1234) < 1e-9);
  }
  assert.equal(msToBeats(1000, 60), 1);
  assert.equal(msToBeats(500, 120), 1);
});

test('only on-screen events are returned, in beat order', () => {
  const v = visibleEvents(chart, 0, 24);
  assert.deepEqual(v.map((e) => e.index), [0, 1, 2]);
  for (const e of v) {
    assert.ok(e.x >= DESPAWN_X && e.x <= SPAWN_X, `x ${e.x} out of band`);
  }
});

test('an event despawns once it passes the despawn edge', () => {
  /* beat 0 reaches DESPAWN_X when songBeats = (HIT_X - DESPAWN_X)/px */
  const gone = (HIT_X - DESPAWN_X) / 24 + 0.01;
  assert.ok(visibleEvents(chart, gone, 24).every((e) => e.index !== 0));
  const present = (HIT_X - DESPAWN_X) / 24 - 0.01;
  assert.ok(visibleEvents(chart, present, 24).some((e) => e.index === 0));
});

test('a slower read-ahead shows fewer events', () => {
  assert.ok(visibleEvents(chart, 0, 48).length <= visibleEvents(chart, 0, 12).length);
});

test('bar lines come from the time signature and sit just before the downbeat', () => {
  assert.equal(beatsPerBar(chart), 4);
  assert.equal(beatsPerBar({ ...chart, timeSig: [3, 4] }), 3);
  assert.equal(beatsPerBar({ ...chart, timeSig: [6, 8] }), 3);
  const bars = visibleBars(chart, 0, 24);
  assert.deepEqual(bars.map((b) => b.bar), [1, 2]);
  assert.equal(bars[0].x, HIT_X + BAR_OFFSET_PX);
  assert.ok(bars[0].x < beatToX(0, 0, 24), 'bar line precedes its downbeat');
});

test('bar lines stop at the end of the chart', () => {
  assert.equal(chartTotalBeats(chart), 9);
  const bars = visibleBars(chart, 8, 24);
  assert.ok(bars.every((b) => b.beat <= 9));
});

test('bar and beat readout is 1-based and clamps before the start', () => {
  assert.deepEqual(barBeatOf(chart, 0), { bar: 1, beat: 1 });
  assert.deepEqual(barBeatOf(chart, 5.5), { bar: 2, beat: 2 });
  assert.deepEqual(barBeatOf(chart, -2), { bar: 1, beat: 1 });
});

test('a label may not run into the next entry', () => {
  const v = visibleEvents(chart, 0, 24);
  assert.equal(labelLimitPx(v, 0, 24), v[1].x - v[0].x - 2);
  assert.equal(labelLimitPx(v, v.length - 1, 24), SCREEN_W - v[v.length - 1].x);
});

test('the beat edge fires once per beat', () => {
  assert.ok(isBeatEdge(0.99, 1.01));
  assert.ok(!isBeatEdge(1.01, 1.99));
  assert.ok(isBeatEdge(-0.01, 0.01));
});

/* ---- Wait-for-note clock -------------------------------------------------- */

test('with nothing blocking, the clock is plain wall time', () => {
  assert.deepEqual(applyWait(5, 0, null), { songBeats: 5, waitedBeats: 0, blocked: false });
  assert.deepEqual(applyWait(5, 1, undefined), { songBeats: 4, waitedBeats: 1, blocked: false });
});

test('before the block is reached the clock runs freely', () => {
  const r = applyWait(4, 0, 4.2);
  assert.equal(r.songBeats, 4);
  assert.equal(r.blocked, false);
  assert.equal(r.waitedBeats, 0);
});

test('past the block the clock pins and soaks up the frozen time', () => {
  const r = applyWait(5, 0, 4.2);
  assert.equal(r.songBeats, 4.2);
  assert.equal(r.blocked, true);
  assert.ok(Math.abs(r.waitedBeats - 0.8) < 1e-9);
});

test('the playhead does not move however long it is frozen', () => {
  let waited = 0;
  let last = null;
  for (let raw = 4.2; raw < 12; raw += 0.13) {
    const r = applyWait(raw, waited, 4.2);
    waited = r.waitedBeats;
    assert.equal(r.songBeats, 4.2);
    if (last !== null) assert.ok(r.songBeats >= last, 'never runs backwards');
    last = r.songBeats;
  }
  assert.ok(waited > 7, 'all that time was absorbed');
});

test('releasing resumes in tempo rather than lurching forward to catch up', () => {
  /* Frozen from raw 4.2 to raw 10, then the note is played. */
  let waited = 0;
  for (let raw = 4.2; raw < 10; raw += 0.1) waited = applyWait(raw, waited, 4.2).waitedBeats;
  const released = applyWait(10, waited, null);
  assert.ok(Math.abs(released.songBeats - 4.2) < 0.15, 'picks up where it stopped');
  const later = applyWait(11, released.waitedBeats, null);
  assert.ok(Math.abs(later.songBeats - released.songBeats - 1) < 1e-9, 'and runs at 1 beat per beat');
});

test('a block already behind the playhead does not drag time backwards', () => {
  /* Only reachable if wait is switched on with a stale backlog; resyncWait in
   * scoring.mjs is what prevents it, but the clock must not explode either. */
  const r = applyWait(10, 0, 2);
  assert.equal(r.songBeats, 2);
  assert.equal(r.blocked, true);
});
