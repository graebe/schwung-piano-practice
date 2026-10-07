import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CIRCLE, SHELLS, CHORD_FAMILIES, LESSON_NAMES, PROGRESSIONS,
  rightHandTones, spellingFor, closeVoicings, chooseVoicing, chordSong,
  qualityLesson, inversionLesson, slashLesson, progressionLesson,
  RANDOM_POOLS, randomChordSong,
} from '../src/chord_lessons.mjs';
import { qualityById, ALL_QUALITIES } from '../src/chords.mjs';
import { pitchRange, DEFAULT_TRANSPOSE } from '../src/padmap.mjs';
import { availableLevels, projectLevel, LEVELS } from '../src/levels.mjs';
import { validateExercise } from '../src/exercise_io.mjs';

const PADS = pitchRange(DEFAULT_TRANSPOSE);
const pc = (p) => ((p % 12) + 12) % 12;

/* Every lesson Basics › Chords offers, built at the default transpose. */
function allChordLessons() {
  const out = [];
  for (const fam of CHORD_FAMILIES) {
    if (fam.slash) out.push(slashLesson());
    else if (fam.inversions) for (const q of fam.inversions) out.push(inversionLesson(q));
    else for (const q of fam.qualities) out.push(qualityLesson(q));
  }
  return out;
}
const randomSets = () => {
  const out = [];
  for (let seed = 1; seed <= 30; seed++) {
    for (const pool of Object.values(RANDOM_POOLS)) out.push(randomChordSong({ seed, pool }));
  }
  return out;
};
const allProgressions = () => {
  const out = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const p of PROGRESSIONS) out.push(progressionLesson(p, tonic));
  }
  return out;
};

/* Left and right hand of each beat, paired up. */
function chords(song) {
  const byBeat = new Map();
  for (const e of song.events) {
    const slot = byBeat.get(e.beat) || {};
    slot[e.hand] = e;
    byBeat.set(e.beat, slot);
  }
  return [...byBeat.values()];
}

