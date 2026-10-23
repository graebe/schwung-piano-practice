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
import { fakeHost, openPath, openSettings, QUIET } from './support/fake_host.mjs';
import {
  MENU, READY, RUNNING, SETTINGS, GUESS_VIEW, RESULT_VIEW, PROGRESS_VIEW, PROGRESS_DETAIL, INFO_VIEW,
  SHEET_VIEW, CARD_VIEW, OUT_INTERNAL,
} from '../src/session.mjs';
import * as GUESS from '../src/guess.mjs';
import * as PROG from '../src/progress.mjs';
import { settingIndex } from '../src/settings_def.mjs';

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
  assert.deepEqual(rows, ['Learning Path', 'Practice', 'Quiz', 'Progress', 'Settings']);
  assert.ok(h.session.onHome(), 'drawn as the home screen');
  const songs = h.session.nav[0].node.children[1].children.find((r) => r.label === 'Songs');
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
  h.session.selectRow(1);
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
  openSettings(h.session, 'practice');
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
  assert.equal(h.session.nav.at(-1).node.label, 'Advanced', 'back in the folder of groups');
});

test('Settings is one short page, edited in place; Advanced holds the groups', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Settings']);                /* its circle on home: the page */
  assert.equal(h.session.view, SETTINGS);
  assert.deepEqual(h.session.settingsRows().map((r) => r.label), ['Octave', 'Click', 'Key', 'Scale', 'Start at', 'Advanced']);
  assert.deepEqual(h.session.hint(), ['CLICK edit  BACK up']);
  /* Start at: where Continue starts, kept with the progress. */
  h.session.selectSettingRow(4);
  assert.deepEqual(h.session.settingsRows()[4], { label: 'Start at', value: 'stage 1', edit: 'start' });
  h.session.activate(false);
  h.session.moveSelection(1);
  assert.equal(PROG.programStart(h.session.progress), 1);
  assert.equal(h.session.settingsRows()[4].value, 'stage 2');
  h.session.moveSelection(-1);
  h.session.moveSelection(-1);
  assert.equal(PROG.programStart(h.session.progress), 0, 'clamped at the first stage');
  h.session.activate(false);
  /* Advanced: a real folder of the groups. */
  h.session.moveSelection(1);
  assert.deepEqual(h.session.hint(), ['CLICK open  BACK up'], 'the Advanced row opens');
  h.session.activate(false);
  assert.equal(h.session.view, MENU);
  assert.deepEqual(h.session.nav.map((n) => n.node.label), ['Piano', 'Settings', 'Advanced']);
  assert.deepEqual(h.session.nav.at(-1).node.children.map((r) => r.label), ['Practice', 'Sound', 'MIDI', 'Help']);
  openPath(h.session, ['MIDI']);
  assert.deepEqual(h.session.settingsRows().map((r) => r.label), ['MIDI out', 'MIDI ch']);
  /* The jog edits the open group's row, by its place on the page. */
  h.session.moveSelection(1);
  h.session.activate(false);
  h.session.moveSelection(1);
  assert.equal(h.session.settings.midiCh, 1);
  h.session.activate(false);
  assert.equal(h.session.settingsEditing, false);
  /* Back: the group, Advanced, the page on its Advanced row, home on Settings. */
  h.session.back();
  assert.equal(h.session.nav.at(-1).node.label, 'Advanced');
  h.session.back();
  assert.equal(h.session.view, SETTINGS);
  assert.equal(h.session.settingsGroup, 'main');
  assert.equal(h.session.settingsCursor, 5, 'on Advanced');
  h.session.back();
  assert.equal(h.session.view, MENU);
  assert.ok(h.session.onHome());
  assert.equal(h.session.homeModel().selected, 4, 'home, on Settings');
});

test('Shift + click on a piece opens the page; Shift + click on any settings page goes back to the piece', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Practice', 'Scales', 'Major', 'Up & down']);
  h.session.activate(true);
  assert.equal(h.session.view, SETTINGS);
  assert.equal(h.session.settingsGroup, 'main');
  h.session.activate(true);
  assert.equal(h.session.view, READY, 'Shift + click: the piece again');
  h.session.activate(true);
  h.session.back();
  assert.equal(h.session.view, READY, 'Back: the piece again');
  /* From a group of Advanced, Shift + click goes all the way back. */
  h.session.activate(true);
  h.session.selectSettingRow(5);
  h.session.activate(false);
  openPath(h.session, ['Practice']);
  assert.equal(h.session.settingsGroup, 'practice');
  h.session.activate(true);
  assert.equal(h.session.view, READY);
  assert.deepEqual(h.session.nav.map((n) => n.node.label), ['Piano', 'Practice', 'Scales', 'Major'],
    'the list underneath is where it was');
  /* And Back from Advanced's group goes the long way round, to the piece. */
  h.session.activate(true);
  h.session.selectSettingRow(5);
  h.session.activate(false);
  openPath(h.session, ['Sound']);
  h.session.back();
  h.session.back();
  h.session.back();
  assert.equal(h.session.view, READY);
});

