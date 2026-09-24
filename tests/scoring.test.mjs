import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRun, judgeNoteOn, expireMissed, runStats, runFinished,
  blockingBeat, blockingNotes, blockingEntryIndex, resyncWait,
  addMarker, pruneMarkers,
  DEFAULT_WINDOWS, PENDING, HIT, MISSED,
} from '../src/scoring.mjs';
import { msToBeats } from '../src/chart.mjs';

/* 60 BPM makes one beat exactly one second, so a window in ms is the same
 * number in units of 1/1000 beat and the arithmetic stays readable. */
const single = {
  bpm: 60, timeSig: [4, 4], keySig: 0,
  events: [
    { beat: 0, durBeats: 1, pitches: [60] },
    { beat: 1, durBeats: 1, pitches: [62] },
    { beat: 2, durBeats: 1, pitches: [64] },
  ],
};
const chordChart = {
  bpm: 60, timeSig: [4, 4], keySig: 0,
  events: [{ beat: 0, durBeats: 2, pitches: [60, 64, 67] }],
};

const ms = (n) => msToBeats(n, 60);

test('a note dead on the beat is perfect', () => {
  const run = createRun(single);
  assert.equal(judgeNoteOn(run, 60, 0).result, 'perfect');
  assert.equal(run.entries[0].notes[0].state, HIT);
  assert.equal(runStats(run).perfects, 1);
});

test('the perfect window ends where the good window begins', () => {
  let run = createRun(single);
  assert.equal(judgeNoteOn(run, 60, ms(DEFAULT_WINDOWS.perfectMs)).result, 'perfect');
  run = createRun(single);
  assert.equal(judgeNoteOn(run, 60, ms(DEFAULT_WINDOWS.perfectMs + 1)).result, 'good');
  run = createRun(single);
  assert.equal(judgeNoteOn(run, 60, -ms(DEFAULT_WINDOWS.perfectMs)).result, 'perfect');
});

test('the window is tight early and as wide as Grace late', () => {
  /*
   * Asymmetric on purpose. A press well BEFORE a note is a mistake, and a wide
   * early window would let it swallow the note after the one you meant. Late
   * is Grace, because "how long a late note still counts" is what Grace means.
   */
  let run = createRun(single);
  assert.equal(judgeNoteOn(run, 60, ms(DEFAULT_WINDOWS.goodMs)).result, 'good');

  /* Early is TWICE the good window: playing ahead of the beat is the commonest
   * way to be wrong about a note you actually know, and 120ms punished it. */
  run = createRun(single);
  assert.equal(judgeNoteOn(run, 60, -ms(2 * DEFAULT_WINDOWS.goodMs - 1)).result, 'good',
    'inside twice the good window, early counts');
  run = createRun(single);
  const early = judgeNoteOn(run, 60, -ms(2 * DEFAULT_WINDOWS.goodMs + 1));
  assert.equal(early.result, 'stray', 'beyond it, too early is still a stray');
  assert.equal(run.entries[0].notes[0].state, PENDING, 'and the note is still up for grabs');

  /* Late, inside Grace: it counts. */
  run = createRun(single, { graceBeats: 1 });
  assert.equal(judgeNoteOn(run, 60, 0.9).result, 'good');

  /* Late, past Grace: it does not. */
  run = createRun(single, { graceBeats: 1 });
  assert.equal(judgeNoteOn(run, 60, 1.1).result, 'stray');
});

test('a wrong pitch inside the window is a stray', () => {
  const run = createRun(single);
  assert.equal(judgeNoteOn(run, 61, 0).result, 'stray');
  assert.equal(run.entries[0].notes[0].state, PENDING);
});

