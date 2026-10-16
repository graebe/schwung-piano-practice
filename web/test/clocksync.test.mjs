// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * clocksync.test.mjs — the Move's playhead, drawn in this page's time.
 *
 * A simulated Move: a session at 120 bpm whose pictures take a different time
 * to arrive each -- 20 to 400 ms, as ui.js, the DSP, the manager's 300 ms read
 * throttle, WiFi and the iframe make them -- on a clock that is not the page's
 * and drifts against it. The playhead drawn from those pictures must be where
 * the Move is, to within one display frame, must never step back while the
 * music moves, and must never pass the note the Move waits on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClockSync, createPlayhead, SNAP_BEATS } from '../src/session/clocksync.js';

const BPM = 120;
const PER_BEAT = 60000 / BPM;
const FRAME_BEATS = (1000 / 60) / PER_BEAT;   /* one display frame, in beats */

/* Seeded, so a failure reproduces. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/*
 * The Move's time for a page time: an unknown offset, and 50 ppm of drift.
 * Pictures are published on the Move every `everyMs`, and each lands at the
 * page `delay()` later.
 */
function simulate({ seconds = 20, everyMs = 330, delay, waitAt = null, seed = 7 }) {
  const rand = rng(seed);
  const OFFSET = 123456.789;
  const moveAt = (page) => page * (1 + 50e-6) - OFFSET;
  const truth = (move) => {
    const b = (move - moveAt(0)) / PER_BEAT;
    return waitAt === null ? b : Math.min(b, waitAt);
  };
  const arrivals = [];
  for (let page = 0; page < seconds * 1000; page += everyMs) {
    const t = moveAt(page);
    const beats = truth(t);
    const blocked = waitAt !== null && beats >= waitAt;
    arrivals.push({ at: page + delay(rand), clock: {
      t, beats, perBeatMs: PER_BEAT, running: true, paused: false, blocked, waitAt,
    } });
  }
  arrivals.sort((a, b) => a.at - b.at);
  return { arrivals, truth: (page) => truth(moveAt(page)) };
}

/* Draw at 60 Hz, applying each picture as it arrives. */
function draw(arrivals, { from = 0, to }) {
  const ph = createPlayhead();
  const frames = [];
  let next = 0;
  for (let page = 0; page <= to; page += 1000 / 60) {
    while (next < arrivals.length && arrivals[next].at <= page) {
      ph.anchor(arrivals[next].clock, arrivals[next].at);
      next++;
    }
    if (page >= from) frames.push({ page, beats: ph.at(page) });
  }
  return frames;
}

test('the clocks\' offset is the smallest delay seen, and follows drift', () => {
  const sync = createClockSync();
  assert.equal(sync.deviceNow(5), null, 'nothing yet');
  sync.observe(1000, 5300);   /* 300 ms late */
  sync.observe(2000, 6050);   /*  50 ms late */
  sync.observe(3000, 7400);   /* 400 ms late */
  assert.equal(sync.offset, 4050);
  assert.equal(sync.deviceNow(8050), 4000);
  sync.observe(NaN, 1);
  assert.equal(sync.offset, 4050, 'a picture without a time says nothing');
  /* Old samples leave the window: a reset clock is forgotten. */
  const short = createClockSync({ samples: 2 });
  short.observe(0, 100);
  short.observe(10, 500);
  short.observe(20, 520);
  assert.equal(short.offset, 490);
});

/*
 * TWO NUMBERS, BECAUSE THEY ARE TWO THINGS. Pictures can be late but never
 * early, so the page can learn the offset plus the SMALLEST delay and no
 * better -- nothing it receives says how small that is. What remains is a
 * steady lag of that smallest delay (here 20 ms; a few ms on a LAN), which
 * does not move and so cannot be seen as a jump; and a wobble around it,
 * which is what the eye sees and what must be gone.
 */
test('through jittered delivery the playhead does not wobble, and lags by the smallest delay', () => {
  const MIN_DELAY = 20;
  const sim = simulate({ delay: (r) => MIN_DELAY + r() * 380 });
  const frames = draw(sim.arrivals, { from: 3000, to: 20000 });
  const lag = frames.map((f) => (sim.truth(f.page) - f.beats) * PER_BEAT);
  const lo = Math.min(...lag);
  const hi = Math.max(...lag);
  assert.ok(hi - lo <= 2, `the playhead wobbles by ${(hi - lo).toFixed(2)} ms`);
  assert.ok(lo >= 0 && hi <= MIN_DELAY + FRAME_BEATS * PER_BEAT,
    `it lags by ${lo.toFixed(1)}..${hi.toFixed(1)} ms; the smallest delay is ${MIN_DELAY}`);
});

