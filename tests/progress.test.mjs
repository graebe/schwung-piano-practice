import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PASS, HISTORY_CAP, REP_INTERVALS, REP_SESSION, MARK_DONE, MARK_HALF, MARK_SKIP,
  emptyProgress, parseProgress, serialiseProgress, item, recordAttempt,
  exerciseScore, quizScore, quizStage,
  stagePassed, stageScore, stagePlayed, itemPercent, itemMark, isFinished, recommendedStage,
  skipItem, moveOn, repetitionSession, dueCount,
  createAggregator, resetShape, isTracked, leafIds, summariseIds, folderSummary, recentIds,
  accuracySeries, passTimeline,
} from '../src/progress.mjs';

const DAY = 86400000;
const T0 = Date.UTC(2026, 9, 1, 12);
const play = (p, id, stage, score, at = T0, bpm = 80) => recordAttempt(p, id, { stage, score, at, bpm });

/* ---- Scoring -------------------------------------------------------------- */

test('a run scores hits over notes plus strays, so sweeping the pads cannot score full marks', () => {
  assert.equal(exerciseScore({ hits: 20, total: 20, strays: 0 }), 1);
  assert.equal(exerciseScore({ hits: 20, total: 20, strays: 20 }), 0.5);
  assert.equal(exerciseScore({ hits: 9, total: 10, strays: 0 }), 0.9);
  assert.equal(exerciseScore({ hits: 0, total: 0, strays: 0 }), 0, 'an empty chart is not a division by zero');
});

test('a quiz round scores right over attempts, and a hint makes it a stage 1 round', () => {
  assert.equal(quizScore(20, 0), 1);
  assert.equal(quizScore(20, 5), 0.8);
  assert.equal(quizScore(0, 0), 0);
  assert.equal(quizStage(0), 2);
  assert.equal(quizStage(3), 1);
});

/* ---- Stages --------------------------------------------------------------- */

test('a row shows the latest attempt while a stage is unpassed', () => {
  const p = emptyProgress();
  play(p, 'x', 1, 0.6);
  play(p, 'x', 1, 0.4);
  assert.equal(stageScore(item(p, 'x'), 1), 0.4, 'latest, not best — where you are now');
  assert.equal(stagePassed(item(p, 'x'), 1), false);
});

test('a passed stage never reads lower again', () => {
  const p = emptyProgress();
  const res = play(p, 'x', 1, 0.92);
  assert.equal(res.passed, 1, 'the attempt reports the stage it passed');
  play(p, 'x', 1, 0.5);
  assert.equal(stageScore(item(p, 'x'), 1), 0.92);
  play(p, 'x', 1, 0.97);
  assert.equal(stageScore(item(p, 'x'), 1), 0.97, 'and it still rises');
  assert.equal(play(p, 'x', 1, 0.99).passed, 0, 'a stage is passed once');
});

test('PASS is the mark, inclusive', () => {
  const p = emptyProgress();
  assert.equal(play(p, 'a', 1, PASS).passed, 1);
  assert.equal(play(p, 'b', 1, PASS - 0.001).passed, 0);
});

test('passing stage 2 counts as stage 1 too', () => {
  const p = emptyProgress();
  assert.equal(play(p, 'x', 2, 0.95).passed, 2);
  const it = item(p, 'x');
  assert.ok(stagePassed(it, 1));
  assert.equal(stageScore(it, 1), 0.95);
  assert.equal(itemMark(it), MARK_DONE);
  assert.ok(isFinished(it));
});

test('the row percentage is the two stages averaged, stage 1 at least stage 2', () => {
  const p = emptyProgress();
  assert.equal(itemPercent(null), 0);
  play(p, 'x', 1, 0.94);
  assert.equal(itemPercent(item(p, 'x')), 47, 'stage 1 alone is about half way');
  assert.equal(itemMark(item(p, 'x')), MARK_HALF);
  play(p, 'x', 2, 0.6);
  assert.equal(itemPercent(item(p, 'x')), 77);
  play(p, 'x', 2, 0.9);
  assert.equal(itemPercent(item(p, 'x')), 92);
});

test('an item opens on the first stage you have not passed', () => {
  const p = emptyProgress();
  assert.equal(recommendedStage(null), 1);
  play(p, 'x', 1, 0.5);
  assert.equal(recommendedStage(item(p, 'x')), 1);
  play(p, 'x', 1, 0.95);
  assert.equal(recommendedStage(item(p, 'x')), 2);
});

test('stagePlayed says whether there is anything to compare against', () => {
  const p = emptyProgress();
  assert.equal(stagePlayed(null, 1), false);
  play(p, 'x', 1, 0);
  assert.equal(stagePlayed(item(p, 'x'), 1), true, 'a zero is still an attempt');
  assert.equal(stagePlayed(item(p, 'x'), 2), false);
});

