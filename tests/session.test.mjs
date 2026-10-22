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
  SHEET_VIEW, CARD_VIEW, OUT_INTERNAL,
} from '../src/session.mjs';
import * as GUESS from '../src/guess.mjs';
import * as PROG from '../src/progress.mjs';

function armScale(h) {
  h.session.init();
  openPath(h.session, ['Practice', 'Scales', 'Major', 'Up & down']);
  assert.equal(h.session.view, READY);
}

test('init opens the lesson list, from the files and the settings it is given', () => {
  const h = fakeHost();
  h.session.init();
  assert.equal(h.session.view, MENU);
  const rows = h.session.nav[0].node.children.map((r) => r.label);
  assert.deepEqual(rows, ['Continue', 'Path', 'Practice', 'Quiz', 'Progress', 'Settings']);
  const songs = h.session.nav[0].node.children[2].children.find((r) => r.label === 'Songs');
  assert.ok(songs.children.some((r) => r.label === 'Classics'), 'the bundled songs are read through fx');
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
  assert.deepEqual(h.log.filter((e) => e[0] === 'write' && /^settings/.test(e[1])).map((e) => e[1]), ['settings.json']);
});

test('selectRow points at a row; activate opens it; back steps out', () => {
  const h = fakeHost();
  h.session.init();
  h.session.selectRow(2);
  h.session.activate(false);
  assert.equal(h.session.nav.length, 2);
  assert.equal(h.session.nav[1].node.label, 'Practice');
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
  openPath(h.session, ['Settings', 'Practice']);
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
  assert.equal(h.session.nav.at(-1).node.label, 'Settings', 'back in the folder of groups');
});

test('Settings is a folder of groups, each the page limited to its rows', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Settings']);
  assert.deepEqual(h.session.nav.at(-1).node.children.map((r) => r.label),
    ['Path', 'Practice', 'Sound', 'Pads', 'MIDI', 'Help']);
  openPath(h.session, ['MIDI']);
  assert.deepEqual(h.session.settingsRows().map((r) => r.label), ['MIDI out', 'MIDI ch']);
  /* The jog edits the open group's row, by its place on the page. */
  h.session.moveSelection(1);
  h.session.activate(false);
  h.session.moveSelection(1);
  assert.equal(h.session.settings.midiCh, 1);
  h.session.activate(false);
  assert.equal(h.session.settingsEditing, false);
  h.session.back();
  /* Path: where Continue starts, kept with the progress. */
  openPath(h.session, ['Path']);
  assert.deepEqual(h.session.settingsRows()[0], { label: 'Start at', value: 'stage 1', edit: 'start' });
  h.session.activate(false);
  h.session.moveSelection(1);
  assert.equal(PROG.programStart(h.session.progress), 1);
  assert.equal(h.session.settingsRows()[0].value, 'stage 2');
  h.session.moveSelection(-1);
  h.session.moveSelection(-1);
  assert.equal(PROG.programStart(h.session.progress), 0, 'clamped at the first stage');
  h.session.back();                              /* out of editing */
  h.session.back();                              /* out of the page */
  h.session.back();                              /* out of the folder */
  /* Shift + click on a piece opens every setting, and back returns to it. */
  openPath(h.session, ['Practice', 'Scales', 'Major', 'Up & down']);
  h.session.activate(true);
  assert.equal(h.session.view, SETTINGS);
  assert.equal(h.session.settingsRows().length, h.session.settingsRows().filter((r) => r.index >= 0).length);
  assert.ok(h.session.settingsRows().length >= 20);
  h.session.activate(true);
  assert.equal(h.session.view, READY);
});

