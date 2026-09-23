import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import {
  validateExercise, normalizeExercise, parseExercise, parseManifest,
  playabilityWarnings, MIN_PITCH, MAX_PITCH,
} from '../src/exercise_io.mjs';
import { MIN_PITCH as STAFF_LO, MAX_PITCH as STAFF_HI } from '../src/notation.mjs';
import { pitchRange, DEFAULT_TRANSPOSE } from '../src/padmap.mjs';

const good = {
  id: 'x', name: 'Test', bpm: 90, timeSig: [4, 4], keySig: 0,
  events: [
    { beat: 0, durBeats: 1, pitches: [60] },
    { beat: 1, durBeats: 1, pitches: [64, 67] },
  ],
};

const bad = (patch) => validateExercise({ ...good, ...patch });

test('a well-formed exercise validates', () => {
  assert.ok(validateExercise(good).ok);
});

test('non-objects are rejected without throwing', () => {
  for (const v of [null, undefined, 3, 'x', []]) {
    assert.equal(validateExercise(v).ok, false);
  }
});

test('name and tempo are required and bounded', () => {
  assert.equal(bad({ name: '' }).ok, false);
  assert.equal(bad({ name: 7 }).ok, false);
  assert.equal(bad({ bpm: 0 }).ok, false);
  assert.equal(bad({ bpm: 400 }).ok, false);
  assert.equal(bad({ bpm: '90' }).ok, false);
});

test('a broken time signature is caught', () => {
  assert.equal(bad({ timeSig: [4] }).ok, false);
  assert.equal(bad({ timeSig: [0, 4] }).ok, false);
  assert.equal(bad({ timeSig: [4, 5] }).ok, false);
  assert.ok(bad({ timeSig: [6, 8] }).ok);
  assert.ok(bad({ timeSig: null }).ok, 'timeSig is optional');
});

test('the key signature stays inside the circle of fifths', () => {
  assert.equal(bad({ keySig: 8 }).ok, false);
  assert.equal(bad({ keySig: -8 }).ok, false);
  assert.ok(bad({ keySig: 7 }).ok);
});

test('events must exist and run forwards', () => {
  assert.equal(bad({ events: [] }).ok, false);
  assert.equal(bad({ events: 'no' }).ok, false);
  const back = bad({ events: [{ beat: 2, pitches: [60] }, { beat: 1, pitches: [60] }] });
  assert.equal(back.ok, false);
  assert.match(back.errors.join(' '), /backwards/);
  assert.equal(bad({ events: [{ beat: -1, pitches: [60] }] }).ok, false);
});

test('pitches must be whole numbers a piano can play', () => {
  assert.equal(bad({ events: [{ beat: 0, pitches: [] }] }).ok, false);
  assert.equal(bad({ events: [{ beat: 0, pitches: [MIN_PITCH - 1] }] }).ok, false);
  assert.equal(bad({ events: [{ beat: 0, pitches: [MAX_PITCH + 1] }] }).ok, false);
  assert.equal(bad({ events: [{ beat: 0, pitches: [60.5] }] }).ok, false);
  assert.equal(bad({ events: [{ beat: 0, pitches: ['60'] }] }).ok, false);
  assert.ok(bad({ events: [{ beat: 0, pitches: [MIN_PITCH, MAX_PITCH] }] }).ok);
});

test('a non-positive duration is rejected', () => {
  assert.equal(bad({ events: [{ beat: 0, durBeats: 0, pitches: [60] }] }).ok, false);
  assert.equal(bad({ events: [{ beat: 0, durBeats: -1, pitches: [60] }] }).ok, false);
});

test('every problem is reported, not just the first', () => {
  const r = validateExercise({ name: '', bpm: 5, events: [{ beat: 0, pitches: [999] }] });
  assert.ok(r.errors.length >= 3, r.errors.join('; '));
});

test('normalize fills defaults and sorts notes low to high', () => {
  const c = normalizeExercise({ name: 'N', bpm: 80, events: [{ beat: 0, pitches: [67, 60, 64] }] }, 'fallback');
  assert.equal(c.id, 'fallback');
  assert.deepEqual(c.timeSig, [4, 4]);
  assert.equal(c.keySig, 0);
  assert.equal(c.events[0].durBeats, 1);
  assert.deepEqual(c.events[0].pitches, [60, 64, 67]);
  assert.equal(c.source, 'file');
});