test('a rebuild inside Advanced keeps the list where it is', () => {
  const h = fakeHost();
  h.session.init();
  openSettings(h.session, 'practice');
  const half = h.session.settingsRows().findIndex((r) => r.label === 'Half tones');
  h.session.editRow(half, 1);                       /* Half tones: the menu is rebuilt */
  h.session.back();
  assert.deepEqual(h.session.nav.map((n) => n.node.label), ['Piano', 'Settings', 'Advanced']);
  h.session.back();
  assert.equal(h.session.settingsGroup, 'main');
});

test('Settings > Help: show tips again, and the welcome again', () => {
  const h = fakeHost();
  h.session.init();
  openSettings(h.session, 'help');
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
  h.session.editSetting(settingIndex('midiCh'), 1);
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
  openPath(h.session, ['Learning Path']);
  sheet(h, 1, 'Test out: checkpoint');
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
  openPath(h.session, ['Learning Path', '1 Grid and staff']);
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
  sheet(h, 5, 'Start the path here');
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
  openPath(h.session, ['Learning Path', '1 Grid and staff', '1.3 Major scale', 'Major up & down']);
  assert.equal(h.session.stage, 2);
  playThrough(h);
  assert.ok(PROG.stagePassed(PROG.item(p, 'basics/scales/major/up-down'), 2));
  assert.equal(PROG.programStart(p), 0, 'not a checkpoint: nothing is assumed');
  assert.ok(!h.said().some((t) => /Checkpoint/.test(t)));
});

test('Start the path here moves where Continue begins', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Learning Path']);
  sheet(h, 3, 'Start the path here');
  assert.equal(h.session.view, MENU, 'the sheet closes');
  assert.equal(PROG.programStart(h.session.progress), 2);
  assert.ok(h.said().some((t) => /The path starts at stage 3/.test(t)));
  h.session.playButton();                        /* Continue, on the map */
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
  h.session.selectRow(1);
  h.session.activate(true);
  assert.deepEqual(labels(), ['Show as list', 'Settings...'], 'Practice, on home: its list is an option');
  h.session.back();
  assert.equal(h.session.view, MENU, 'BACK closes it');
  openPath(h.session, ['Learning Path']);
  sheet(h, 1, 'Show as list');
  h.session.selectRow(0);
  h.session.activate(true);
  assert.deepEqual(labels(), ['I know this: skip', 'Show as map', 'Settings...'], 'Continue, in the Path\'s list');
  h.session.pickSheet(1);
  assert.ok(h.session.onMap(), 'the map again');
  h.session.selectRow(1);
  h.session.activate(true);
  assert.deepEqual(labels(), ['I know it all: skip', 'Start the path here', 'Test out: checkpoint', 'Show as list',
    'Settings...'], 'on the world map its list is an option');
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
  /* Settings... opens the Settings page over the list, and Back returns to it. */
  h.session.activate(true);
  h.session.pickSheet(h.session.sheet.items.length - 1);
  assert.equal(h.session.view, SETTINGS);
  assert.equal(h.session.settingsGroup, 'main');
  h.session.back();
  assert.equal(h.session.nav.at(-1).node.label, '1.3 Major scale', 'the list it was asked from');
});

test('I know it all skips a whole unit, and Undo skip takes it back', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Learning Path', '1 Grid and staff']);
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
  openPath(h.session, ['Learning Path']);
  sheet(h, 1, 'Show as list');
  const cont = () => h.session.nav.at(-1).node.children[0];
  assert.ok(cont().continueRow, 'Continue is the first row of the Path\'s list');
  const before = h.session.decorateRow(cont()).value;
  sheet(h, 0, 'I know this: skip');
  const after = h.session.decorateRow(cont()).value;
  assert.notEqual(after, before);
  assert.ok(h.said().some((t) => t.startsWith('Skipped. Next: ')));
});

test('program steps are built in C, whatever the Key and Scale settings say', () => {
  const h = fakeHost({ settings: { ...QUIET, rootPc: 6, mode: 'dorian' } });
  h.session.init();
  openPath(h.session, ['Learning Path', '1 Grid and staff', '1.3 Major scale', 'Major up & down']);
  assert.equal(h.session.armedId, 'basics/scales/major/up-down');
  assert.equal(h.session.chart.keySig, 0, 'C major on the path: ' + h.session.chart.name);
  for (let i = 0; i < 4; i++) {
    h.session.back();
    h.run(400);                                  /* the island zooms out to the world */
  }
  openPath(h.session, ['Practice', 'Scales', 'Major', 'Up & down']);
  assert.notEqual(h.session.chart.keySig, 0, 'Practice follows the settings');
  for (let i = 0; i < 5; i++) h.session.back();
  openPath(h.session, ['Learning Path', '1 Grid and staff', '1.1 Find the notes', 'Notes by alphabet']);
  assert.equal(h.session.view, GUESS_VIEW);
  assert.equal(h.session.keyFifths().fifths, 0, 'a quiz step asks in C too');
});