test('Settings > Help: show tips again, and the welcome again', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Settings', 'Help']);
  const rows = h.session.settingsRows().map((r) => r.label);
  assert.deepEqual(rows, ['Auto info', 'Show tips again', 'Welcome again']);
  h.session.selectSettingRow(1);
  h.session.activate(false);
  assert.deepEqual(h.session.progress.tips, []);
  assert.ok(JSON.parse(h.files.get('progress.json')).tips.length === 0, 'saved');
  h.session.selectSettingRow(2);
  h.session.activate(false);
  assert.equal(h.session.view, 'card');
  assert.equal(h.session.card.kind, 'welcome');
  h.session.back();
  assert.equal(h.session.view, MENU, 'dismissed: the top of the list');
  assert.ok(PROG.tipSeen(h.session.progress, 'welcome'));
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
  openPath(h.session, ['Quiz', 'Reading', 'Notes by staff']);
  assert.equal(h.session.view, GUESS_VIEW);
  const prompt = h.session.quiz.prompt.slice();
  const wrong = h.session.play(prompt[0] + 1, 90);
  assert.equal(wrong.res, GUESS.WRONG);
  h.session.release(prompt[0] + 1);
  const right = h.session.play(prompt[0], 90);
  assert.equal(right.res, GUESS.CORRECT);
  assert.equal(h.session.quiz.wrong, 1);
});

test('Keys and Reading hold the four drills: notes and chords, each by name and by staff', () => {
  const h = fakeHost();
  h.session.init();
  for (const [folder, label, kind, read] of [
    ['Keys', 'Notes by alphabet', GUESS.NOTES, GUESS.READ_NAME],
    ['Reading', 'Notes by staff', GUESS.NOTES, GUESS.READ_STAFF],
    ['Keys', 'Chords by name', GUESS.CHORDS, GUESS.READ_NAME],
    ['Reading', 'Chords by staff', GUESS.CHORDS, GUESS.READ_STAFF],
  ]) {
    openPath(h.session, ['Quiz', folder, label]);
    assert.equal(h.session.view, GUESS_VIEW, label);
    assert.equal(h.session.quiz.kind, kind, label);
    assert.equal(h.session.quiz.read, read, label);
    assert.equal(h.session.quiz.queue.length, GUESS.LOOKAHEAD, label + ': the next ones are queued');
    h.session.back();
    h.session.back();
    h.session.back();
  }
});

test('the quiz is by skill, and its drills keep their ids', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Quiz']);
  assert.deepEqual(h.session.nav.at(-1).node.children.map((r) => r.label), ['Ear', 'Reading', 'Keys']);
  openPath(h.session, ['Keys']);
  assert.deepEqual(h.session.nav.at(-1).node.children.map((r) => [r.label, r.id]), [
    ['Notes by alphabet', 'quiz:guess:notes:half'], ['Chords by name', 'quiz:guess:chords:triads'],
    ['Name notes', 'quiz:pick:notes:half'], ['Name chords', 'quiz:pick:chords:triads'],
  ]);
  h.session.back();
  openPath(h.session, ['Reading']);
  const reading = h.session.nav.at(-1).node.children;
  assert.deepEqual(reading.slice(-2).map((r) => r.id), ['quiz:staff:notes:half', 'quiz:staff:chords:triads']);
  assert.equal(reading[0].id, 'quiz/read/' + reading[0].key, 'the courses keep the Read ids');
});

test('Notes by alphabet takes the note in any octave', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Quiz', 'Keys', 'Notes by alphabet']);
  const [p] = h.session.quiz.prompt;
  const res = h.session.play(p >= 72 ? p - 12 : p + 12, 90);
  assert.equal(res.res, GUESS.CORRECT);
});

test('Notes by staff wants the written octave', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Quiz', 'Reading', 'Notes by staff']);
  const [p] = h.session.quiz.prompt;
  const res = h.session.play(p >= 72 ? p - 12 : p + 12, 90);
  assert.equal(res.res, GUESS.WRONG);
});

