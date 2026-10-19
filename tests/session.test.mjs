// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * session.test.mjs — the module's behaviour, driven through its own API with
 * no Move attached. What ui_contract pins by reading source, these show by
 * running it: a host only ever sees fx calls, and the session's answers to
 * what a press means.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeHost, openPath, QUIET } from './support/fake_host.mjs';
import {
  MENU, READY, RUNNING, SETTINGS, GUESS_VIEW, RESULT_VIEW, PROGRESS_VIEW, PROGRESS_DETAIL, INFO_VIEW,
  OUT_INTERNAL,
} from '../src/session.mjs';
import * as GUESS from '../src/guess.mjs';

function armScale(h) {
  h.session.init();
  openPath(h.session, ['Basics', 'Scales', 'Major', 'Up & down']);
  assert.equal(h.session.view, READY);
}

test('init opens the lesson list, from the files and the settings it is given', () => {
  const h = fakeHost();
  h.session.init();
  assert.equal(h.session.view, MENU);
  const rows = h.session.nav[0].node.children.map((r) => r.label);
  assert.deepEqual(rows.slice(0, 3), ['Learning Program', 'Basics', 'Quiz']);
  assert.ok(rows.includes('Classics'), 'the bundled songs are read through fx');
  assert.equal(h.session.settings.roundSize, 10, 'settings.json is read through fx');
  assert.equal(h.session.settings.midiOut, OUT_INTERNAL);
  assert.ok(h.log.some((e) => e[0] === 'changed' && e[1] === 'midiCh'), 'the host learns the channel');
});

test('a bad or missing settings file starts from the defaults', () => {
  const h = fakeHost({ settings: null });
  h.files.set('settings.json', '{not json');
  h.session.init();
  assert.equal(h.session.settings.bpm, 80);
  assert.equal(h.session.settings.autoInfo, true);
});

test('an old settings file is migrated, and written back once', () => {
  const h = fakeHost({ settings: { version: 5, mode: 'pentatonic', bpm: 90 } });
  h.session.init();
  assert.equal(h.session.settings.mode, 'majorPent');
  assert.equal(h.session.settings.bpm, 90);
  h.session.flushSettings(true);
  assert.deepEqual(h.log.filter((e) => e[0] === 'write').map((e) => e[1]), ['settings.json']);
});

test('selectRow points at a row; activate opens it; back steps out', () => {
  const h = fakeHost();
  h.session.init();
  h.session.selectRow(1);
  h.session.activate(false);
  assert.equal(h.session.nav.length, 2);
  assert.equal(h.session.nav[1].node.label, 'Basics');
  h.session.selectRow(99);                       /* out of range: ignored */
  assert.equal(h.session.nav[1].cursor, 0);
  h.session.back();
  assert.equal(h.session.nav.length, 1);
  h.session.back();                              /* the top of the list leaves */
  assert.deepEqual(h.log.at(-1), ['exit']);
});

test('arming a drill readies it on stage 1, and the jog picks the stage', () => {
  const h = fakeHost();
  armScale(h);
  assert.equal(h.session.stage, 1);
  assert.equal(h.session.chart.name, 'C Major');
  h.session.moveSelection(1);
  assert.equal(h.session.stage, 2);
  h.session.moveSelection(-1);
  assert.equal(h.session.stage, 1);
});

test('practice runs the clock through the count-in and scores a played note', () => {
  const h = fakeHost();
  armScale(h);
  h.session.recordButton();
  assert.equal(h.session.view, RUNNING);
  assert.ok(h.session.songBeats < 0, 'a count-in first');
  const first = h.session.chart.events[0];
  /* Run to the first note, then play it. */
  const beatMs = 60000 / h.session.chart.bpm;
  h.run((h.session.settings.countIn + first.beat) * beatMs);
  const out = h.session.play(first.pitches[0], 100);
  assert.equal(out.kind, 'judged');
  assert.ok(['perfect', 'hit', 'late'].includes(out.result), out.result);
  assert.ok(h.log.some((e) => e[0] === 'strike' && e[1] === first.pitches[0]), 'and it sounded');
  h.session.release(first.pitches[0]);
});