test('Continue names its step; when a review is due it alternates, review first', () => {
  const h = fakeHost();
  h.session.init();
  const path = h.session.nav[0].node.children[0];
  const cont = () => h.session.decorateRow(path.children[0]);
  openPath(h.session, ['Learning Path']);
  sheet(h, 1, 'Show as list');
  assert.deepEqual(cont(), { label: 'Continue', value: 'Notes by alphabet', short: '1.1', title: 'Notes by alphabet' });
  h.session.selectRow(0);
  assert.equal(h.session.listTitle(), 'Notes by alphabet', 'the title spells out what Continue opens');
  h.session.selectRow(1);
  assert.equal(h.session.listTitle(), 'Learning Path', 'elsewhere it is the folder');
  h.session.selectRow(0);
  assert.deepEqual(path.children.map((r) => r.label).slice(-1), ['5 Colour'],
    'no Review folder while nothing is due');
  PROG.recordAttempt(h.session.progress, 'song:twinkle/1r', { stage: 1, score: 1, at: WALL0 - 10 * DAY });
  PROG.recordAttempt(h.session.progress, 'song:twinkle/1r', { stage: 2, score: 1, at: WALL0 - 10 * DAY });
  PROG.recordAttempt(h.session.progress, 'song:mary-had-a-lamb/1r', { stage: 1, score: 1, at: WALL0 - 10 * DAY });
  PROG.recordAttempt(h.session.progress, 'song:mary-had-a-lamb/1r', { stage: 2, score: 1, at: WALL0 - 10 * DAY });
  assert.equal(path.children.at(-1).label, 'Review', 'Review shows once due');
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
  assert.notEqual(path.children.at(-1).label, 'Review');
});

test('the welcome runs on a first launch: From the start lands on the Path map', () => {
  const h = fakeHost({ progress: null });
  h.session.init();
  assert.equal(h.session.view, CARD_VIEW);
  assert.equal(h.session.card.pages[0].title, 'Welcome');
  assert.deepEqual(h.session.hint(), ['JOG page  CLICK go on']);
  h.session.activate(false);
  assert.equal(h.session.card.pages[h.session.card.page].title, 'Welcome', 'Lit pads can be pressed');
  h.session.moveSelection(1);
  assert.equal(h.session.card.pages[h.session.card.page].title, 'Keys');
  h.session.moveSelection(1);
  assert.equal(h.session.card.pages[h.session.card.page].title, 'New to piano?');
  assert.deepEqual(h.session.hint(), ['JOG choose  CLICK ok']);
  h.session.activate(false);                     /* From the start */
  assert.equal(h.session.view, MENU);
  assert.equal(h.session.nav.length, 2);
  assert.equal(h.session.nav[1].node.label, 'Learning Path');
  assert.ok(h.session.onMap(), 'on the Path map: PLAY opens the first step');
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
  for (let i = 0; i < 3; i++) h.session.moveSelection(1);
  h.session.pickCard(1);
  assert.equal(h.session.view, CARD_VIEW);
  assert.equal(h.session.card.kind, 'tip');
  assert.match(h.session.card.pages[0].paragraphs[0].text, /^Know a stage already\? SHIFT\+CLICK a stage/);
  h.session.back();
  assert.equal(h.session.view, MENU);
  assert.equal(h.session.nav.at(-1).node.label, 'Learning Path');
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
  assert.deepEqual(keys(), ['JOG choose', 'CLICK open', 'PAD open', 'MENU help', 'SHIFT+CLICK options',
    'SHIFT+BACK quit']);
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
  openSettings(h.session, 'sound');
  h.session.menuButton();
  assert.equal(h.session.info.title, 'Sound');
  h.session.back();
  assert.equal(h.session.view, SETTINGS);
});

test('the hint line names the keys of every screen, and the Shift layer while Shift is held', () => {
  const h = fakeHost();
  h.session.init();
  assert.deepEqual(h.session.hint(), ['JOG choose', 'CLICK open  PAD open', 'MENU help']);
  assert.deepEqual(h.session.hint({ shift: true }), ['SHIFT: CLICK options', 'SHIFT: BACK quit']);
  openPath(h.session, ['Practice']);
  assert.deepEqual(h.session.hint(), ['JOG choose', 'CLICK open  PAD open', 'MENU help'], 'a ring');
  openPath(h.session, ['Scales']);
  assert.deepEqual(h.session.hint(), ['CLICK open  BACK up']);
  openPath(h.session, ['Major', 'Up & down']);
  assert.deepEqual(h.session.hint(), ['JOG Solo  REC start', 'PLAY listen']);
  assert.equal(h.session.levelInfo().name, 'Guided: pads lit', 'the bottom line names it');
  h.session.recordButton();
  assert.deepEqual(h.session.hint(), ['REC pause  BACK stop']);
  h.session.recordButton();
  assert.deepEqual(h.session.hint(), ['PAUSED  REC go on', 'BACK stop']);
});

/* ---- The Path as a map ------------------------------------------------------ */

import { layoutPlaces, padOfCell } from '../src/pathmap/layout.mjs';

const padOf = (n, i) => padOfCell(layoutPlaces(n).cells[i]);