test('Chords by name takes an inversion; Chords by staff does not', () => {
  for (const [folder, label, want] of [['Keys', 'Chords by name', GUESS.CORRECT], ['Reading', 'Chords by staff', GUESS.WRONG]]) {
    const h = fakeHost();
    h.session.init();
    openPath(h.session, ['Quiz', folder, label]);
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
  openPath(h.session, ['Quiz', 'Reading', 'Notes by staff']);
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
    openPath(h.session, ['Quiz', label === 'Notes by staff' ? 'Reading' : 'Keys', label]);
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
  openPath(h.session, ['Quiz', 'Keys', 'Name notes']);
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
  openPath(h.session, ['Quiz', 'Ear', 'Pitch & melody', 'Higher or lower', 'wide']);
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
  openPath(h.session, ['Practice', 'Scales', 'Major', 'Up & down']);
  assert.equal(h.session.view, INFO_VIEW);
  h.session.back();
  assert.equal(h.session.view, READY);
  h.session.back();
  openPath(h.session, ['Down']);
  assert.equal(h.session.view, READY, 'scale drills were explained already');
});

/* ---- Help that fades with the stage ------------------------------------------- */

test('names are printed at stage 1 and not at stage 2, unless chosen otherwise', () => {
  const h = fakeHost();
  armScale(h);
  assert.equal(h.session.namesShown(), true, 'stage 1');
  h.session.moveSelection(1);
  assert.equal(h.session.namesShown(), false, 'stage 2 reads the staff');
  h.session.settings.names = 'always';
  assert.equal(h.session.namesShown(), true);
  h.session.settings.names = 'off';
  h.session.moveSelection(-1);
  assert.equal(h.session.namesShown(), false);
});

test('the reference line sounds at stage 1 and is quiet at stage 2', () => {
  const struck = (stage) => {
    const h = fakeHost();
    armScale(h);
    if (stage === 2) h.session.moveSelection(1);
    h.session.recordButton();
    h.run(6000);
    return h.log.filter((e) => e[0] === 'strike' && e[2] === 70).length;
  };
  assert.ok(struck(1) > 0, 'the line you are reading, heard');
  assert.equal(struck(2), 0, 'reading alone');
});

test('at stage 2 a stuck note is named only once it has waited two beats', () => {
  const h = fakeHost();
  armScale(h);
  h.session.moveSelection(1);
  h.session.recordButton();
  for (let i = 0; i < 200 && !h.session.blocked; i++) h.run(50);
  assert.ok(h.session.blocked);
  assert.equal(h.session.stuckNamed(), false, 'a hesitation is not a cue');
  h.run(2000);                                  /* two beats and more at 80 bpm */
  assert.equal(h.session.stuckNamed(), true, 'stuck: now it is named');
});

test('settings saved before v8 move on: reference on is stage 1, off stays off, a beat of grace a quarter', () => {
  const load = (stored) => {
    const h = fakeHost({ settings: { ...QUIET, ...stored } });
    h.session.init();
    return h.session.settings;
  };
  assert.equal(load({ version: 7, reference: true }).reference, 'stage1');
  assert.equal(load({ version: 7, reference: false }).reference, 'off');
  assert.equal(load({ version: 7, graceBeats: 1 }).graceBeats, 1 / 4);
  assert.equal(load({ version: 7, graceBeats: 2 }).graceBeats, 2, 'chosen on purpose, kept');
  assert.equal(load({ version: 8, graceBeats: 1 }).graceBeats, 1, 'a choice made since, kept');
});

/* ---- Records survive a damaged file --------------------------------------- */

const GOOD_PROGRESS = JSON.stringify({ version: 1, items: { 'basics/scales/major/up-down': { stages: [{ best: 1, passedAt: 5 }, {}], plays: 1, t: 5 } } });

test('a progress file that parses is kept as the last good copy', () => {
  const h = fakeHost();
  h.files.set('progress.json', GOOD_PROGRESS);
  h.session.init();
  assert.equal(h.files.get('progress.bak.json'), GOOD_PROGRESS);
  assert.ok(h.session.progress.items['basics/scales/major/up-down']);
});

test('a truncated progress file is set aside and the last good copy is read instead', () => {
  const h = fakeHost();
  const broken = GOOD_PROGRESS.slice(0, 40);
  h.files.set('progress.json', broken);
  h.files.set('progress.bak.json', GOOD_PROGRESS);
  h.session.init();
  assert.equal(h.files.get('progress.corrupt.json'), broken, 'the damaged file is kept for recovery');
  assert.ok(h.session.progress.items['basics/scales/major/up-down'], 'the record comes back from the copy');
  assert.equal(h.files.get('progress.bak.json'), GOOD_PROGRESS, 'the good copy is not overwritten by the damage');
});

test('a damaged stats file with no copy starts empty but is not lost', () => {
  const h = fakeHost();
  h.files.set('stats.json', '{"records": [');
  h.session.init();
  assert.equal(h.files.get('stats.corrupt.json'), '{"records": [');
  assert.equal(h.files.has('stats.bak.json'), false);
});

/* ---- The learning path ------------------------------------------------------ */


const DAY = 86400000;
const WALL0 = Date.UTC(2026, 9, 9);

/* Every note of the armed chart, on time, through to its result. */
function playThrough(h) {
  h.session.recordButton();
  const beatMs = 60000 / h.session.chart.bpm;
  const start = h.ms;
  const countIn = h.session.settings.countIn;
  for (const e of h.session.chart.events) {
    const target = start + (countIn + e.beat) * beatMs;
    if (target > h.ms) h.run(target - h.ms);
    for (const p of e.pitches) h.session.play(p, 100);
    for (const p of e.pitches) h.session.release(p);
  }
  h.run(8 * beatMs);
}

/* Shift + jog-click on the row at `index` of the open folder, then the
 * option labelled `label`. */
function sheet(h, index, label) {
  h.session.selectRow(index);
  h.session.activate(true);
  assert.equal(h.session.view, SHEET_VIEW);
  const at = h.session.sheet.items.findIndex((it) => it.label === label);
  assert.ok(at >= 0, `no "${label}" in ${h.session.sheet.items.map((it) => it.label)}`);
  h.session.pickSheet(at);
}

const rowIndex = (h, label) => h.session.nav.at(-1).node.children.findIndex((r) => r.label === label);

test('Test out: checkpoint plays the checkpoint at stage 2, and passing it moves the start on', () => {
  const h = fakeHost();
  h.session.init();
  const p = h.session.progress;
  for (const id of ['basics/random/in-key', 'song:ode-to-joy/1r', 'quiz:staff:notes:key']) {
    PROG.recordAttempt(p, id, { stage: 2, score: 1, at: WALL0 });
  }
  openPath(h.session, ['Path']);
  sheet(h, 0, 'Test out: checkpoint');
  assert.equal(h.session.view, READY);
  assert.equal(h.session.armedId, 'basics/scales/major/up-down', 'the one check step not yet passed');
  assert.equal(h.session.stage, 2, 'a checkpoint is played without the pads');
  playThrough(h);
  assert.equal(h.session.view, RESULT_VIEW);
  assert.ok(h.said().some((t) => /Checkpoint 1 passed/.test(t)), h.said().slice(-2).join(' / '));
  assert.equal(PROG.programStart(h.session.progress), 1);
});

test('the Checkpoint is the last row of a stage, and its rows are the exam at S2', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Path', '1 Grid and staff']);
  const rows = h.session.nav.at(-1).node.children;
  assert.equal(rows.at(-1).label, 'Checkpoint');
  assert.ok(!rows.some((r) => /Check: skip|Start here|Skip/.test(r.label)), 'no control rows among the lessons');
  assert.equal(h.session.decorateRow(rows.at(-1)).value, '0/4 >');
  openPath(h.session, ['Checkpoint']);
  assert.deepEqual(h.session.nav.at(-1).node.children.map((r) => r.label),
    ['Major up & down', 'Random in key', 'Ode to Joy melody', 'Notes by staff']);
  openPath(h.session, ['Major up & down']);
  assert.equal(h.session.stage, 2);
  /* The last stage has no checkpoint, and no Test out. */
  h.session.back();
  h.session.back();
  h.session.back();
  sheet(h, 4, 'Start the path here');
  openPath(h.session, ['5 Colour']);
  assert.notEqual(h.session.nav.at(-1).node.children.at(-1).label, 'Checkpoint');
});