test('the press resolves the nearest matching note, not the first', () => {
  const repeated = {
    bpm: 60, timeSig: [4, 4], keySig: 0,
    events: [
      { beat: 0, durBeats: 1, pitches: [60] },
      { beat: 0.1, durBeats: 1, pitches: [60] },
    ],
  };
  const run = createRun(repeated);
  const j = judgeNoteOn(run, 60, 0.09);
  assert.equal(j.entryIndex, 1);
  assert.equal(run.entries[0].notes[0].state, PENDING);
});

test('a note past the late window is missed and breaks the streak', () => {
  const run = createRun(single);
  judgeNoteOn(run, 60, 0);
  assert.equal(run.combo, 1);
  const expired = expireMissed(run, 1 + ms(DEFAULT_WINDOWS.lateMs) + 0.001);
  assert.equal(expired, 1);
  assert.equal(run.entries[1].notes[0].state, MISSED);
  assert.equal(run.combo, 0);
  assert.equal(run.bestCombo, 1);
});

test('expireMissed leaves anything still inside its window alone', () => {
  const run = createRun(single);
  assert.equal(expireMissed(run, ms(DEFAULT_WINDOWS.lateMs) - 0.001), 0);
  assert.equal(run.entries[0].notes[0].state, PENDING);
});

test('a chord gives partial credit: hits go fat, the rest turn to X', () => {
  const run = createRun(chordChart);
  judgeNoteOn(run, 60, 0);
  judgeNoteOn(run, 64, ms(50));
  expireMissed(run, 1);
  const states = run.entries[0].notes.map((n) => n.pitch + ':' + n.state);
  assert.deepEqual(states, ['60:hit', '64:hit', '67:missed']);
  assert.equal(run.entries[0].state, 'partial');
  const s = runStats(run);
  assert.equal(s.hits, 2);
  assert.equal(s.misses, 1);
});

test('a fully played chord resolves as hit', () => {
  const run = createRun(chordChart);
  for (const p of [60, 64, 67]) judgeNoteOn(run, p, ms(20));
  assert.equal(run.entries[0].state, HIT);
  assert.equal(runStats(run).misses, 0);
});

test('one pad press resolves one note, not the whole chord', () => {
  const run = createRun(chordChart);
  judgeNoteOn(run, 60, 0);
  judgeNoteOn(run, 60, ms(20));
  assert.equal(runStats(run).hits, 1);
  assert.equal(runStats(run).strays, 1);
});

test('any-octave mode accepts a different register, exact mode does not', () => {
  const strict = createRun(single);
  assert.equal(judgeNoteOn(strict, 72, 0).result, 'stray');
  const loose = createRun(single, { anyOctave: true });
  assert.equal(judgeNoteOn(loose, 72, 0).result, 'perfect');
  assert.equal(loose.entries[0].notes[0].state, HIT);
});

test('windows scale with tempo: the same milliseconds, fewer beats', () => {
  const slow = createRun({ ...single, bpm: 60 });
  const fast = createRun({ ...single, bpm: 120 });
  assert.ok(fast.good > slow.good, 'a beat is shorter, so the window spans more of it');
  assert.equal(slow.good, msToBeats(DEFAULT_WINDOWS.goodMs, 60));
  assert.equal(fast.good, msToBeats(DEFAULT_WINDOWS.goodMs, 120));
});

test('the cursor only moves past fully resolved entries', () => {
  const run = createRun(chordChart);
  judgeNoteOn(run, 60, 0);
  assert.equal(run.cursor, 0, 'chord still has pending notes');
  judgeNoteOn(run, 64, 0);
  judgeNoteOn(run, 67, 0);
  assert.equal(run.cursor, 1);
});

test('the run ends only once everything is resolved and scrolled past', () => {
  const run = createRun(single);
  assert.ok(!runFinished(run, 0));
  for (const [p, b] of [[60, 0], [62, 1], [64, 2]]) judgeNoteOn(run, p, b);
  assert.ok(!runFinished(run, 2));
  assert.ok(runFinished(run, 2 + run.late + 0.001));
});