test('the Path is a world map, a stage an island; the cursor stays a child index', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Learning Path']);
  assert.ok(h.session.onMap());
  assert.equal(h.session.screenNow(), 'map');
  const m = h.session.mapModel();
  assert.deepEqual(m.places.map((p) => p.kind), ['island', 'island', 'island', 'island', 'island']);
  assert.equal(m.at, 0, 'the avatar on the current stage');
  assert.deepEqual(h.session.hint(), ['PAD go  CLICK enter', 'PLAY continue', 'MENU help']);
  h.session.moveSelection(1);
  assert.equal(h.session.nav.at(-1).cursor, 2, 'the jog walks, and the cursor follows: Continue is row 0');
  h.run(2000);
  assert.ok(h.said().includes('2 Four chords, 0 percent.'), 'arriving says where');
  h.session.activate(false);
  assert.equal(h.session.nav.at(-1).node.label, '2 Four chords');
  assert.equal(h.session.view, 'anim', 'into an island: a zoom');
  assert.deepEqual([h.session.scene.kind, h.session.scene.dir], ['zoom', 'in']);
  assert.ok(h.said().includes('2 Four chords.'), 'said as it starts');
  h.run(400);
  const island = h.session.mapModel();
  assert.equal(island.places.at(-1).kind, 'fort');
  assert.equal(island.places.length, h.session.nav.at(-1).node.children.length);
  h.session.back();
  assert.deepEqual([h.session.scene.kind, h.session.scene.dir], ['zoom', 'out'], 'out of it: the zoom back');
  h.run(400);
  assert.equal(h.session.mapModel().at, 1, 'Back: the avatar on the island it left');
});

test('a pad walks there and a second press goes in; water and lists are not the map', () => {
  const h = fakeHost();
  h.session.init();
  assert.equal(h.session.mapPad(68), false, 'the top list is no map: the pad is a note');
  openPath(h.session, ['Learning Path']);
  assert.equal(h.session.mapPad(padOf(5, 3)), true);
  assert.equal(h.session.mapModel().at, 3);
  assert.equal(h.session.nav.at(-1).node.label, 'Learning Path', 'walking, not in yet');
  h.session.mapPad(padOf(5, 3));
  assert.equal(h.session.nav.at(-1).node.label, '4 Sevenths');
  h.run(400);
  const taken = new Set(layoutPlaces(h.session.mapModel().places.length, { kind: 'island' }).cells.map(padOfCell));
  const water = [...Array(32).keys()].map((i) => 68 + i).find((n) => !taken.has(n));
  const before = h.session.mapModel().at;
  assert.equal(h.session.mapPad(water), true, 'the map takes it, and makes no sound');
  assert.equal(h.session.mapModel().at, before, 'water: nothing');
  h.session.mapPick(99);
  assert.equal(h.session.mapModel().at, before, 'a place that is not there: nothing');
});

test('on the map Play is Continue, and its options show it as a list for the session', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Learning Path']);
  h.session.activate(true);
  assert.deepEqual(h.session.sheet.items.map((i) => i.label).slice(-2), ['Show as list', 'Settings...']);
  h.session.pickSheet(h.session.sheet.items.length - 2);
  assert.equal(h.session.onMap(), false, 'the list');
  h.session.activate(true);
  assert.deepEqual(h.session.sheet.items.map((i) => i.label).slice(-2), ['Show as map', 'Settings...']);
  h.session.back();
  h.session.back();
  assert.equal(h.session.onMap(), true, 'Back from the list is the map');
  h.session.playButton();
  assert.equal(h.session.view, GUESS_VIEW, 'Play: Continue\'s step');
});

test('MENU on the map: what the map is, then the place under the avatar', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Learning Path', '1 Grid and staff']);
  h.run(400);
  h.session.menuButton();
  const text = h.session.info.paragraphs.map((p) => p.text);
  assert.match(text[0], /^The map: a lit pad is a place/);
  assert.ok(text.includes('PAD go'));
  assert.ok(text.includes('More help'));
  assert.ok(text.some((t) => /Getting from a note's name to its pad/.test(t)), 'the unit\'s purpose');
});

test('the map and island tips show once each', () => {
  const h = fakeHost({ progress: { tips: ['welcome'] } });
  h.session.init();
  openPath(h.session, ['Learning Path']);
  h.run(20);
  assert.equal(h.session.view, CARD_VIEW);
  assert.match(h.session.card.pages[0].paragraphs[0].text, /^Lit pads are places/);
  h.session.back();
  h.session.activate(false);
  h.run(400);                                    /* the zoom in, then the tip */
  assert.match(h.session.card.pages[0].paragraphs[0].text, /^Each place is part of the stage/);
  h.session.back();
  h.session.back();
  h.run(400);                                    /* the zoom out */
  assert.equal(h.session.view, MENU, 'shown once');
  assert.equal(h.session.canGoBack(), true);
  h.session.back();
  assert.equal(h.session.canGoBack(), false, 'at the top Back leaves');
});

/* ---- One menu level less: the level on the ready screen --------------------- */