test('the same steps passed in practice move the stage on without skipping its rest', () => {
  const h = fakeHost();
  h.session.init();
  const p = h.session.progress;
  for (const id of ['basics/random/in-key', 'song:ode-to-joy/1r', 'quiz:staff:notes:key']) {
    PROG.recordAttempt(p, id, { stage: 2, score: 1, at: WALL0 });
  }
  PROG.recordAttempt(p, 'basics/scales/major/up-down', { stage: 1, score: 1, at: WALL0 });
  openPath(h.session, ['Path', '1 Grid and staff', '1.3 Major scale', 'Major up & down']);
  assert.equal(h.session.stage, 2);
  playThrough(h);
  assert.ok(PROG.stagePassed(PROG.item(p, 'basics/scales/major/up-down'), 2));
  assert.equal(PROG.programStart(p), 0, 'not a checkpoint: nothing is assumed');
  assert.ok(!h.said().some((t) => /Checkpoint/.test(t)));
});

test('Start the path here moves where Continue begins', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Path']);
  sheet(h, 2, 'Start the path here');
  assert.equal(h.session.view, MENU, 'the sheet closes');
  assert.equal(PROG.programStart(h.session.progress), 2);
  assert.ok(h.said().some((t) => /The path starts at stage 3/.test(t)));
  h.session.back();
  h.session.selectRow(0);
  h.session.activate(false);                     /* Continue */
  assert.ok(h.session.armedId || h.session.quiz, 'Continue opened a step');
  const id = h.session.armedId || h.session.quiz && ('quiz:' + h.session.quiz.kind);
  const unit = h.session.phases.flatMap((ph) => ph.units).find((u) =>
    u.exercises.some((e) => e.steps.some((s) => s.id === (h.session.armedId || ''))));
  if (unit) assert.equal(unit.phase.n, 3, id);
});