test('a wrong note is a stray, and still sounds', () => {
  const h = fakeHost();
  armScale(h);
  h.session.recordButton();
  h.run(4000);
  const out = h.session.play(61, 90);      /* C#: not in C major */
  assert.equal(out.result, 'stray');
  assert.ok(h.log.some((e) => e[0] === 'strike' && e[1] === 61));
});

test('Wait halts the scroll on an unplayed note, and playing it releases', () => {
  const h = fakeHost();
  armScale(h);
  h.session.recordButton();
  h.run(10000);
  assert.ok(h.session.blocked, 'stuck on the first note');
  const before = h.session.songBeats;
  h.run(1000);
  assert.equal(h.session.songBeats, before, 'the scroll does not move while stuck');
  h.session.collectStuck();
  assert.ok(h.session.stuckBuf.length > 0, 'the stuck note is lit at stage 1');
  h.session.play(h.session.stuckBuf[0], 100);
  h.run(200);
  assert.ok(!h.session.blocked, 'the note releases the halt');
});

test('Play listens and lights what sounds; pressing it again pauses in place', () => {
  const h = fakeHost();
  armScale(h);
  h.session.playButton();
  assert.ok(h.session.listening);
  h.run(6000);
  h.session.collectSounding();
  const at = h.session.songBeats;
  h.session.playButton();
  assert.ok(h.session.paused);
  h.run(1000);
  assert.equal(h.session.songBeats, at, 'paused holds the playhead');
  assert.ok(h.log.some((e) => e[0] === 'silence'), 'pausing silences');
  assert.ok(h.session.scrubAllowed());
  h.session.scrubBy(36);                        /* a bar */
  assert.ok(Math.abs(h.session.songBeats - (Math.round(at * 9) / 9 + 4)) < 0.5);
});

test('a drill played through records an attempt and shows its result', () => {
  const h = fakeHost();
  armScale(h);
  h.session.recordButton();
  const beatMs = 60000 / h.session.chart.bpm;
  /* Play every note on time. */
  const start = h.ms;
  const countIn = h.session.settings.countIn;
  for (const e of h.session.chart.events) {
    const target = start + (countIn + e.beat) * beatMs;
    if (target > h.ms) h.run(target - h.ms);
    for (const p of e.pitches) h.session.play(p, 100);
    for (const p of e.pitches) h.session.release(p);
  }
  h.run(8 * beatMs);
  assert.equal(h.session.view, RESULT_VIEW);
  const res = h.session.lastResult;
  assert.equal(res.kind, 'exercise');
  assert.ok(res.percent >= 90, `scored ${res.percent}`);
  assert.equal(res.passed, 1, 'stage 1 passed');
  assert.ok(h.log.some((e) => e[0] === 'write' && e[1] === 'progress.json'));
  /* Next goes on to stage 2 of the same drill. */
  h.session.activate(false);
  assert.equal(h.session.view, READY);
  assert.equal(h.session.stage, 2);
});

test('Back from a running drill restarts it; again leaves for the list', () => {
  const h = fakeHost();
  armScale(h);
  h.session.recordButton();
  h.run(3000);
  h.session.back();
  assert.equal(h.session.view, READY);
  assert.ok(h.session.songBeats < 0, 'back at the count-in');
  h.session.back();
  assert.equal(h.session.view, MENU);
});

test('settings open from the list, edit, and save lazily', () => {
  const h = fakeHost();
  h.session.init();
  h.session.activate(true);                     /* shift + click */
  assert.equal(h.session.view, SETTINGS);
  h.session.selectSetting(0);
  h.session.editSetting(0, 5);
  assert.equal(h.session.settings.bpm, 85);
  const writes = () => h.log.filter((e) => e[0] === 'write' && e[1] === 'settings.json').length;
  h.session.flushSettings(false);
  assert.equal(writes(), 1, 'the first change is saved');
  h.session.editSetting(0, 1);
  h.session.flushSettings(false);
  assert.equal(writes(), 1, 'the next is held for the rest of the second');
  h.run(1200);
  h.session.flushSettings(false);
  assert.equal(writes(), 2);
  h.session.back();
  assert.equal(h.session.view, MENU);
});