test('a song is one row: it arms its first level not learned, and the jog walks 1G, 1S, 2G...', () => {
  const h = fakeHost();
  h.session.init();
  PROG.recordAttempt(h.session.progress, 'song:ode-to-joy/1r', { stage: 2, score: 1, at: WALL0 });
  openPath(h.session, ['Practice', 'Songs', 'Classics']);
  const row = h.session.nav.at(-1).node.children.find((r) => r.key === 'song:ode-to-joy');
  assert.ok(row.levels && !('children' in row), 'no ladder folder');
  assert.equal(h.session.decorateRow(row).mark, PROG.MARK_HALF, 'the row sums its levels');
  h.session.selectRow(h.session.nav.at(-1).node.children.indexOf(row));
  h.session.activate(false);
  assert.equal(h.session.view, READY);
  assert.equal(h.session.armedId, 'song:ode-to-joy/1l', 'L1 RH is learned: the next level');
  let info = h.session.levelInfo();
  assert.deepEqual([info.index, info.stage, info.ladder], [1, 1, true]);
  assert.equal(info.name, 'L1 LH bass  Guided');
  assert.deepEqual(info.levels.map((l) => l.learned), [true, false, false, false]);
  const walk = [];
  for (let i = 0; i < 9; i++) {
    h.session.moveSelection(1);
    walk.push(h.session.levelInfo().index + (h.session.stage === 2 ? 'S' : 'G'));
  }
  assert.deepEqual(walk, ['1S', '2G', '2S', '3G', '3S', '3S', '3S', '3S', '3S'], 'clamped at the last Solo');
  assert.equal(h.session.armedId, 'song:ode-to-joy/3');
  for (let i = 0; i < 9; i++) h.session.moveSelection(-1);
  info = h.session.levelInfo();
  assert.deepEqual([info.index, info.stage], [0, 1], 'clamped at the first Guided');
  assert.ok(h.said().includes('Level L2 RH chords. Guided.'), 'a new level is said');
});

test('a level changed after a scrub starts from bar 1', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Practice', 'Songs', 'Classics', 'Ode to Joy']);
  h.session.scrubBy(40);
  assert.ok(h.session.songBeats > 0);
  h.session.moveSelection(1);
  assert.ok(h.session.songBeats > 0, 'Guided to Solo keeps the place');
  h.session.moveSelection(1);
  assert.ok(h.session.songBeats <= 0, 'a new level: home to bar 1');
});

test('a Path step and a review arm their own level', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Learning Path', '2 Four chords', '2.7 First tracks']);
  const folder = h.session.nav.at(-1).node.children[0];
  openPath(h.session, [folder.label, 'L3 Both hands']);
  assert.equal(h.session.view, READY);
  assert.match(h.session.armedId, /\/3$/, 'the step\'s own level');
  assert.equal(h.session.levelInfo().index, 3);
  const r = fakeHost();
  r.session.init();
  for (const st of [1, 2]) PROG.recordAttempt(r.session.progress, 'song:twinkle/2r', { stage: st, score: 1, at: WALL0 - 10 * DAY });
  r.session.activate(false);                     /* Path */
  r.session.playButton();                        /* Continue: the review first */
  assert.equal(r.session.armedId, 'song:twinkle/2r', 'Review arms the due level');
  assert.equal(r.session.levelInfo().index, 2);
});

test('the web\'s level action arms a level, on the ready screen only', () => {
  const h = fakeHost();
  h.session.init();
  h.session.armLevel(2);
  assert.equal(h.session.view, MENU, 'nothing armed: nothing to do');
  openPath(h.session, ['Practice', 'Songs', 'Classics', 'Ode to Joy']);
  h.session.armLevel(3);
  assert.equal(h.session.armedId, 'song:ode-to-joy/3');
  h.session.armLevel(9);
  assert.equal(h.session.armedId, 'song:ode-to-joy/3', 'out of range: nothing');
});

/* ---- Home: the top of the list as five circles ------------------------------ */

import { growing, radiusAt, R_SMALL, R_LARGE, GROW_MS, HOME_PADS } from '../src/home/render.mjs';
import { PRACTICE_PIANO } from '../src/home/icons.mjs';

test('home is five circles, no Continue among them; the jog grows the next one', () => {
  const h = fakeHost();
  h.session.init();
  assert.ok(h.session.onHome());
  assert.equal(h.session.screenNow(), 'home');
  const m = h.session.homeModel();
  assert.deepEqual(m.items.map((it) => [it.key, it.label]), [['program', 'Learning Path'], ['basics', 'Practice'],
    ['quiz', 'Quiz'], ['progress', 'Progress'], ['settings', 'Settings']]);
  assert.deepEqual(m.items.map((it) => it.icon), ['path', PRACTICE_PIANO, 'quiz', 'progress', 'settings']);
  assert.equal(m.selected, 0);
  const t0 = h.ms;
  h.session.moveSelection(1);
  const g = h.session.homeModel().grow;
  assert.equal(h.session.homeModel().selected, 1);
  assert.ok(growing(g, t0), 'growing');
  assert.equal(radiusAt(g, 1, t0), R_SMALL, 'from small');
  h.run(GROW_MS);
  assert.ok(!growing(g, h.ms), 'grown');
  assert.equal(radiusAt(g, 1, h.ms), R_LARGE);
  assert.equal(radiusAt(g, 0, h.ms), R_SMALL, 'the one it left shrinks back');
  assert.ok(h.said().includes('Practice.'));
  for (let i = 0; i < 9; i++) h.session.moveSelection(1);
  assert.equal(h.session.homeModel().selected, 4, 'clamped on Settings');
  h.session.playButton();
  assert.ok(h.session.onHome(), 'home has nothing to play');
});

