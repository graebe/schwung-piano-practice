import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SETTINGS_DEF, SETTINGS_COUNT, GRACE_VALUES, GRACE_LABELS,
  settingIndex, formatSetting, settingsRows, applySetting, coerceInto,
} from '../src/settings_def.mjs';
import { MODES } from '../src/generator.mjs';
import { PX_PER_BEAT_MIN, PX_PER_BEAT_MAX } from '../src/layout.mjs';

const fresh = () => ({
  bpm: 80, pxPerBeat: 24, rootPc: 0, transpose: 12, mode: 'major',
  guidance: false, anyOctave: false, halfTones: true, waitForNote: true, graceBeats: 1 / 3,
  click: true, reference: true, refVel: 70, midiOut: 4, midiCh: 0, countIn: 4,
});

test('every row has a key the settings object actually holds', () => {
  const s = fresh();
  for (const def of SETTINGS_DEF) {
    assert.ok(def.key in s, `no setting named ${def.key}`);
    assert.equal(typeof def.label, 'string');
    assert.ok(def.label.length > 0);
  }
  assert.equal(SETTINGS_COUNT, SETTINGS_DEF.length);
});

test('every row renders a non-empty value', () => {
  const rows = settingsRows(fresh());
  assert.equal(rows.length, SETTINGS_COUNT);
  for (const r of rows) assert.ok(r.value.length > 0, `${r.label} renders blank`);
});

test('settings are found by name, so indices stop being load-bearing', () => {
  assert.ok(settingIndex('bpm') >= 0);
  assert.ok(settingIndex('waitForNote') >= 0);
  assert.equal(settingIndex('nope'), -1);
  for (const def of SETTINGS_DEF) {
    assert.equal(SETTINGS_DEF[settingIndex(def.key)].key, def.key);
  }
});

test('integers clamp at their bounds', () => {
  const s = fresh();
  applySetting(s, settingIndex('bpm'), 1000);
  assert.equal(s.bpm, 200);
  applySetting(s, settingIndex('bpm'), -1000);
  assert.equal(s.bpm, 40);
  applySetting(s, settingIndex('pxPerBeat'), -100);
  assert.equal(s.pxPerBeat, PX_PER_BEAT_MIN);
  applySetting(s, settingIndex('pxPerBeat'), 100);
  assert.equal(s.pxPerBeat, PX_PER_BEAT_MAX);
  applySetting(s, settingIndex('midiCh'), -5);
  assert.equal(s.midiCh, 0, 'clamps to the broadcast value, not channel 1');
});

test('a batched encoder flick toggles a switch once, not once per tick', () => {
  const s = fresh();
  /* The host accumulates encoder ticks and delivers the total, so a fast turn
   * arrives as delta 7. A boolean must not flip seven times. */
  applySetting(s, settingIndex('waitForNote'), 7);
  assert.equal(s.waitForNote, false);
  applySetting(s, settingIndex('waitForNote'), -7);
  assert.equal(s.waitForNote, true);
});

test('the key wraps round the octave rather than clamping', () => {
  const s = fresh();
  s.rootPc = 11;
  applySetting(s, settingIndex('rootPc'), 1);
  assert.equal(s.rootPc, 0);
  applySetting(s, settingIndex('rootPc'), -1);
  assert.equal(s.rootPc, 11);
});

test('the grace walks its values and stops at the ends', () => {
  const s = fresh();
  const i = settingIndex('graceBeats');
  s.graceBeats = GRACE_VALUES[0];
  applySetting(s, i, -1);
  assert.equal(s.graceBeats, GRACE_VALUES[0], 'clamped at the short end');
  for (let n = 0; n < GRACE_VALUES.length + 3; n++) applySetting(s, i, 1);
  assert.equal(s.graceBeats, GRACE_VALUES[GRACE_VALUES.length - 1]);
  assert.equal(GRACE_VALUES.length, GRACE_LABELS.length);
});

test('the grace reads as a fraction of a beat, not a decimal', () => {
  const s = fresh();
  s.graceBeats = 1 / 3;
  assert.equal(formatSetting(s, settingIndex('graceBeats')), '1/3');
  s.graceBeats = 1 / 2;
  assert.equal(formatSetting(s, settingIndex('graceBeats')), '1/2');
});

test('the default grace is a third of a beat and wait is on', () => {
  const s = fresh();
  assert.equal(s.waitForNote, true, 'the user asked for standard: on');
  assert.ok(GRACE_VALUES.indexOf(s.graceBeats) >= 0);
  assert.equal(formatSetting(s, settingIndex('graceBeats')), '1/3');
});

test('the scale walks the modes the generator actually has', () => {
  const s = fresh();
  const i = settingIndex('mode');
  const names = Object.keys(MODES);
  for (let n = 0; n < names.length + 2; n++) applySetting(s, i, 1);
  assert.equal(s.mode, names[names.length - 1]);
  assert.ok(MODES[s.mode], 'walked off the end into a mode that does not exist');
});