test('changing the MIDI channel silences the old one before the host moves', () => {
  const h = fakeHost();
  armScale(h);
  h.session.playButton();
  h.run(5000);
  const ch = h.session.settingsRows().findIndex((r) => r.label === 'MIDI ch');
  h.session.editSetting(ch, 1);
  const silenceAt = h.log.findLastIndex((e) => e[0] === 'silence');
  const changedAt = h.log.findLastIndex((e) => e[0] === 'changed' && e[1] === 'midiCh');
  assert.ok(silenceAt >= 0 && silenceAt < changedAt);
});

test('a Play quiz: the right note is correct, a wrong one counted once', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Quiz', 'Play', 'Notes by staff']);
  assert.equal(h.session.view, GUESS_VIEW);
  const prompt = h.session.quiz.prompt.slice();
  const wrong = h.session.play(prompt[0] + 1, 90);
  assert.equal(wrong.res, GUESS.WRONG);
  h.session.release(prompt[0] + 1);
  const right = h.session.play(prompt[0], 90);
  assert.equal(right.res, GUESS.CORRECT);
  assert.equal(h.session.quiz.wrong, 1);
});

test('Play is four drills: notes and chords, each by name and by staff', () => {
  const h = fakeHost();
  h.session.init();
  for (const [label, kind, read] of [
    ['Notes by alphabet', GUESS.NOTES, GUESS.READ_NAME],
    ['Notes by staff', GUESS.NOTES, GUESS.READ_STAFF],
    ['Chords by name', GUESS.CHORDS, GUESS.READ_NAME],
    ['Chords by staff', GUESS.CHORDS, GUESS.READ_STAFF],
  ]) {
    openPath(h.session, ['Quiz', 'Play', label]);
    assert.equal(h.session.view, GUESS_VIEW, label);
    assert.equal(h.session.quiz.kind, kind, label);
    assert.equal(h.session.quiz.read, read, label);
    assert.equal(h.session.quiz.queue.length, GUESS.LOOKAHEAD, label + ': the next ones are queued');
    h.session.back();
    h.session.back();
    h.session.back();
  }
});

test('the name drills keep the ids Notes and Chords had; the staff drills are filed apart', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Quiz', 'Play']);
  const ids = h.session.nav.at(-1).node.children.map((r) => r.id);
  assert.deepEqual(ids, [
    'quiz:guess:notes:half', 'quiz:staff:notes:half', 'quiz:guess:chords:triads', 'quiz:staff:chords:triads',
  ]);
});

test('Notes by alphabet takes the note in any octave', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Quiz', 'Play', 'Notes by alphabet']);
  const [p] = h.session.quiz.prompt;
  const res = h.session.play(p >= 72 ? p - 12 : p + 12, 90);
  assert.equal(res.res, GUESS.CORRECT);
});

test('Notes by staff wants the written octave', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Quiz', 'Play', 'Notes by staff']);
  const [p] = h.session.quiz.prompt;
  const res = h.session.play(p >= 72 ? p - 12 : p + 12, 90);
  assert.equal(res.res, GUESS.WRONG);
});

test('Chords by name takes an inversion; Chords by staff does not', () => {
  for (const [label, want] of [['Chords by name', GUESS.CORRECT], ['Chords by staff', GUESS.WRONG]]) {
    const h = fakeHost();
    h.session.init();
    openPath(h.session, ['Quiz', 'Play', label]);
    const chord = h.session.quiz.prompt.slice().sort((a, b) => a - b);
    const inverted = [...chord.slice(1), chord[0] + 12];
    let res = null;
    for (const p of inverted) res = h.session.play(p, 90);
    assert.equal(res.res, want, label);
  }
});