/* ---- Skipping and moving on ----------------------------------------------- */

test('a skip is a mark until you play the item', () => {
  const p = emptyProgress();
  skipItem(p, 'x', T0);
  assert.equal(itemMark(item(p, 'x')), MARK_SKIP);
  assert.equal(isFinished(item(p, 'x')), false, 'skipped is not finished');
  play(p, 'x', 1, 0.3);
  assert.equal(item(p, 'x').skip, 0);
});

test('moving on finishes an item at stage 1, and only once stage 1 is passed', () => {
  const p = emptyProgress();
  play(p, 'x', 1, 0.5);
  assert.equal(moveOn(p, 'x', T0), false);
  assert.equal(isFinished(item(p, 'x')), false);
  play(p, 'x', 1, 0.95);
  assert.equal(moveOn(p, 'x', T0), true);
  assert.ok(isFinished(item(p, 'x')));
  assert.equal(itemMark(item(p, 'x')), MARK_HALF, 'still only half: it was never read alone');
});

/* ---- Repetition ----------------------------------------------------------- */

test('a finished item comes up for repetition a day later, then less and less often', () => {
  const p = emptyProgress();
  play(p, 'x', 2, 0.95, T0);
  assert.equal(repetitionSession(p, T0 + DAY / 2).length, 0, 'not yet due');
  assert.deepEqual(repetitionSession(p, T0 + DAY).map((r) => r.id), ['x']);

  const res = play(p, 'x', 2, 0.96, T0 + DAY);
  assert.equal(res.repeat, true);
  const session = repetitionSession(p, T0 + DAY + 1000);
  assert.deepEqual(session, [{ id: 'x', done: true, at: Math.round((T0 + DAY) / 1000) }],
    'done for today');
  assert.equal(dueCount(session), 0);
  assert.equal(item(p, 'x').rep.due - item(p, 'x').rep.at, REP_INTERVALS[1] * 86400);
});

test('a repeat never lowers a finished score, but a slip is offered first', () => {
  const p = emptyProgress();
  play(p, 'old', 2, 0.95, T0);
  play(p, 'x', 2, 0.95, T0);
  play(p, 'x', 2, 0.4, T0 + 1000);
  assert.equal(itemPercent(item(p, 'x')), 95, 'the finished score stands');
  assert.equal(item(p, 'x').rep.step, 0, 'and the interval starts over');
  const ids = repetitionSession(p, T0 + 2 * DAY).map((r) => r.id);
  assert.deepEqual(ids, ['x', 'old'], 'the slip leads the session');
});

test('a session holds at most REP_SESSION items still to do', () => {
  const p = emptyProgress();
  for (let i = 0; i < REP_SESSION + 3; i++) play(p, 'i' + i, 2, 0.95, T0 + i * 1000);
  const session = repetitionSession(p, T0 + 10 * DAY);
  assert.equal(dueCount(session), REP_SESSION);
  assert.equal(session[0].id, 'i0', 'most overdue first');
});

test('moving on starts the repetitions too', () => {
  const p = emptyProgress();
  play(p, 'x', 1, 0.95, T0);
  moveOn(p, 'x', T0);
  assert.equal(repetitionSession(p, T0 + DAY).length, 1);
});

/* ---- Storage -------------------------------------------------------------- */

test('the store round-trips, and history is capped', () => {
  const p = emptyProgress();
  for (let i = 0; i < HISTORY_CAP + 6; i++) play(p, 'x', 1 + (i % 2), i / 40, T0 + i * 1000, 90);
  skipItem(p, 'y', T0);
  const back = parseProgress(serialiseProgress(p));
  assert.equal(item(back, 'x').h.length, HISTORY_CAP);
  assert.deepEqual(item(back, 'x'), item(p, 'x'));
  assert.equal(item(back, 'y').skip, item(p, 'y').skip);
  assert.equal(back.rev, 0, 'the revision is not saved');
});

test('a corrupt, empty or foreign file reads as a fresh start, never a throw', () => {
  for (const text of [null, '', '{', 'null', '[]', '{"items":3}', '{"items":{"a":null,"b":"x"}}']) {
    const p = parseProgress(text);
    assert.equal(typeof p.items, 'object', String(text));
  }
  const p = parseProgress(JSON.stringify({ items: { a: { stages: 'no', h: [[1, 50, 9], 'x', [2, 60, 2]] } } }));
  assert.deepEqual(item(p, 'a').h, [[2, 60, 2]], 'only well-formed attempts survive');
  assert.equal(stageScore(item(p, 'a'), 1), 0);
});

/* ---- Folders -------------------------------------------------------------- */