test('only tempo, key, scale and octave claim a rebuild', () => {
  const s = fresh();
  const rebuilding = [];
  for (let i = 0; i < SETTINGS_COUNT; i++) {
    const probe = fresh();
    const r = applySetting(probe, i, 1);
    if (r.rebuild) rebuilding.push(SETTINGS_DEF[i].key);
  }
  assert.deepEqual(rebuilding.sort(), ['bpm', 'mode', 'rootPc', 'transpose'].sort());
});

test('a no-op edit reports no change, so nothing is saved or rebuilt', () => {
  const s = fresh();
  assert.equal(applySetting(s, settingIndex('bpm'), 0).changed, false);
  s.bpm = 200;
  assert.equal(applySetting(s, settingIndex('bpm'), 5).changed, false, 'already at the ceiling');
  assert.equal(applySetting(s, -1, 1).changed, false);
  assert.equal(applySetting(s, 999, 1).changed, false);
});

test('an edit reports which setting moved', () => {
  const s = fresh();
  assert.equal(applySetting(s, settingIndex('click'), 1).key, 'click');
  assert.equal(applySetting(s, settingIndex('countIn'), 1).key, 'countIn');
});

test('the MIDI destination is selectable and defaults to the built-in piano', () => {
  const s = fresh();
  const i = settingIndex('midiOut');
  assert.ok(i >= 0);
  assert.equal(formatSetting(s, i), 'piano', 'the module makes its own sound by default');
  s.midiOut = 1;
  assert.equal(formatSetting(s, i), 'track');
  s.midiOut = 2;
  assert.equal(formatSetting(s, i), 'USB');
});

test('the destination walks its values and clamps at both ends', () => {
  const s = fresh();
  const i = settingIndex('midiOut');
  applySetting(s, i, -1);
  assert.equal(s.midiOut, 4, 'piano is first, and stays put going left');
  for (let n = 0; n < 6; n++) applySetting(s, i, 1);
  assert.equal(s.midiOut, 3);
});

test('channel 0 reads as "all" — a mismatch is what makes a setup silent', () => {
  const s = fresh();
  const i = settingIndex('midiCh');
  assert.equal(s.midiCh, 0, 'broadcast by default');
  assert.equal(formatSetting(s, i), 'all');
  applySetting(s, i, 1);
  assert.equal(formatSetting(s, i), '1');
  applySetting(s, i, 99);
  assert.equal(s.midiCh, 16);
});

/* ---- Loading a stored file ------------------------------------------------- */
/*
 * The loader is driven from this table. It used to be written out a second time
 * by hand in ui.js, and keeping the two in step failed: the migrations ran in
 * the middle of that loader, so v3's "broadcast on every channel" was applied
 * and then overwritten by the stored channel a few lines further down. The
 * migration silently never happened for anyone who had a settings file.
 */

test('a stored value is taken when it is valid', () => {
  const s = fresh();
  coerceInto(s, { bpm: 120, guidance: true, mode: 'dorian', midiCh: 7 });
  assert.equal(s.bpm, 120);
  assert.equal(s.guidance, true);
  assert.equal(s.mode, 'dorian');
  assert.equal(s.midiCh, 7);
});

test('out-of-range numbers are clamped, not rejected outright', () => {
  const s = fresh();
  coerceInto(s, { bpm: 9999, countIn: -5, midiCh: 99 });
  assert.equal(s.bpm, 200);
  assert.equal(s.countIn, 0);
  assert.equal(s.midiCh, 16);
});

test('the key wraps rather than clamping, as it does when edited', () => {
  const s = fresh();
  coerceInto(s, { rootPc: 25 });
  assert.equal(s.rootPc, 1);
});

test('values of the wrong type, or off an enum, are ignored', () => {
  const s = fresh();
  const before = { ...s };
  coerceInto(s, {
    bpm: 'fast', guidance: 'yes', mode: 'klingon', graceBeats: 0.7, midiOut: 99, countIn: null,
  });
  assert.deepEqual(s, before, 'a corrupt file must not move anything');
});

test('unknown keys are ignored rather than adopted', () => {
  const s = fresh();
  coerceInto(s, { somethingElse: 1, version: 3 });
  assert.equal(s.somethingElse, undefined);
});

test('a missing or junk file leaves the defaults alone', () => {
  const s = fresh();
  const before = { ...s };
  for (const junk of [null, undefined, 42, 'x', []]) coerceInto(s, junk);
  assert.deepEqual(s, before);
});

test('every editable setting survives a round trip through a stored file', () => {
  const s = fresh();
  for (let i = 0; i < SETTINGS_COUNT; i++) applySetting(s, i, 1);
  const restored = coerceInto(fresh(), JSON.parse(JSON.stringify(s)));
  for (const def of SETTINGS_DEF) {
    assert.deepEqual(restored[def.key], s[def.key], def.key + ' did not survive the round trip');
  }
});

test('the reference volume is reachable — it was in the file but on no row', () => {
  const s = fresh();
  const i = settingIndex('refVel');
  assert.ok(i >= 0);
  applySetting(s, i, 10);
  assert.equal(s.refVel, 80);
  applySetting(s, i, 999);
  assert.equal(s.refVel, 127);
});