test('the sheet offers only what applies, in its order, Settings... last', () => {
  const h = fakeHost();
  h.session.init();
  const labels = () => h.session.sheet.items.map((it) => it.label);
  h.session.selectRow(0);
  h.session.activate(true);
  assert.deepEqual(labels(), ['I know this: skip', 'Settings...'], 'Continue');
  h.session.back();
  assert.equal(h.session.view, MENU, 'BACK closes it');
  h.session.selectRow(2);
  h.session.activate(true);
  assert.deepEqual(labels(), ['Settings...'], 'Practice: nothing but Settings');
  h.session.back();
  openPath(h.session, ['Path']);
  h.session.selectRow(0);
  h.session.activate(true);
  assert.deepEqual(labels(), ['I know it all: skip', 'Start the path here', 'Test out: checkpoint', 'Settings...']);
  h.session.back();
  openPath(h.session, ['1 Grid and staff', '1.3 Major scale']);
  h.session.selectRow(0);
  h.session.activate(true);
  assert.deepEqual(labels(), ['I know this: skip', 'Settings...'], 'a step');
  h.session.pickSheet(0);
  assert.ok(PROG.item(h.session.progress, 'basics/scales/major/up-down').skip, 'skipped');
  h.session.activate(true);
  assert.deepEqual(labels(), ['Undo skip', 'Settings...'], 'a skipped step');
  h.session.pickSheet(0);
  assert.ok(!PROG.isSkipped(PROG.item(h.session.progress, 'basics/scales/major/up-down')), 'unskipped');
  /* Settings... goes to the Settings folder. */
  h.session.activate(true);
  h.session.pickSheet(h.session.sheet.items.length - 1);
  assert.equal(h.session.nav.at(-1).node.label, 'Settings');
});

test('I know it all skips a whole unit, and Undo skip takes it back', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Path', '1 Grid and staff']);
  const unit = h.session.nav.at(-1).node.children[0].unit;
  sheet(h, 0, 'I know it all: skip');
  const steps = unit.exercises.flatMap((e) => e.steps);
  assert.ok(steps.every((st) => PROG.item(h.session.progress, st.id).skip), 'every step skipped');
  assert.ok(h.said().some((t) => t === 'Skipped ' + steps.length + ' steps.'));
  sheet(h, 0, 'Undo skip');
  assert.ok(steps.every((st) => !PROG.isSkipped(PROG.item(h.session.progress, st.id))));
  assert.ok(JSON.parse(h.files.get('progress.json')).items[steps[0].id].skip === 0, 'saved');
});

test('I know this on Continue skips the step Continue would open', () => {
  const h = fakeHost();
  h.session.init();
  const before = h.session.decorateRow(h.session.nav[0].node.children[0]).value;
  sheet(h, 0, 'I know this: skip');
  const after = h.session.decorateRow(h.session.nav[0].node.children[0]).value;
  assert.notEqual(after, before);
  assert.ok(h.said().some((t) => t.startsWith('Skipped. Next: ')));
});