test('parseExercise never throws on rubbish', () => {
  for (const text of ['', '{', 'null', '[]', '{"name":"x"}']) {
    const r = parseExercise(text, 'id');
    assert.equal(r.chart, null);
    assert.ok(r.errors.length > 0);
  }
});

test('parseExercise round-trips a good file', () => {
  const r = parseExercise(JSON.stringify(good), 'id');
  assert.equal(r.errors.length, 0);
  assert.equal(r.chart.name, 'Test');
  assert.equal(r.chart.events.length, 2);
});

test('the manifest tolerates both shapes and skips junk rows', () => {
  assert.deepEqual(parseManifest('nope'), []);
  assert.deepEqual(parseManifest('{}'), []);
  const rows = parseManifest(JSON.stringify({
    exercises: [{ file: 'a.json' }, { nope: 1 }, { id: 'b', name: 'B', file: 'b.json' }],
  }));
  assert.deepEqual(rows, [
    { id: 'a', name: 'a.json', file: 'a.json' },
    { id: 'b', name: 'B', file: 'b.json' },
  ]);
  assert.equal(parseManifest(JSON.stringify([{ file: 'c.json' }])).length, 1);
});

test('every bundled exercise loads, and the manifest matches the folder', () => {
  const dir = new URL('../src/exercises/', import.meta.url);
  const manifest = parseManifest(readFileSync(new URL('index.json', dir), 'utf8'));
  assert.ok(manifest.length >= 3);

  const onDisk = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
  assert.deepEqual(manifest.map((r) => r.file).sort(), onDisk, 'manifest and folder disagree');

  for (const row of manifest) {
    const { chart, errors } = parseExercise(readFileSync(new URL(row.file, dir), 'utf8'), row.id);
    assert.equal(errors.length, 0, `${row.file}: ${errors.join('; ')}`);
    assert.equal(chart.id, row.id);
    assert.ok(chart.events.length > 0);
  }
});

/* ---- Playability --------------------------------------------------------- */

const STAFF = { lo: STAFF_LO, hi: STAFF_HI };
const PADS = pitchRange(DEFAULT_TRANSPOSE);

test('a note off the staff is reported — it would scroll past invisibly', () => {
  const chart = { events: [{ beat: 0, pitches: [STAFF_LO - 1] }] };
  const w = playabilityWarnings(chart, STAFF, PADS);
  assert.ok(w.length > 0);
  assert.match(w.join(' '), /outside the staff/);
});

test('a note no pad can reach is reported separately', () => {
  const chart = { events: [{ beat: 0, pitches: [PADS.hi + 1] }] };
  const w = playabilityWarnings(chart, STAFF, PADS);
  assert.match(w.join(' '), /pad reach/);
});

test('each offending pitch is named once, however often it recurs', () => {
  const bad = STAFF_LO - 2;
  const chart = { events: [{ beat: 0, pitches: [bad] }, { beat: 1, pitches: [bad] }, { beat: 2, pitches: [bad] }] };
  const w = playabilityWarnings(chart, STAFF, PADS).filter((m) => m.includes('staff'));
  assert.equal(w.length, 1);
});

test('a playable exercise warns about nothing', () => {
  const chart = { events: [{ beat: 0, pitches: [60, 64, 67] }, { beat: 1, pitches: [72] }] };
  assert.deepEqual(playabilityWarnings(chart, STAFF, PADS), []);
});

test('every bundled exercise is drawable and reachable, not merely well-formed', () => {
  const dir = new URL('../src/exercises/', import.meta.url);
  const manifest = parseManifest(readFileSync(new URL('index.json', dir), 'utf8'));
  for (const row of manifest) {
    const { chart } = parseExercise(readFileSync(new URL(row.file, dir), 'utf8'), row.id);
    assert.ok(chart, `${row.file} failed to parse`);
    assert.deepEqual(
      playabilityWarnings(chart, STAFF, PADS), [],
      `${row.file} ships notes the Move cannot show or play`,
    );
  }
});