const tree = () => ({
  id: 'root',
  children: [
    { id: 'a', label: 'a', build: () => 1 },
    { id: 'b', label: 'b', build: () => 1 },
    { id: 'f', label: 'f', children: [{ id: 'c', label: 'c', guess: 'notes' }, { id: 'a', label: 'dup', step: {} }] },
    { id: 'r', label: 'rep', untracked: true, children: [{ id: 'z', label: 'z', build: () => 1 }] },
    { label: 'Progress', progress: true },
  ],
});

test('a folder sums its distinct playable leaves, and leaves out what is not one', () => {
  assert.ok(isTracked({ id: 'a', build() {} }));
  assert.equal(isTracked({ id: 'a' }), false, 'nothing to open');
  assert.equal(isTracked({ build() {} }), false, 'no id to file it under');
  const agg = createAggregator();
  assert.deepEqual(leafIds(agg, tree()), ['a', 'b', 'c'], 'a step pointing at a row counts once');

  const p = emptyProgress();
  play(p, 'a', 2, 0.9);
  play(p, 'c', 1, 0.9);
  const sum = folderSummary(agg, p, tree());
  assert.deepEqual(sum, { percent: 45, count: 3, done: 1, half: 1 });
});

test('folder sums are cached by id and refreshed when progress changes', () => {
  const agg = createAggregator();
  const p = emptyProgress();
  const first = folderSummary(agg, p, tree());
  assert.equal(folderSummary(agg, p, tree()), first, 'same revision, same answer');
  play(p, 'a', 2, 1);
  assert.notEqual(folderSummary(agg, p, tree()), first);
  resetShape(agg);
  assert.equal(agg.leaves.size, 0);
});

test('summariseIds over nothing is zero, not NaN', () => {
  assert.deepEqual(summariseIds(emptyProgress(), []), { percent: 0, count: 0, done: 0, half: 0 });
});

test('recent items are the played ones, newest first', () => {
  const p = emptyProgress();
  play(p, 'old', 1, 0.5, T0);
  play(p, 'new', 1, 0.5, T0 + 5000);
  skipItem(p, 'skipped', T0 + 9000);
  assert.deepEqual(recentIds(p), ['new', 'old']);
});

/* ---- Charts --------------------------------------------------------------- */

test('the accuracy series is on a fixed 0..100 scale, inside its box', () => {
  const h = [[1, 100, 1], [2, 0, 2], [3, 90, 2]];
  const { points, passY } = accuracySeries(h, 50, 21);
  assert.deepEqual(points.map((pt) => [pt.x, pt.y]), [[0, 0], [25, 20], [49, 2]]);
  assert.equal(passY, 2, 'the pass mark sits where 90% does');
  assert.deepEqual(points.map((pt) => pt.stage), [1, 2, 2]);
  const one = accuracySeries([[1, 50, 1]], 50, 21).points;
  assert.equal(one[0].x, 49, 'a single attempt sits at the newest end');
});

test('the accuracy series keeps only the newest attempts', () => {
  const h = [];
  for (let i = 0; i < 30; i++) h.push([i, i, 1]);
  const { points } = accuracySeries(h, 100, 10, 10);
  assert.equal(points.length, 10);
  assert.equal(points[0].percent, 20);
});

test('the pass timeline rises by one per stage passed, along time', () => {
  const p = emptyProgress();
  assert.deepEqual(passTimeline(p, ['a'], 100, 11, T0), { points: [], total: 0 });
  play(p, 'a', 1, 0.95, T0);
  play(p, 'b', 2, 0.95, T0 + DAY);
  const tl = passTimeline(p, ['a', 'b', 'nope'], 100, 11, T0 + 2 * DAY);
  assert.equal(tl.total, 3, 'b passed both stages at once');
  assert.equal(tl.points[0].x, 0);
  assert.equal(tl.points[tl.points.length - 1].y, 0, 'the last pass reaches the top');
  assert.ok(tl.points.every((pt) => pt.x >= 0 && pt.x < 100 && pt.y >= 0 && pt.y < 11));
});

test('which Info pages have been seen is remembered, and survives a round trip', async () => {
  const { infoSeen, markInfoSeen } = await import('../src/progress.mjs');
  const p = emptyProgress();
  assert.equal(infoSeen(p, 'scales'), false);
  markInfoSeen(p, 'scales', T0);
  assert.equal(infoSeen(p, 'scales'), true);
  const back = parseProgress(serialiseProgress(p));
  assert.equal(infoSeen(back, 'scales'), true);
  assert.equal(infoSeen(parseProgress('{"seen":{"a":"x","b":5}}'), 'a'), false, 'junk is dropped');
  assert.equal(infoSeen(parseProgress('{"seen":{"a":"x","b":5}}'), 'b'), true);
  const bare = { items: {} };
  markInfoSeen(bare, 'k');
  assert.ok(infoSeen(bare, 'k'));
});