test('program steps are built in C, whatever the Key and Scale settings say', () => {
  const h = fakeHost({ settings: { ...QUIET, rootPc: 6, mode: 'dorian' } });
  h.session.init();
  openPath(h.session, ['Path', '1 Grid and staff', '1.3 Major scale', 'Major up & down']);
  assert.equal(h.session.armedId, 'basics/scales/major/up-down');
  assert.equal(h.session.chart.keySig, 0, 'C major on the path: ' + h.session.chart.name);
  for (let i = 0; i < 4; i++) h.session.back();
  openPath(h.session, ['Practice', 'Scales', 'Major', 'Up & down']);
  assert.notEqual(h.session.chart.keySig, 0, 'Practice follows the settings');
  for (let i = 0; i < 5; i++) h.session.back();
  openPath(h.session, ['Path', '1 Grid and staff', '1.1 Find the notes', 'Notes by alphabet']);
  assert.equal(h.session.view, GUESS_VIEW);
  assert.equal(h.session.keyFifths().fifths, 0, 'a quiz step asks in C too');
});

test('Continue names its step; when a review is due it alternates, review first', () => {
  const h = fakeHost();
  h.session.init();
  const cont = () => h.session.decorateRow(h.session.nav[0].node.children[0]);
  assert.deepEqual(cont(), { label: 'Continue', value: 'Notes by alphabet', fit: true });
  assert.deepEqual(h.session.nav[0].node.children[1].children.map((r) => r.label).slice(-1), ['5 Colour'],
    'no Review folder while nothing is due');
  PROG.recordAttempt(h.session.progress, 'song:twinkle/1r', { stage: 1, score: 1, at: WALL0 - 10 * DAY });
  PROG.recordAttempt(h.session.progress, 'song:twinkle/1r', { stage: 2, score: 1, at: WALL0 - 10 * DAY });
  PROG.recordAttempt(h.session.progress, 'song:mary-had-a-lamb/1r', { stage: 1, score: 1, at: WALL0 - 10 * DAY });
  PROG.recordAttempt(h.session.progress, 'song:mary-had-a-lamb/1r', { stage: 2, score: 1, at: WALL0 - 10 * DAY });
  assert.equal(h.session.nav[0].node.children[1].children.at(-1).label, 'Review', 'Review shows once due');
  assert.equal(cont().label, 'Review');
  const opened = [];
  for (let i = 0; i < 4; i++) {
    h.session.selectRow(0);
    opened.push(cont().label);
    h.session.activate(false);
    h.session.back();
    if (h.session.view !== MENU) h.session.back();
  }
  assert.deepEqual(opened, ['Review', 'Continue', 'Review', 'Continue']);
  /* A review is done once repeated cleanly today: then only new steps. */
  for (const id of ['song:twinkle/1r', 'song:mary-had-a-lamb/1r']) {
    PROG.recordAttempt(h.session.progress, id, { stage: 2, score: 1, at: WALL0 });
  }
  assert.equal(cont().label, 'Continue');
  assert.notEqual(h.session.nav[0].node.children[1].children.at(-1).label, 'Review');
});

test('the welcome runs on a first launch: From the start lands on Continue', () => {
  const h = fakeHost({ progress: null });
  h.session.init();
  assert.equal(h.session.view, CARD_VIEW);
  assert.equal(h.session.card.pages[0].title, 'Welcome');
  assert.deepEqual(h.session.hint(), ['JOG page  CLICK go on']);
  h.session.activate(false);
  assert.equal(h.session.card.pages[h.session.card.page].title, 'Keys');
  h.session.moveSelection(1);
  assert.equal(h.session.card.pages[h.session.card.page].title, 'New to piano?');
  assert.deepEqual(h.session.hint(), ['JOG choose  CLICK ok']);
  h.session.activate(false);                     /* From the start */
  assert.equal(h.session.view, MENU);
  assert.equal(h.session.nav.length, 1);
  assert.equal(h.session.nav[0].cursor, 0, 'on Continue');
  assert.ok(PROG.tipSeen(h.session.progress, 'welcome'));
  /* Once: the next launch goes straight to the list. */
  const again = fakeHost({ progress: JSON.parse(h.files.get('progress.json')) });
  again.session.init();
  assert.equal(again.session.view, MENU);
});

test('I already play opens the Path with a tip on testing out', () => {
  const h = fakeHost({ progress: null });
  h.session.init();
  h.session.pickCard(1);                         /* not on the choice page yet */
  assert.equal(h.session.card.page, 0);
  h.session.moveSelection(1);
  h.session.moveSelection(1);
  h.session.pickCard(1);
  assert.equal(h.session.view, CARD_VIEW);
  assert.equal(h.session.card.kind, 'tip');
  assert.match(h.session.card.pages[0].paragraphs[0].text, /^Know a stage already\? SHIFT\+CLICK a stage/);
  h.session.back();
  assert.equal(h.session.view, MENU);
  assert.equal(h.session.nav.at(-1).node.label, 'Path');
});