test('a click or a circle\'s pad opens it, silently; Back finds its circle selected', () => {
  const h = fakeHost();
  h.session.init();
  const want = ['Learning Path', 'Practice', 'Quiz', PROGRESS_VIEW, SETTINGS];
  for (let i = 0; i < HOME_PADS.length; i++) {
    assert.equal(h.session.homePad(HOME_PADS[i]), true, 'home takes the pad');
    if (i < 3) assert.equal(h.session.nav.at(-1).node.label, want[i]);
    else assert.equal(h.session.view, want[i], 'Progress and Settings are pages');
    h.session.back();
    assert.ok(h.session.onHome(), 'Back: home');
    assert.equal(h.session.homeModel().selected, i, 'on the circle it left');
  }
  assert.equal(h.session.homePad(68), true, 'a pad off the five: taken, and nothing');
  assert.ok(h.session.onHome());
  assert.ok(!h.log.some((e) => e[0] === 'strike'), 'nothing sounded');
  h.session.selectRow(2);
  h.session.activate(false);
  assert.equal(h.session.nav.at(-1).node.label, 'Quiz', 'Click opens the selected one');
  assert.equal(h.session.homePad(69), true, 'the Quiz ring takes every pad');
  assert.equal(h.session.nav.at(-1).node.label, 'Quiz', 'but 69 is no circle of three');
  h.session.homePad(70);
  assert.equal(h.session.nav.at(-1).node.label, 'Ear', 'its first circle is pad 70');
  assert.equal(h.session.homePad(70), false, 'in a list a pad is a note');
});

test('Shift + Click on home shows the five as a list for the session; Back is the circles again', () => {
  const h = fakeHost();
  h.session.init();
  h.session.activate(true);
  const at = h.session.sheet.items.findIndex((it) => it.label === 'Show as list');
  h.session.pickSheet(at);
  assert.equal(h.session.onHome(), false);
  assert.equal(h.session.homeModel(), null);
  assert.deepEqual(h.session.nav[0].node.children.map((r) => r.label), ['Learning Path', 'Practice', 'Quiz', 'Progress',
    'Settings']);
  assert.equal(h.session.canGoBack(), true, 'Back from the list is home, not quit');
  openPath(h.session, ['Practice']);
  h.session.back();
  assert.equal(h.session.onHome(), false, 'the list stays for the session');
  h.session.back();
  assert.ok(h.session.onHome(), 'the circles again');
  assert.ok(h.said().includes('Home.'));
  assert.equal(h.session.canGoBack(), false);
});

/* ---- Scenes: the Learning Path in motion ------------------------------------ */

import * as PLAN from '../src/program.mjs';

/* Every step of `unit` learned, but `except`. */
function learnUnit(h, unit, except = null) {
  for (const st of PLAN.unitSteps(unit)) {
    if (st.id === except) continue;
    PROG.recordAttempt(h.session.progress, st.id, { stage: 1, score: 1, at: WALL0 });
    PROG.recordAttempt(h.session.progress, st.id, { stage: 2, score: 1, at: WALL0 });
  }
}

/* The scenes as they play out, by kind, until the screen is no scene. */
function sceneKinds(h) {
  const seen = [];
  let last = null;
  for (let i = 0; i < 400 && h.session.view === 'anim'; i++) {
    const sc = h.session.scene;
    if (sc !== last) {
      seen.push(sc.kind + (sc.dir ? '-' + sc.dir : '') + (sc.fireworks ? '+fireworks' : '') + (sc.text ? ' ' + sc.text : ''));
    }
    last = sc;
    h.run(50);
  }
  return seen;
}

const unitByKey = (h, key) => h.session.phases.flatMap((p) => p.units).find((u) => u.key === key);

/* 1.3 Major scale: up & down learned, down passed Guided and armed Solo. */
function lastStepOfUnit(h) {
  const unit = unitByKey(h, 'major-scale');
  learnUnit(h, unit, 'basics/scales/major/down');
  PROG.recordAttempt(h.session.progress, 'basics/scales/major/down', { stage: 1, score: 1, at: WALL0 });
  openPath(h.session, ['Learning Path', '1 Grid and staff', '1.3 Major scale']);
  const rows = h.session.nav.at(-1).node.children;
  h.session.selectRow(rows.findIndex((r) => r.step && r.step.id === 'basics/scales/major/down'));
  h.session.activate(false);
  assert.equal(h.session.armedId, 'basics/scales/major/down');
  assert.equal(h.session.stage, 2);
  return unit;
}

test('a level learned: a star over the result, once, and then the result', () => {
  const h = fakeHost();
  h.session.init();
  lastStepOfUnit(h);
  playThroughFromHere(h);
  assert.equal(h.session.view, 'anim');
  assert.equal(h.session.scene.kind, 'star');
  assert.equal(h.session.scene.over, 'result');
  assert.ok(h.said().includes('Level learned.'));
  assert.ok(h.session.lastResult, 'the result is under it');
  h.run(700);
  assert.equal(h.session.view, RESULT_VIEW);
  /* Again: learned already, no star. */
  h.session.recordButton();
  playThroughFromHere(h);
  assert.equal(h.session.view, RESULT_VIEW);
});

/* The armed piece, played on time from wherever its clock is now. */
function playThroughFromHere(h) {
  if (h.session.view !== RUNNING) h.session.recordButton();
  const beatMs = 60000 / h.session.chart.bpm;
  const start = h.ms;
  const countIn = h.session.settings.countIn;
  for (const e of h.session.chart.events) {
    const target = start + (countIn + e.beat) * beatMs;
    if (target > h.ms) h.run(target - h.ms);
    for (const p of e.pitches) h.session.play(p, 100);
    for (const p of e.pitches) h.session.release(p);
  }
  for (let i = 0; i < 200 && h.session.view === RUNNING; i++) h.run(50);
}