test('it never steps back while the music moves', () => {
  const sim = simulate({ delay: (r) => (r() < 0.1 ? 400 : 20 + r() * 60), seed: 99 });
  const frames = draw(sim.arrivals, { to: 20000 });
  for (let i = 1; i < frames.length; i++) {
    assert.ok(frames[i].beats >= frames[i - 1].beats - 1e-9,
      `back from ${frames[i - 1].beats} to ${frames[i].beats} at ${frames[i].page} ms`);
  }
});

test('it stops on the note the Move waits for, and never draws past it', () => {
  const sim = simulate({ delay: (r) => 20 + r() * 380, waitAt: 8, seed: 3 });
  const frames = draw(sim.arrivals, { to: 10000 });
  for (const f of frames) assert.ok(f.beats <= 8 + 1e-9, `${f.beats} past the wait at ${f.page} ms`);
  assert.equal(frames.at(-1).beats, 8);
});

test('the old way, for the record: from arrival, the error is the delay', () => {
  /* The same delivery, anchored at arrival as the page used to: what this
   * file exists to fix. */
  const sim = simulate({ delay: (r) => 20 + r() * 380 });
  let worst = 0;
  let c = null;
  let at = 0;
  let next = 0;
  for (let page = 3000; page <= 20000; page += 1000 / 60) {
    while (next < sim.arrivals.length && sim.arrivals[next].at <= page) {
      ({ clock: c, at } = sim.arrivals[next++]);
    }
    worst = Math.max(worst, Math.abs(c.beats + (page - at) / PER_BEAT - sim.truth(page)));
  }
  assert.ok(worst > 10 * FRAME_BEATS, `the old way was off by ${(worst * PER_BEAT).toFixed(0)} ms`);
});

test('a resume after a wait is eased in, not stepped', () => {
  const ph = createPlayhead();
  const base = { perBeatMs: PER_BEAT, running: true, paused: false };
  ph.anchor({ ...base, t: 0, beats: 0, blocked: false, waitAt: 4 }, 50);
  assert.equal(ph.at(3000), 4, 'held on the note');
  /* The note is played at Move time 3000; the picture saying so is 200 ms late. */
  ph.anchor({ ...base, t: 3000, beats: 4, blocked: false, waitAt: 6 }, 3250);
  const a = ph.at(3250);
  const b = ph.at(3266);
  const c = ph.at(3600);
  assert.ok(a >= 4 && a < 4.2, `starts from the note, at ${a}`);
  assert.ok(b > a, 'and moves on');
  assert.ok(Math.abs(c - (4 + 550 / PER_BEAT)) < 0.02, `and has caught up by 350 ms: ${c}`);
});

test('a jump of a beat or more is drawn at once; a pause holds; no picture, no beat', () => {
  const ph = createPlayhead();
  assert.equal(ph.at(0), null);
  const base = { perBeatMs: PER_BEAT, running: true, paused: false, blocked: false, waitAt: null };
  ph.anchor({ ...base, t: 0, beats: 0 }, 0);
  ph.at(2000);
  ph.anchor({ ...base, t: 2000, beats: 4 + SNAP_BEATS }, 2000);   /* a seek */
  assert.equal(ph.at(2000), 4 + SNAP_BEATS);
  ph.anchor({ ...base, t: 2500, beats: 6, paused: true }, 2600);
  assert.equal(ph.at(9000), 6);
  /* An older module's clock, with no time: carried from its arrival. */
  const old = createPlayhead();
  old.anchor({ ...base, t: null, beats: 2 }, 1000);
  assert.equal(old.at(1500), 3);
});

test('a picture that teaches a smaller delay is eased in, not stepped', () => {
  /* The first picture was 300 ms late; the next, 20 ms late, shows the page
   * was drawing 280 ms behind -- under a beat, so a correction to ease. */
  const ph = createPlayhead();
  const base = { perBeatMs: 500, running: true, paused: false, blocked: false, waitAt: null };
  ph.anchor({ ...base, t: 0, beats: 0 }, 300);
  let last = ph.at(300);
  let worst = 0;
  let at = 300;
  for (let page = 300; page <= 1500; page += 1000 / 60) {
    if (page >= 920 && page - 1000 / 60 < 920) ph.anchor({ ...base, t: 900, beats: 1.8 }, 920);
    const b = ph.at(page);
    worst = Math.max(worst, b - last);
    last = b;
    at = page;
  }
  assert.ok(worst < 0.15, `the worst frame moved ${worst.toFixed(3)} beats`);
  /* Half a second on, the correction has faded: the truth is the Move's
   * beat at the page's time, 20 ms earlier on the Move. */
  const truth = 1.8 + (at - 20 - 900) / 500;
  assert.ok(Math.abs(last - truth) < 0.005, `and is in time by then: ${last} against ${truth}`);
});