test('BACK dismisses the welcome; an existing learner is never shown it', () => {
  const h = fakeHost({ progress: null });
  h.session.init();
  h.session.back();
  assert.equal(h.session.view, MENU);
  assert.ok(PROG.tipSeen(h.session.progress, 'welcome'));
  const old = fakeHost({ progress: { items: { 'basics/scales/major/up': { plays: 1, stages: [] } } } });
  old.session.init();
  assert.equal(old.session.view, MENU);
  assert.ok(PROG.tipSeen(old.session.progress, 'welcome'), 'marked silently');
  assert.ok(JSON.parse(old.files.get('progress.json')).tips.includes('welcome'));
});

test('a first-visit tip shows once, over the screen it explains', () => {
  const h = fakeHost({ progress: { tips: ['welcome'] } });
  h.session.init();
  openPath(h.session, ['Practice', 'Scales', 'Major', 'Up & down']);
  assert.equal(h.session.view, CARD_VIEW);
  assert.match(h.session.card.pages[0].paragraphs[0].text, /^REC plays and scores it/);
  h.session.activate(false);
  assert.equal(h.session.view, READY, 'back to the piece');
  h.session.back();
  openPath(h.session, ['Down']);
  assert.equal(h.session.view, READY, 'shown once');
  for (let i = 0; i < 4; i++) h.session.back();
  openPath(h.session, ['Quiz', 'Keys', 'Name notes']);
  assert.equal(h.session.view, CARD_VIEW);
  assert.match(h.session.card.pages[0].paragraphs[0].text, /^Answer with the lit pads/);
  h.session.back();
  assert.equal(h.session.view, GUESS_VIEW);
  assert.deepEqual([...h.session.progress.tips].sort(), ['practice', 'quiz', 'welcome']);
});

test('MENU is help on every screen, with the keys of that screen', () => {
  const h = fakeHost();
  h.session.init();
  const keys = () => {
    const p = h.session.info.paragraphs.map((x) => x.text);
    const from = p.indexOf('Keys') + 1;
    const to = p.indexOf('', from);
    return p.slice(from, to < 0 ? p.length : to);
  };
  h.session.menuButton();
  assert.equal(h.session.view, INFO_VIEW);
  assert.deepEqual(keys(), ['CLICK open', 'MENU help', 'SHIFT+CLICK options', 'SHIFT+BACK quit']);
  h.session.menuButton();
  assert.equal(h.session.view, MENU, 'MENU closes it too');
  h.session.selectRow(0);
  h.session.activate(true);
  h.session.menuButton();
  assert.equal(h.session.info.title, 'Options');
  assert.deepEqual(keys().slice(0, 2), ['CLICK do it', 'BACK close']);
  h.session.back();
  assert.equal(h.session.view, SHEET_VIEW, 'BACK returns to the sheet');
  h.session.back();
  openPath(h.session, ['Settings', 'Sound']);
  h.session.menuButton();
  assert.equal(h.session.info.title, 'Sound');
  h.session.back();
  assert.equal(h.session.view, SETTINGS);
});

test('the hint line names the keys of every screen, and the Shift layer while Shift is held', () => {
  const h = fakeHost();
  h.session.init();
  assert.deepEqual(h.session.hint(), ['CLICK open  MENU help']);
  assert.deepEqual(h.session.hint({ shift: true }), ['SHIFT: CLICK options', 'SHIFT: BACK quit']);
  openPath(h.session, ['Practice']);
  assert.deepEqual(h.session.hint(), ['CLICK open  BACK up']);
  openPath(h.session, ['Scales', 'Major', 'Up & down']);
  assert.deepEqual(h.session.hint(), ['REC start', 'PLAY listen', 'S1 pads lit  JOG S2']);
  h.session.recordButton();
  assert.deepEqual(h.session.hint(), ['REC pause  BACK stop']);
  h.session.recordButton();
  assert.deepEqual(h.session.hint(), ['PAUSED  REC go on', 'BACK stop']);
});