test('accuracy counts judged notes only, and starts at zero', () => {
  const run = createRun(single);
  assert.equal(runStats(run).accuracy, 0);
  judgeNoteOn(run, 60, 0);
  assert.equal(runStats(run).accuracy, 1);
  expireMissed(run, 99);
  assert.ok(Math.abs(runStats(run).accuracy - 1 / 3) < 1e-9);
  assert.equal(runStats(run).total, 3);
});

/* ---- Wait for note ------------------------------------------------------- */
/*
 * Scoring and waiting are deliberately separate. A note past its window is a
 * miss AND still blocks the scroll; the two facts cannot share one flag.
 */

const GRACE = 1 / 3;

test('nothing blocks before a note is due', () => {
  const run = createRun(single);
  /* The note's OWN beat: freezing here puts it exactly on the hit line.
   * beatToX maps songBeats to HIT_X, so any offset would be visible drift. */
  assert.equal(blockingBeat(run), 0);
});

test('a note played in time never blocks', () => {
  const run = createRun(single);
  for (const [p, b] of [[60, 0], [62, 1], [64, 2]]) judgeNoteOn(run, p, b);
  assert.equal(blockingBeat(run), null);
});

test('an expired note is scored a miss and still blocks the scroll', () => {
  const run = createRun(single);
  expireMissed(run, 0.5, true);
  assert.equal(run.entries[0].notes[0].state, MISSED, 'it counts as a miss');
  assert.equal(run.entries[0].notes[0].played, false, 'but it has not been played');
  assert.equal(runStats(run).misses, 1);
  assert.equal(blockingBeat(run), 0, 'and it holds the scroll');
});

test('playing the blocking note releases it and scores nothing more', () => {
  const run = createRun(single);
  expireMissed(run, 0.5, true);
  const before = runStats(run);
  const j = judgeNoteOn(run, 60, 0.5);
  assert.equal(j.result, 'late');
  assert.equal(blockingBeat(run), 1, 'moved on to the next note');
  const after = runStats(run);
  assert.equal(after.hits, before.hits, 'a late release is not a hit');
  assert.equal(after.misses, before.misses, 'and does not double-count the miss');
  assert.equal(after.strays, before.strays, 'nor is it a stray');
  assert.equal(run.entries[0].notes[0].state, MISSED, 'the miss stands');
});

test('the wrong pad does not release the block', () => {
  const run = createRun(single);
  expireMissed(run, 0.5, true);
  assert.equal(judgeNoteOn(run, 61, 0.5).result, 'stray');
  assert.equal(blockingBeat(run), 0, 'still stuck');
});

/*
 * THE DEAD ZONE. A regression test for a hole that no existing test saw.
 *
 * The scroll freezes ON the note now, so the note is PENDING while you hunt
 * for it. releaseBlocked only releases a note already scored MISSED, and the
 * match window used to be `good` — so a press between 120ms and Grace matched
 * nothing and released nothing. The right pad, pressed, with the scroll
 * sitting frozen and no feedback, until the note expired on its own. At the
 * default Grace that was 600ms of the instrument appearing to be broken.
 */
test('the right pad always releases the scroll, at every lateness', () => {
  for (const [lateBeats, wantResult] of [
    [0.02, 'perfect'], [0.3, 'good'], [0.8, 'good'], [1.5, 'late'], [4.0, 'late'],
  ]) {
    const run = createRun(single, { graceBeats: 1 });
    /* What the frame loop does: the judge sees real time even though the
     * scroll is pinned on the note. */
    expireMissed(run, lateBeats, true);
    const j = judgeNoteOn(run, 60, lateBeats);
    assert.equal(j.result, wantResult, `${lateBeats} beats late`);
    assert.equal(run.entries[0].notes[0].played, true,
      `${lateBeats} beats late: the press did not release the scroll`);
    assert.notEqual(blockingBeat(run), 0, 'and the scroll has moved on');
  }
});