test('a place done, Next in another place: the flag, the walk there, then the step', () => {
  const h = fakeHost();
  h.session.init();
  lastStepOfUnit(h);
  playThroughFromHere(h);
  h.run(700);                                    /* the star */
  assert.equal(h.session.view, RESULT_VIEW);
  const before = h.session.progress.rev;
  h.session.activate(false);                     /* Next */
  assert.equal(h.session.view, 'anim');
  assert.deepEqual(h.session.hint(), ['ANY KEY skip']);
  assert.equal(h.session.scene.kind, 'celebrate');
  assert.equal(h.session.scene.map.places[h.session.scene.at].label, '1.3 Major scale');
  assert.ok(h.said().includes('Unit done.'));
  const strikes = h.log.filter((e) => e[0] === 'strike').length;
  assert.deepEqual(sceneKinds(h), ['celebrate', 'walk'], 'the flag, then the walk');
  assert.ok(h.said().some((t) => /^Walking to 1\.\d /.test(t)), h.said().slice(-3).join(' / '));
  assert.ok(h.session.view === READY || h.session.view === GUESS_VIEW, 'then the next step: ' + h.session.view);
  assert.equal(h.log.filter((e) => e[0] === 'strike').length, strikes);
  assert.equal(h.session.progress.rev, before, 'nothing recorded');
});

test('any key or pad skips straight to the end: the next step, nothing sounded or recorded', () => {
  for (const key of ['activate', 'back', 'moveSelection', 'playButton', 'recordButton', 'menuButton', 'play']) {
    const h = fakeHost();
    h.session.init();
    lastStepOfUnit(h);
    playThroughFromHere(h);
    h.run(700);
    h.session.activate(false);
    assert.equal(h.session.view, 'anim', key);
    const rev = h.session.progress.rev;
    const strikes = h.log.filter((e) => e[0] === 'strike').length;
    if (key === 'play') h.session.play(60, 100);
    else if (key === 'moveSelection') h.session.moveSelection(1);
    else h.session[key](false);
    assert.ok(h.session.view === READY || h.session.view === GUESS_VIEW, key + ': the next step, at once: ' + h.session.view);
    assert.equal(h.session.scene, null, key);
    assert.equal(h.log.filter((e) => e[0] === 'strike').length, strikes, key + ': no sound');
    assert.equal(h.session.progress.rev, rev, key + ': nothing recorded');
  }
});

test('Next in the same place: no scene', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Learning Path', '1 Grid and staff', '1.3 Major scale', 'Major up & down']);
  playThroughFromHere(h);                        /* Guided passed: Solo next, the same step */
  h.session.activate(false);
  assert.equal(h.session.view, READY);
  assert.equal(h.session.stage, 2);
});

test('a stage done: fireworks over its fort, out to the world, the sail, into the next island', () => {
  const h = fakeHost();
  h.session.init();
  const p = h.session.progress;
  const phase = h.session.phases[0];
  for (const u of phase.units) learnUnit(h, u, 'basics/scales/major/up-down');
  PROG.recordAttempt(p, 'basics/scales/major/up-down', { stage: 1, score: 1, at: WALL0 });
  openPath(h.session, ['Learning Path']);
  sheet(h, 1, 'Test out: checkpoint');
  assert.equal(h.session.armedId, 'basics/scales/major/up-down');
  playThroughFromHere(h);
  h.run(700);
  assert.equal(h.session.view, RESULT_VIEW);
  h.session.activate(false);
  const kinds = sceneKinds(h);
  assert.deepEqual(kinds.slice(0, 5),
    ['celebrate+fireworks', 'banner CHECKPOINT PASSED', 'zoom-out', 'walk', 'zoom-in'], kinds.join(', '));
  assert.ok(h.said().includes('Stage 1 complete.'));
  assert.ok(h.said().includes('Checkpoint passed.'));
  assert.ok(h.said().includes('World map.'));
  assert.ok(h.said().includes('Sailing to 2 Four chords.'), h.said().slice(-6).join(' / '));
  assert.ok(h.said().includes('2 Four chords.'));
  assert.ok(h.session.view === READY || h.session.view === GUESS_VIEW, h.session.view);
});

