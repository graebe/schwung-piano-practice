import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { LEVELS, levelById, projectLevel, availableLevels } from '../src/levels.mjs';
import { parseExercise, parseManifest } from '../src/exercise_io.mjs';

/* A bar of both hands: a held bass note, a plain melody note, and a right-hand
 * chord — one of each thing a projection has to deal with. */
const song = {
  id: 'song', name: 'Song', bpm: 72, timeSig: [4, 4], keySig: 0,
  events: [
    { beat: 0, durBeats: 4, hand: 'l', pitches: [60] },
    { beat: 0, durBeats: 1, hand: 'r', pitches: [67, 72, 76] },
    { beat: 1, durBeats: 1, hand: 'r', pitches: [74] },
    { beat: 2, durBeats: 2, hand: 'r', pitches: [71, 76] },
  ],
};

const pitchesOf = (chart) => chart.events.map((e) => e.pitches);

/* ---- The four projections ------------------------------------------------ */

test('level 1 right hand is the melody alone — the top of every chord', () => {
  assert.deepEqual(pitchesOf(projectLevel(song, '1r')), [[76], [74], [76]]);
});

test('level 1 left hand is the bass alone', () => {
  assert.deepEqual(pitchesOf(projectLevel(song, '1l')), [[60]]);
});

test('level 2 keeps the right hand as written', () => {
  assert.deepEqual(pitchesOf(projectLevel(song, '2r')), [[67, 72, 76], [74], [71, 76]]);
});

test('level 3 is both hands, and the two on beat 0 become ONE event', () => {
  const l3 = projectLevel(song, '3');
  assert.deepEqual(pitchesOf(l3), [[60, 67, 72, 76], [74], [71, 76]]);
  /* Two entries on one beat would be scored one after the other, so the bass
   * note would have to be played before the grid accepted the melody above it. */
  assert.equal(l3.events.length, 3);
});

test('a merged event takes the longer duration, so a held bass still rings', () => {
  assert.equal(projectLevel(song, '3').events[0].durBeats, 4);
});

test('an untagged event is a right hand, so every old melody file still reads', () => {
  const old = { ...song, events: [{ beat: 0, durBeats: 1, pitches: [72] }] };
  assert.deepEqual(pitchesOf(projectLevel(old, '1r')), [[72]]);
  assert.equal(projectLevel(old, '1l'), null);
});

test('a level with no material is null, not an empty chart', () => {
  assert.equal(projectLevel({ ...song, events: [] }, '3'), null);
  assert.equal(projectLevel(song, 'nope'), null);
});

test('the projection never transposes — no level invents a pitch', () => {
  const source = new Set(song.events.flatMap((e) => e.pitches));
  for (const lv of LEVELS) {
    for (const p of projectLevel(song, lv.id).events.flatMap((e) => e.pitches)) {
      assert.ok(source.has(p), `level ${lv.id} produced ${p}, which the song does not contain`);
    }
  }
});

test('a level carries the song forward and names itself', () => {
  const l3 = projectLevel(song, '3');
  assert.equal(l3.name, 'Song L3');
  assert.equal(l3.id, 'song:3');
  assert.equal(l3.bpm, 72);
  assert.deepEqual(l3.timeSig, [4, 4]);
  assert.equal(l3.source, 'file');
});

test('a hand is written in whichever order reads best; the chart comes out sorted', () => {
  const reversed = { ...song, events: [...song.events].reverse() };
  assert.deepEqual(projectLevel(reversed, '3').events, projectLevel(song, '3').events);
});

/* ---- The ladder ---------------------------------------------------------- */

test('a two-handed song has all four rungs, in order', () => {
  assert.deepEqual(availableLevels(song).map((l) => l.id), ['1r', '1l', '2r', '3']);
});

test('a single line of single notes has ONE rung, not four identical ones', () => {
  const scale = { ...song, events: [{ beat: 0, durBeats: 1, pitches: [60] }] };
  assert.deepEqual(availableLevels(scale).map((l) => l.id), ['1r']);
});

test('right-hand chords alone give two rungs: the top line, then the chords', () => {
  const triads = { ...song, events: [{ beat: 0, durBeats: 2, pitches: [60, 64, 67] }] };
  assert.deepEqual(availableLevels(triads).map((l) => l.id), ['1r', '2r']);
});

test('levelById finds each rung and refuses anything else', () => {
  for (const lv of LEVELS) assert.equal(levelById(lv.id), lv);
  assert.equal(levelById('L1'), null);
});

/* ---- What is actually bundled -------------------------------------------- */

const dir = new URL('../src/exercises/', import.meta.url);
const manifest = parseManifest(readFileSync(new URL('index.json', dir), 'utf8'));
const bundled = manifest.map((row) => ({
  row,
  chart: parseExercise(readFileSync(new URL(row.file, dir), 'utf8'), row.id).chart,
}));

test('at least ten songs carry a full four-rung ladder', () => {
  const full = bundled.filter(({ chart }) => availableLevels(chart).length === 4);
  assert.ok(full.length >= 10, `only ${full.length} songs have all four levels`);
});

test('every bundled song offers at least one rung', () => {
  for (const { row, chart } of bundled) {
    assert.ok(chart, `${row.file} failed to parse`);
    assert.ok(availableLevels(chart).length >= 1, `${row.file} has no playable level`);
  }
});

/*
 * The hands may meet but must never cross. On a grid 23 semitones wide the two
 * hands sit close enough that a crossed voice is a real risk, and on one staff
 * it reads as a mistake rather than as counterpoint.
 */
test('no bundled song puts the left hand above the right on the same beat', () => {
  for (const { row, chart } of bundled) {
    const at = {};
    for (const e of chart.events) {
      const slot = at[e.beat] || (at[e.beat] = { l: [], r: [] });
      slot[e.hand].push(...e.pitches);
    }
    for (const [beat, { l, r }] of Object.entries(at)) {
      if (!l.length || !r.length) continue;
      assert.ok(
        Math.max(...l) <= Math.min(...r),
        `${row.file} beat ${beat}: left hand ${Math.max(...l)} sits above right hand ${Math.min(...r)}`,
      );
    }
  }
});