test('grace widens how late still counts, and never narrows it', () => {
  /*
   * Grace used to move the point the SCROLL stopped at, which is why a missed
   * note sailed a beat past the hit line. It is the scoring window now: the
   * halt is always the note, and this decides how forgiving the judgement is.
   */
  const plain = createRun(single);
  const forgiving = createRun(single, { graceBeats: 1 });
  assert.ok(forgiving.late > plain.late, 'a beat of grace is more than 180ms');
  assert.equal(forgiving.late, 1);

  /* Turning it down cannot make the drill stricter than the scoring windows
   * it is graded against. */
  const strict = createRun(single, { graceBeats: 1 / 64 });
  assert.equal(strict.late, plain.late, 'floored at the late window');

  /* And it moves neither halt point. */
  assert.equal(blockingBeat(plain), blockingBeat(forgiving));
});

test('a note found long after the freeze is a miss, not a perfect hit', () => {
  /*
   * The scroll stops on the note, so the DISPLAY clock is pinned there. If the
   * judge read that clock every press would land at offset zero and a miss
   * could never happen. It reads real time instead, which is what scoreBeats
   * carries — this is that contract, from the scoring side.
   */
  const run = createRun(single, { graceBeats: 1 / 3 });
  expireMissed(run, 3, true);   /* three beats of real time went by */
  assert.equal(run.entries[0].notes[0].state, MISSED);
  assert.equal(judgeNoteOn(run, 60, 3).result, 'late', 'not scored as on time');
  assert.equal(runStats(run).hits, 0);
});

test('with wait off an expired note is gone and blocks nothing', () => {
  const run = createRun(single);
  expireMissed(run, 0.5, false);
  assert.equal(run.entries[0].notes[0].played, true, 'marked gone, not awaited');
  assert.equal(blockingBeat(run), 1);
});

test('a chord blocks until every note of it is played', () => {
  const run = createRun(chordChart);
  expireMissed(run, 1, true);
  assert.equal(blockingBeat(run), 0);
  judgeNoteOn(run, 60, 1);
  assert.notEqual(blockingBeat(run), null, 'two notes still missing');
  judgeNoteOn(run, 64, 1);
  judgeNoteOn(run, 67, 1);
  assert.equal(blockingBeat(run), null);
});

test('resyncWait clears a backlog so the clock cannot jump backwards', () => {
  const run = createRun(single);
  expireMissed(run, 99, false);
  /* Simulate having been in wait-off mode with notes left unplayed. */
  for (const e of run.entries) for (const n of e.notes) n.played = false;
  run.waitCursor = 0;
  assert.equal(blockingBeat(run), 0, 'parked in the past');
  resyncWait(run, 5);
  assert.equal(blockingBeat(run), null, 'caught up to the playhead');
});

test('resyncWait leaves notes still ahead of the playhead alone', () => {
  const run = createRun(single);
  resyncWait(run, 1.5);
  assert.equal(run.entries[2].notes[0].played, false, 'beat 2 has not happened yet');
  assert.equal(blockingBeat(run), 2);
});

test('the run cannot finish while the scroll is frozen', () => {
  /*
   * With wait OFF the whole chart expires, so the scoring cursor really is
   * done. With it ON only the blocking note can expire — a note the scroll
   * never reached cannot be missed — which is why this uses the unwaited run
   * to reach the finished state at all.
   */
  const done = createRun(single);
  expireMissed(done, 99, false);
  assert.equal(done.cursor, done.entries.length, 'everything is scored');
  assert.equal(runFinished(done, 99, false), true);
  /* ...but a frozen scroll is never finished, whatever the cursor says. */
  assert.equal(runFinished(done, 99, true), false);
});

test('waiting stops the expiry at the note the scroll is on', () => {
  /*
   * The regression that mattered: this clock is real time and keeps running
   * while the display sits frozen, so without the bound a single stall X-ed
   * out every note behind it. Five misses for one stall, none of them shown.
   */
  const run = createRun(single);
  expireMissed(run, 99, true);
  assert.equal(runStats(run).misses, 1, 'only the note being waited for');
  assert.equal(run.entries[1].notes[0].state, PENDING, 'the next one was never reached');
});