test('the cycle visits every root once', () => {
  assert.deepEqual(CIRCLE.slice().sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test('every quality a lesson names exists, and every lesson has a name', () => {
  for (const fam of CHORD_FAMILIES) {
    for (const q of (fam.qualities || []).concat(fam.inversions || [])) {
      assert.ok(qualityById(q), `${fam.name}: ${q}`);
      assert.ok(LESSON_NAMES[q], `${q} has no name`);
    }
  }
  for (const p of PROGRESSIONS) for (const [, q] of p.steps) assert.ok(qualityById(q), `${p.id}: ${q}`);
});

test('every quality in chords.mjs is taught somewhere', () => {
  const taught = new Set();
  for (const fam of CHORD_FAMILIES) for (const q of fam.qualities || []) taught.add(q);
  for (const q of ALL_QUALITIES) assert.ok(taught.has(q.id), `${q.id} has no lesson`);
});

test('a shell is part of its chord, and only the six-note chords need one', () => {
  for (const id of Object.keys(SHELLS)) {
    const q = qualityById(id);
    assert.equal(q.intervals.length, 6, id);
    const full = q.intervals.map(pc);
    for (const i of SHELLS[id]) assert.ok(full.indexOf(pc(i)) >= 0, `${id}: ${i}`);
  }
});

test('up to four notes the right hand keeps the root, from five it drops it', () => {
  assert.deepEqual(rightHandTones(qualityById('maj7')), [0, 4, 7, 11]);
  assert.deepEqual(rightHandTones(qualityById('9')), [4, 7, 10, 2]);
  assert.deepEqual(rightHandTones(qualityById('13')), [4, 9, 10, 2]);
});

test('chords are spelled in the key they belong to', () => {
  assert.equal(spellingFor(0, qualityById('maj')), 0);
  assert.equal(spellingFor(0, qualityById('min')), -3, 'Cm reads in Eb');
  assert.equal(spellingFor(0, qualityById('7')), -1, 'C7 reads in F');
  assert.equal(spellingFor(11, qualityById('dim')), 0, 'Bdim reads in C');
  assert.equal(spellingFor(4, qualityById('maj')), 4, 'E reads in E');
});

test('close voicings stay inside the window, and an inversion fixes the bass', () => {
  const vs = closeVoicings([0, 4, 7], 60, 72);
  assert.ok(vs.length > 0);
  for (const v of vs) assert.ok(v[0] >= 60 && v[v.length - 1] <= 72);
  for (const v of closeVoicings([0, 4, 7], 57, 79, 4)) assert.equal(pc(v[0]), 4);
});

test('the nearest voicing wins, and the first is centred on home', () => {
  const vs = closeVoicings([5, 9, 0], 57, 79);
  assert.deepEqual(chooseVoicing(vs, [60, 64, 67], 0), [60, 65, 69], 'C to F moves by step');
  const first = chooseVoicing(closeVoicings([0, 4, 7], 57, 79), null, 66);
  assert.ok(Math.abs((first[0] + first[2]) / 2 - 66) <= 4);
});

test('an unknown quality is an error, not a silent gap', () => {
  assert.throws(() => chordSong({ id: 'x', name: 'x', steps: [{ root: 0, quality: 'nope' }] }), /unknown/);
});

/* ---- What every lesson must be true of ------------------------------------ */

test('every chord lesson and progression is a valid song inside the pads', () => {
  for (const song of allChordLessons().concat(allProgressions(), randomSets())) {
    const { ok, errors } = validateExercise(song);
    assert.ok(ok, `${song.id}: ${errors.join('; ')}`);
    for (const e of song.events) {
      for (const p of e.pitches) {
        assert.ok(p >= PADS.lo && p <= PADS.hi, `${song.id} beat ${e.beat}: ${p} is off the pads`);
      }
    }
  }
});

test('the left hand is always below the right', () => {
  for (const song of allChordLessons().concat(allProgressions(), randomSets())) {
    for (const { l, r } of chords(song)) {
      if (!l) continue;
      assert.ok(l.pitches[0] < r.pitches[0], `${song.id} beat ${l.beat}`);
    }
  }
});

test('both hands together play the chord and nothing else', () => {
  for (const song of allChordLessons()) {
    if (song.id === 'slash-chords') continue;
    const q = qualityById(song.id.replace(/^(chord|inversions)-/, ''));
    const allowed = q.intervals.map(pc);
    for (const { l, r } of chords(song)) {
      const root = pc(l ? l.pitches[0] : r.pitches.reduce((a, b) => Math.min(a, b)));
      const notes = (l ? l.pitches : []).concat(r.pitches);
      /* An inversion's lowest note is not its root, so measure from the symbol's
       * root, which every chord in a cycle is named by. */
      const named = song.id.startsWith('inversions-') ? null : root;
      if (named == null) continue;
      for (const p of notes) {
        assert.ok(allowed.indexOf(pc(p - named)) >= 0, `${song.id}: ${p} is not in ${r.symbol}`);
      }
      /* What is never left out: the third (or the sus that replaces it) and,
       * from the sevenths on, the seventh — they are what make it this chord. */
      const has = (i) => notes.some((p) => pc(p - named) === i);
      if (q.intervals.length >= 4) {
        const seventh = q.intervals.find((i) => [9, 10, 11].indexOf(pc(i)) >= 0 && i < 12);
        if (seventh != null) assert.ok(has(pc(seventh)), `${song.id} ${r.symbol} lost its seventh`);
      }
    }
  }
});

test('the right hand moves by voice leading, not leaps', () => {
  for (const song of allChordLessons().concat(allProgressions())) {
    if (song.id.startsWith('inversions-')) continue;
    const rh = song.events.filter((e) => e.hand === 'r');
    for (let i = 1; i < rh.length; i++) {
      const a = rh[i - 1].pitches;
      const b = rh[i].pitches;
      for (const p of b) {
        const step = Math.min(...a.map((q) => Math.abs(p - q)));
        assert.ok(step <= 7, `${song.id} chord ${i}: a voice jumps ${step}`);
      }
    }
  }
});

test('every chord is named, and the slash chords name their bass', () => {
  const slash = slashLesson().events.filter((e) => e.hand === 'r').map((e) => e.symbol);
  assert.deepEqual(slash, ['C/E', 'C/G', 'D/F#', 'G/B', 'Am/G', 'F/C', 'Bb/C', 'D/C']);
  const sevenths = qualityLesson('maj7').events.filter((e) => e.hand === 'r').map((e) => e.symbol);
  assert.deepEqual(sevenths.slice(0, 4), ['Cmaj7', 'Fmaj7', 'Bbmaj7', 'Ebmaj7']);
  const inv = inversionLesson('maj').events.slice(0, 3).map((e) => e.symbol);
  assert.deepEqual(inv, ['C', 'C/E', 'C/G']);
});

test('each chord of a cycle is spelled in its own key', () => {
  const song = qualityLesson('maj');
  assert.ok(song.keyChanges.length > 1);
  const at = (beat) => song.keyChanges.filter((k) => k.beat <= beat).pop().keySig;
  assert.equal(at(0), 0, 'C');
  assert.equal(at(4), -2, 'Bb');
  assert.equal(at(2 * CIRCLE.indexOf(4)), 4, 'E, with its G#');
});

test('a progression is in one key: no key changes', () => {
  const song = progressionLesson(PROGRESSIONS[0], 7);
  assert.equal(song.keySig, 1);
  assert.equal(song.keyChanges, undefined);
  assert.equal(song.name, 'G I-IV-V-I');
});

test('a progression name too long for the header drops its key', () => {
  const minor = PROGRESSIONS.find((p) => p.id === 'ii-V-i minor');
  assert.equal(progressionLesson(minor, 9).name, 'ii-V-i minor');
});

test('chord lessons get the whole ladder, inversions only the right hand', () => {
  assert.deepEqual(availableLevels(qualityLesson('m7')).map((l) => l.id), ['1r', '1l', '2r', '3']);
  assert.deepEqual(availableLevels(inversionLesson('maj')).map((l) => l.id), ['1r', '2r']);
});

test('the symbol rides with the chord to every level that plays it whole', () => {
  const song = qualityLesson('13');
  for (const lv of LEVELS) {
    const chart = projectLevel(song, lv.id);
    const named = chart.events.filter((e) => e.symbol).length;
    if (lv.reduce === 'none') assert.equal(named, 12, lv.id);
    else assert.equal(named, 0, `${lv.id} plays one note, so it names no chord`);
    assert.deepEqual(chart.keyChanges, song.keyChanges, `${lv.id} keeps the spelling`);
  }
  assert.equal(projectLevel(song, '3').events[0].symbol, 'C13');
});

test('a lesson follows the transpose', () => {
  const up = pitchRange(DEFAULT_TRANSPOSE + 5);
  for (const e of qualityLesson('maj9', DEFAULT_TRANSPOSE + 5).events) {
    for (const p of e.pitches) assert.ok(p >= up.lo && p <= up.hi);
  }
});

test('random chords draw from the whole vocabulary, and never repeat back to back', () => {
  assert.equal(RANDOM_POOLS.all.length, ALL_QUALITIES.length, 'every quality can come up');
  const seen = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const rh = randomChordSong({ seed }).events.filter((e) => e.hand === 'r');
    assert.equal(rh.length, 16);
    for (let i = 1; i < rh.length; i++) assert.notEqual(rh[i].symbol, rh[i - 1].symbol, `seed ${seed}`);
    for (const e of rh) seen.add(e.symbol.replace(/^[A-G][#b]?/, '').split('/')[0]);
  }
  assert.ok(seen.size >= 30, `only ${seen.size} qualities came up in sixty sets`);
  assert.deepEqual(randomChordSong({ seed: 9 }).events, randomChordSong({ seed: 9 }).events);
});