test('the whole Learning Path done: the finale on the world map, then the world map', () => {
  const h = fakeHost();
  h.session.init();
  const p = h.session.progress;
  const phases = h.session.phases;
  PROG.setProgramStart(p, phases.length - 1);
  const last = phases.at(-1);
  const steps = PLAN.phaseSteps(last);
  const open = steps.filter((st) => !st.quiz && st.id.startsWith('basics/')).at(-1);
  for (const u of last.units) learnUnit(h, u, open.id);
  PROG.recordAttempt(p, open.id, { stage: 1, score: 1, at: WALL0 });
  const unit = PLAN.unitOf(phases, open.id);
  openPath(h.session, ['Learning Path', last.n + ' ' + last.name, unit.num + ' ' + unit.name]);
  h.run(400);
  const rows = h.session.nav.at(-1).node.children;
  const at = rows.findIndex((r) => r.step && r.step.id === open.id);
  if (at >= 0) {
    h.session.selectRow(at);
    h.session.activate(false);
  } else {
    /* An exercise of several steps: its folder, then the step. */
    const ex = rows.findIndex((r) => r.children && r.children.some((c) => c.step && c.step.id === open.id));
    h.session.selectRow(ex);
    h.session.activate(false);
    const inner = h.session.nav.at(-1).node.children;
    h.session.selectRow(inner.findIndex((c) => c.step && c.step.id === open.id));
    h.session.activate(false);
  }
  assert.equal(h.session.armedId, open.id);
  playThroughFromHere(h);
  h.run(700);
  h.session.activate(false);
  const kinds = sceneKinds(h);
  assert.deepEqual(kinds, ['celebrate+fireworks', 'banner STAGE COMPLETE', 'zoom-out', 'banner LEARNING PATH COMPLETE',
    'finale'], kinds.join(', '));
  assert.ok(h.said().includes('Learning Path complete.'));
  assert.equal(h.session.view, MENU);
  assert.ok(h.session.onMap(), 'the world map');
  assert.equal(h.session.nav.at(-1).node.label, 'Learning Path');
});

test('scenes draw nothing from the quiz\'s random stream: a quiz after a zoom asks what it would have', () => {
  const ask = (zoom) => {
    const h = fakeHost();
    h.session.init();
    openPath(h.session, ['Learning Path']);
    if (zoom) {
      h.session.activate(false);                 /* into the island, and back out */
      h.run(400);
      h.session.back();
      h.run(400);
    } else {
      h.run(800);
    }
    assert.ok(h.session.onMap());
    h.session.playButton();                      /* Continue: a quiz */
    assert.equal(h.session.view, GUESS_VIEW);
    return JSON.stringify(h.session.quiz.prompt);
  };
  assert.equal(ask(true), ask(false));
});

/* ---- Rings: Practice and Quiz as circles ------------------------------------ */

import { homePads } from '../src/home/render.mjs';

test('Practice is a ring of five with its icons; Quiz a ring of three on pads 70..72', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Practice']);
  assert.ok(h.session.onHome(), 'a ring, drawn as home is');
  let m = h.session.homeModel();
  assert.deepEqual(m.items.map((it) => [it.label, it.icon]), [['Scales', 'stairs'], ['Chords', 'chord'],
    ['Progressions', 'progression'], ['Random', 'dice'], ['Songs', 'song']]);
  assert.equal(h.session.listTitle(), 'Practice', 'the title bar names the ring');
  h.session.moveSelection(1);
  assert.equal(h.session.homeModel().selected, 1);
  assert.ok(growing(h.session.homeModel().grow, h.ms), 'the jog grows the next circle');
  h.session.back();
  h.session.back();
  assert.equal(h.session.nav.length, 1);
  assert.equal(h.session.homeModel().selected, 1, 'home, Practice selected');
  openPath(h.session, ['Quiz']);
  m = h.session.homeModel();
  assert.deepEqual(m.items.map((it) => [it.label, it.icon]), [['Ear', 'ear'], ['Reading', 'staff'], ['Keys', 'keyletter']]);
  assert.deepEqual(homePads(3), [70, 71, 72]);
  assert.equal(h.session.homePad(73), true, 'a pad off the ring: taken, and nothing');
  assert.equal(h.session.nav.at(-1).node.label, 'Quiz');
  h.session.homePad(71);
  assert.equal(h.session.nav.at(-1).node.label, 'Reading', 'pad 71: the middle circle');
  assert.ok(!h.log.some((e) => e[0] === 'strike'), 'nothing sounded');
  h.session.back();
  assert.equal(h.session.homeModel().selected, 1, 'the ring again, on Reading');
});

test('a ring\'s help says which ring it is, and Shift + Click shows it as a list', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Practice']);
  h.session.menuButton();
  assert.match(h.session.info.paragraphs[0].text, /^Practice: the free library, as circles/);
  h.session.back();
  openPath(h.session, ['Songs']);
  assert.equal(h.session.onHome(), false, 'deeper levels stay lists');
  h.session.back();
  h.session.back();
  openPath(h.session, ['Quiz']);
  h.session.menuButton();
  assert.match(h.session.info.paragraphs[0].text, /^Quiz: short rounds, as circles/);
  h.session.back();
  h.session.activate(true);
  h.session.pickSheet(h.session.sheet.items.findIndex((it) => it.label === 'Show as list'));
  assert.equal(h.session.onHome(), false, 'the list');
  assert.deepEqual(h.session.nav.at(-1).node.children.map((r) => r.label), ['Ear', 'Reading', 'Keys']);
  h.session.back();
  assert.ok(h.session.onHome(), 'Back: the circles again');
  assert.ok(h.said().includes('Quiz.'));
});

test('a ring of more than five is drawn as its list', () => {
  const h = fakeHost();
  h.session.init();
  openPath(h.session, ['Practice']);
  const node = h.session.nav.at(-1).node;
  const extra = node.children.slice();
  node.children.push({ label: 'Other', value: '>', children: [] });
  assert.equal(h.session.onHome(), false, 'six: a list');
  assert.equal(h.session.homeModel(), null);
  node.children.length = extra.length;
  assert.ok(h.session.onHome(), 'five again: a ring');
});