test('a right answer glides the row on, then the next prompt is the one that was queued', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Quiz', 'Play', 'Notes by staff']);
  const q = h.session.quiz;
  const next = q.queue[1];
  assert.equal(h.session.quizGlide(), 0, 'at rest');
  h.session.play(q.prompt[0], 90);
  h.session.release(q.prompt[0]);
  h.session.dirty = false;
  h.run(200);
  const mid = h.session.quizGlide();
  assert.ok(mid > 0 && mid < 1, 'part way: ' + mid);
  assert.ok(h.session.dirty, 'each step of the glide is a new frame');
  h.run(400);
  assert.equal(h.session.quizGlide(), 0, 'at rest again');
  assert.equal(q.entry, next);
  assert.equal(q.queue.length, GUESS.LOOKAHEAD);
});

test('a staff drill never says the answer out loud; a name drill does', () => {
  const said = (label) => {
    const h = fakeHost();
    h.session.init();
    openPath(h.session, ['Quiz', 'Play', label]);
    const name = GUESS.entryName(h.session.quiz, h.session.quiz.entry);
    const lines = h.log.filter((e) => e[0] === 'say').map((e) => e[1]);
    return lines.some((t) => t.includes('Play ' + name));
  };
  assert.equal(said('Notes by staff'), false);
  assert.equal(said('Notes by alphabet'), true);
});

test('a Name quiz answers by option, and a round runs to its result', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Quiz', 'Name', 'Notes']);
  assert.ok(h.session.quizPick);
  for (let i = 0; i < 60 && h.session.view === GUESS_VIEW; i++) {
    const q = h.session.quiz;
    const right = q.choices.findIndex((c) => c.pitches.join() === q.prompt.join());
    h.session.answer(i % 4 === 0 ? (right + 1) % q.choices.length : right);
    h.run(500);
  }
  assert.equal(h.session.view, RESULT_VIEW);
  assert.equal(h.session.lastResult.kind, 'quiz');
  assert.equal(h.session.lastResult.n, 10);
  assert.ok(h.log.some((e) => e[0] === 'write' && e[1] === 'stats.json'));
});

test('a Hear drill plays its prompt and reveals the answer once named', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Quiz', 'Hear', '1 Higher or lower', 'Hear High/low wide']);
  h.run(1500);
  assert.ok(h.log.some((e) => e[0] === 'strike'), 'the prompt is played');
  const q = h.session.quiz;
  for (let i = 0; i < q.choices.length && !q.solved; i++) h.session.answer(i);
  assert.ok(q.solved);
  assert.ok(h.log.some((e) => e[0] === 'reveal'), 'the host is told where it sits');
});

test('Menu opens Info for what is in front of you, and closes back to it', () => {
  const h = fakeHost();
  h.session.init();
  h.session.selectRow(1);
  h.session.menuButton();
  assert.equal(h.session.view, INFO_VIEW);
  assert.ok(h.session.info.paragraphs.length > 0);
  assert.equal(h.session.info.back, MENU);
  h.session.menuButton();
  assert.equal(h.session.view, MENU);
});

test('Progress lists the overview and tracks; a row opens its chart data', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Progress']);
  assert.equal(h.session.view, PROGRESS_VIEW);
  assert.equal(h.session.progressRows[0].label, 'Overall');
  h.session.selectProgress(1);
  h.session.activate(false);
  assert.equal(h.session.view, PROGRESS_DETAIL);
  const d = h.session.progressDetail(100, 40);
  assert.equal(d.kind, 'overview');
  assert.equal(d.index, 1);
});

test('first-time Info opens by itself when Auto info is on, once', () => {
  const h = fakeHost({ settings: { ...QUIET, autoInfo: true } });
  h.session.init();
  openPath(h.session, ['Basics', 'Scales', 'Major', 'Up & down']);
  assert.equal(h.session.view, INFO_VIEW);
  h.session.back();
  assert.equal(h.session.view, READY);
  h.session.back();
  openPath(h.session, ['Down']);
  assert.equal(h.session.view, READY, 'scale drills were explained already');
});