/* ---- Played markers ------------------------------------------------------ */

test('a marker records the pitch and the exact moment', () => {
  const run = createRun(single);
  addMarker(run, 60, 1.234);
  assert.deepEqual(run.markers, [{ beat: 1.234, pitch: 60 }]);
});

test('markers are capped, oldest dropped, so a long run cannot grow unbounded', () => {
  const run = createRun(single);
  for (let i = 0; i < 200; i++) addMarker(run, 60 + (i % 12), i, 64);
  assert.equal(run.markers.length, 64);
  assert.equal(run.markers[run.markers.length - 1].beat, 199);
});

test('markers that have scrolled off are pruned', () => {
  const run = createRun(single);
  addMarker(run, 60, 0);
  addMarker(run, 62, 1);
  addMarker(run, 64, 2);
  pruneMarkers(run, 1.5);
  assert.deepEqual(run.markers.map((m) => m.beat), [2]);
});

/* ---- Which note you are stuck on ----------------------------------------- */
/*
 * One definition, shared by the pad that lights up and the name on screen. If
 * those disagreed the rescue would be worse than none.
 */

test('nothing is blocking until a note has actually been missed', () => {
  const run = createRun(single);
  /* Pending notes are not "stuck" notes — the first entry is simply next. */
  assert.deepEqual(blockingNotes(run).map((n) => n.pitch), [60]);
  for (const [p, b] of [[60, 0], [62, 1], [64, 2]]) judgeNoteOn(run, p, b);
  assert.deepEqual(blockingNotes(run), [], 'all played, nothing to be stuck on');
});

test('a missed note is exactly what blockingNotes reports', () => {
  const run = createRun(single);
  expireMissed(run, 0.5, true);
  const stuck = blockingNotes(run);
  assert.deepEqual(stuck.map((n) => n.pitch), [60]);
  assert.equal(stuck[0].state, MISSED, 'scored');
  assert.equal(stuck[0].played, false, 'and still owed');
});

test('the scoring cursor cannot find it — which is the bug this fixes', () => {
  const run = createRun(single);
  expireMissed(run, 0.5, true);
  /* run.cursor has advanced past the missed note and its state is no longer
   * PENDING, so anything keyed off those two can never light it. */
  assert.ok(run.cursor > 0);
  assert.notEqual(run.entries[0].notes[0].state, PENDING);
  assert.equal(blockingNotes(run)[0], run.entries[0].notes[0], 'the wait pointer still has it');
});

test('a part-played chord reports only the notes still owed', () => {
  const run = createRun(chordChart);
  expireMissed(run, 1, true);
  assert.equal(blockingNotes(run).length, 3);
  judgeNoteOn(run, 64, 1);
  assert.deepEqual(blockingNotes(run).map((n) => n.pitch), [60, 67]);
  judgeNoteOn(run, 60, 1);
  judgeNoteOn(run, 67, 1);
  assert.deepEqual(blockingNotes(run), []);
});

test('with wait off nothing is ever reported stuck', () => {
  const run = createRun(single);
  expireMissed(run, 99, false);
  assert.deepEqual(blockingNotes(run), []);
});

test('the blocking entry index agrees with the notes it reports', () => {
  const run = createRun(single);
  expireMissed(run, 0.5, true);
  const at = blockingEntryIndex(run);
  assert.equal(at, 0);
  assert.equal(run.entries[at].notes[0], blockingNotes(run)[0],
    'the pads, the callout and the notehead must name one note');
});

test('nothing is blocking once everything is played', () => {
  const run = createRun(single);
  for (const [p, b] of [[60, 0], [62, 1], [64, 2]]) judgeNoteOn(run, p, b);
  assert.equal(blockingEntryIndex(run), -1);
});
