// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * trainer.mjs: what a setup holds, its page's rows, the ids a round is filed
 * under, and the spec that runs it — for every circle, answer and level.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CIRCLES, MAX_CHOICES, coerceSetup, setupRows, applySetup, customRows, toggleCustom, itemSet,
  customHash, trainerId, parseTrainerId, trainerLabel, trainerSpec, choicesFor, qualityDistance,
  allItems, subjectOf, startBlock, scaleChart, scaleDistance, progChart,
} from '../src/trainer.mjs';
import { CHORD_LEVELS, playable, qualityById } from '../src/chords.mjs';
import { createQuiz, pressPitch, pickChoice, CORRECT, WRONG, EAR } from '../src/guess.mjs';
import { drillId, drillLabel } from '../src/stats.mjs';
import { MODES } from '../src/scales.mjs';

const fresh = (circle, over = {}) => ({ ...coerceSetup('chord', circle, null, { rootPc: 0, mode: 'major' }), ...over });

test('a fresh setup: the key and scale of the settings, level 1, diatonic roots', () => {
  const s = coerceSetup('chord', 'read', null, { rootPc: 9, mode: 'minor' });
  assert.deepEqual(s, {
    answer: 'play', level: 1, roots: 'diatonic', inversions: false, sound: 'block', round: 10,
    key: 9, scale: 'minor', custom: [],
  });
  assert.equal(coerceSetup('chord', 'read', null, { mode: 'chromatic' }).scale, 'major', 'chromatic is no key');
  assert.equal(coerceSetup('chord', 'play', { answer: 'name' }).answer, 'play', 'Play has no answer to choose');
});

test('a stored setup is made whole: unknown values are dropped, the rest kept', () => {
  const s = coerceSetup('chord', 'hear', {
    answer: 'name', level: 7, key: 'random', scale: 'dorian', roots: 'sideways', inversions: true,
    sound: 'broken', round: 0, custom: ['m7', 'nope', 'maj'], extra: 1,
  });
  assert.equal(s.answer, 'name');
  assert.equal(s.level, 7);
  assert.equal(s.key, 'random');
  assert.equal(s.scale, 'dorian');
  assert.equal(s.roots, 'diatonic');
  assert.equal(s.inversions, true);
  assert.equal(s.sound, 'broken');
  assert.equal(s.round, 0);
  assert.deepEqual(s.custom, ['maj', 'm7'], 'in ladder order, the unknown dropped');
  assert.equal(s.extra, undefined);
  /* Naming needs two answers: level 1 is moved up. */
  assert.equal(coerceSetup('chord', 'read', { answer: 'name', level: 1 }).level, 2);
});

test('the rows of each circle, Start last; Custom adds its row', () => {
  const fields = (rows) => rows.map((r) => r.field || r.act);
  assert.deepEqual(fields(setupRows('chord', 'read', fresh('read'))),
    ['answer', 'level', 'key', 'scale', 'roots', 'inversions', 'round', 'start']);
  assert.deepEqual(fields(setupRows('chord', 'hear', fresh('hear'))),
    ['answer', 'level', 'key', 'scale', 'roots', 'inversions', 'sound', 'round', 'start']);
  assert.deepEqual(fields(setupRows('chord', 'play', fresh('play'))),
    ['level', 'key', 'scale', 'roots', 'inversions', 'round', 'start']);
  const custom = setupRows('chord', 'read', fresh('read', { level: 'custom', custom: ['maj', 'min'] }));
  assert.deepEqual(fields(custom).slice(0, 3), ['answer', 'level', 'custom']);
  assert.equal(custom[2].value, '2 >');
  const values = setupRows('chord', 'read', fresh('read', { level: 5, key: 'random', round: 0 }))
    .map((r) => r.value);
  assert.deepEqual(values, ['play', '5 + 7 maj7 m7', 'random', 'Major', 'diatonic', 'off', 'endless', '>']);
});

test('every value of every row fits beside its label', () => {
  /* The 6px font: 21 characters a row, label and value a space apart at least. */
  for (const circle of CIRCLES) {
    for (const level of [1, 2, 3, 4, 5, 6, 7, 8, 'custom']) {
      for (const key of [0, 6, 'random']) {
        for (const scale of Object.keys(MODES)) {
          const s = fresh(circle, { level, key, scale: scale === 'chromatic' ? 'major' : scale, roots: 'chromatic' });
          for (const r of setupRows('chord', circle, s)) {
            /* Scale is the Settings row's twin: "Maj Pentatonic" in brackets
             * shortens the label there too (drawList fits it by measure). */
            if (r.field === 'scale') continue;
            assert.ok(r.label.length + 1 + r.value.length + 2 <= 21, `${r.label} [${r.value}]`);
          }
        }
      }
    }
  }
});

test('the jog walks a row\'s values and stops at the ends', () => {
  const s = fresh('read');
  assert.equal(applySetup('chord', s, 'level', -1), false, 'already at the first');
  assert.equal(applySetup('chord', s, 'level', 1), true);
  assert.equal(s.level, 2);
  for (let i = 0; i < 20; i++) applySetup('chord', s, 'level', 1);
  assert.equal(s.level, 'custom');
  assert.equal(applySetup('chord', s, 'key', -1), false, 'C is the first key');
  assert.equal(applySetup('chord', s, 'key', 1), true);
  assert.equal(s.key, 1);
});

test('choosing name moves a one-answer level up to two', () => {
  const s = fresh('read');
  applySetup('chord', s, 'answer', 1);
  assert.equal(s.answer, 'name');
  assert.equal(s.level, 2);
  assert.equal(applySetup('chord', s, 'nope', 1), false);
  assert.equal(applySetup('chord', s, 'level', 0), false);
});

test('Custom: every item, ticked in ladder order', () => {
  const s = fresh('read', { level: 'custom' });
  assert.equal(customRows('chord', s).length, allItems('chord').length);
  toggleCustom('chord', s, 'm7');
  toggleCustom('chord', s, 'maj');
  assert.deepEqual(s.custom, ['maj', 'm7']);
  assert.deepEqual(itemSet('chord', s), ['maj', 'm7']);
  toggleCustom('chord', s, 'maj');
  assert.deepEqual(s.custom, ['m7']);
  assert.equal(customRows('chord', s).find((r) => r.item === 'm7').value, 'on');
});

test('ids: subject, circle, answer, level; a Custom pick by its hash', () => {
  assert.equal(trainerId('chord', 'read', fresh('read', { answer: 'name', level: 3 })), 'chord:read:name:L3');
  assert.equal(trainerId('chord', 'play', fresh('play', { level: 8 })), 'chord:play:play:L8');
  const a = fresh('hear', { level: 'custom', custom: ['maj', 'm7'] });
  const b = fresh('hear', { level: 'custom', custom: ['m7', 'maj'] });
  assert.equal(trainerId('chord', 'hear', a), trainerId('chord', 'hear', b));
  assert.match(trainerId('chord', 'hear', a), /^chord:hear:play:C-[0-9a-z]{6}$/);
  assert.notEqual(customHash(['maj']), customHash(['min']));
  assert.deepEqual(parseTrainerId('quiz:chord:read:name:L3'), { subject: 'chord', circle: 'read', answer: 'name', level: 3 });
  assert.equal(parseTrainerId('chord:read:name:L9'), null);
  assert.equal(parseTrainerId('chord:sing:name:L1'), null);
  assert.equal(parseTrainerId('planet:read:name:L1'), null);
  assert.equal(parseTrainerId('ear:id-3rds:up'), null);
  assert.equal(parseTrainerId('chord:read:name:X1'), null);
  assert.equal(parseTrainerId('chord:hear:play:C-abc123').hash, 'abc123');
  /* Labels fit a progress row; stats knows the ids. */
  assert.equal(trainerLabel('chord:read:name:L3'), 'Chord read name L3');
  assert.equal(trainerLabel('chord:play:play:L8'), 'Chord play L8');
  assert.equal(drillLabel('chord:hear:play:C-abc123'), 'Chord hear play Cust');
  assert.equal(trainerLabel('nope'), null);
});

test('naming offers at most eight: the right one and its nearest, in the level\'s order', () => {
  const set = [].concat(...CHORD_LEVELS);
  for (const right of set) {
    const keep = choicesFor(set, right, qualityDistance);
    assert.ok(keep.length === MAX_CHOICES && keep.indexOf(right) >= 0, right);
    assert.deepEqual(keep, set.filter((id) => keep.indexOf(id) >= 0), 'in ladder order');
  }
  assert.deepEqual(choicesFor(['maj', 'min'], 'maj', qualityDistance), ['maj', 'min']);
  assert.ok(choicesFor(set, 'm7', qualityDistance).indexOf('7') >= 0, 'a near miss is offered');
  assert.equal(qualityDistance('maj', 'maj'), 0);
  assert.equal(qualityDistance('maj', 'min'), 2);
});

/* Every circle, answer and level runs on the engines, with a pool that is
 * playable and asks only the level's chords. */
test('trainerSpec: every circle x answer x level is a round', () => {
  for (const circle of CIRCLES) {
    for (const answer of circle === 'play' ? ['play'] : ['play', 'name']) {
      for (let level = answer === 'name' ? 2 : 1; level <= CHORD_LEVELS.length; level++) {
        for (const roots of ['diatonic', 'key', 'chromatic']) {
          const setup = fresh(circle, { answer, level, roots, inversions: level % 2 === 0 });
          const spec = trainerSpec('chord', circle, setup, { seed: 7 });
          const set = itemSet('chord', setup);
          assert.equal(spec.trainer.id, trainerId('chord', circle, setup));
          assert.equal(drillId(spec), spec.trainer.id);
          const quiz = createQuiz({ ...spec, exercise: spec.exercise, seed: 3, itemTable: null });
          const where = `${circle}/${answer}/L${level}/${roots}`;
          assert.ok(quiz.pool.length > 0, where);
          for (const e of quiz.pool) {
            const q = e.qualityId || e.answer;
            assert.ok(set.indexOf(q) >= 0, `${where}: ${q}`);
            assert.ok(playable(e.pitches), `${where}: ${e.pitches}`);
          }
          assert.equal(quiz.subject, 'chord');
          assert.equal(quiz.mode, circle);
          if (answer === 'name') {
            assert.equal(quiz.kind, EAR);
            assert.ok(quiz.choices.length >= 2 && quiz.choices.length <= MAX_CHOICES, where);
            assert.ok(quiz.choices.some((c) => c.key === quiz.entry.answer), where);
            if (circle === 'read') assert.ok(quiz.entry.staff[0].notes.length >= 2, where);
          }
        }
      }
    }
  }
});

test('Key random draws the root once a round; the scale keeps its type', () => {
  const roots = new Set();
  for (let seed = 1; seed < 40; seed++) {
    const spec = trainerSpec('chord', 'play', fresh('play', { key: 'random', scale: 'minor' }), { seed });
    assert.equal(spec.gen.mode, 'minor');
    roots.add(spec.gen.rootPc);
  }
  assert.ok(roots.size >= 8, `${roots.size} keys drawn`);
  /* Diatonic roots in A minor: only the chords of the key. */
  const spec = trainerSpec('chord', 'play', fresh('play', { key: 9, scale: 'minor', level: 3 }), {});
  const names = new Set(spec.pool.map((e) => e.label));
  assert.deepEqual([...names].sort(), ['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G']);
});

test('judged as the circle says: staff exactly, by ear and by name any voicing', () => {
  const run = (circle, answer) => createQuiz({ ...trainerSpec('chord', circle, fresh(circle, { answer }), {}), seed: 5 });
  const staff = run('read', 'play');
  const inv = staff.prompt.slice(1).concat([staff.prompt[0] + 12]);
  for (const p of inv) pressPitch(staff, p);
  assert.notEqual(staff.correct, 1, 'an inversion is not what was written');
  for (const circle of ['hear', 'play']) {
    const q = run(circle, 'play');
    const res = q.prompt.slice(1).concat([q.prompt[0] + 12]).map((p) => pressPitch(q, p));
    assert.equal(res[res.length - 1], CORRECT, circle + ': any inversion counts');
  }
  const named = run('hear', 'name');
  named.choiceIndex = named.choices.findIndex((c) => c.key !== named.entry.answer);
  assert.equal(pickChoice(named), WRONG);
  named.choiceIndex = named.choices.findIndex((c) => c.key === named.entry.answer);
  assert.equal(pickChoice(named), CORRECT);
});

test('every quality the trainer names has a two-character mark of its own', () => {
  const marks = allItems('chord').map((id) => qualityById(id).short);
  for (const m of marks) assert.ok(m && m.length <= 2, m);
  assert.equal(new Set(marks).size, marks.length);
  assert.equal(subjectOf('nope'), null);
});

test('a new Custom pick starts as the level it was chosen from; Start needs enough', () => {
  const s = fresh('read', { level: 3 });
  for (let i = 0; i < 6; i++) applySetup('chord', s, 'level', 1);
  assert.equal(s.level, 'custom');
  assert.deepEqual(s.custom, [].concat(...CHORD_LEVELS), 'from level 8: all of it');
  const t = fresh('hear', { level: 4 });
  t.level = 8;
  t.custom = ['maj'];
  applySetup('chord', t, 'level', 1);
  assert.deepEqual(t.custom, ['maj'], 'a pick already made is kept');
  const u = fresh('read', { level: 'custom', custom: [] });
  assert.equal(startBlock('chord', 'read', u), 'tick 1 chord');
  assert.equal(setupRows('chord', 'read', u).at(-1).disabled, true);
  u.answer = 'name';
  u.custom = ['maj'];
  assert.equal(startBlock('chord', 'read', u), 'tick 2 chords');
  assert.equal(startBlock('chord', 'play', { ...u, answer: 'play' }), null, 'Play plays: one is enough');
  u.custom = ['maj', 'min'];
  assert.equal(startBlock('chord', 'read', u), null);
  assert.equal(setupRows('chord', 'read', u).at(-1).value, '>');
});

/* ---- Scales ---------------------------------------------------------------- */

test('the scale trainer: its rows, each value fitting, Pattern only for a played chart', () => {
  const rows = (circle, over) => setupRows('scale', circle, { ...coerceSetup('scale', circle, null, { rootPc: 2 }), ...over })
    .map((r) => r.field || r.act);
  assert.deepEqual(rows('read', {}), ['answer', 'level', 'key', 'direction', 'pattern', 'start']);
  assert.deepEqual(rows('read', { answer: 'name', level: 2 }), ['answer', 'level', 'key', 'direction', 'round', 'start']);
  assert.deepEqual(rows('hear', {}), ['answer', 'level', 'key', 'direction', 'round', 'start']);
  assert.deepEqual(rows('play', {}), ['level', 'key', 'direction', 'round', 'start']);
  for (let level = 1; level <= 10; level++) {
    for (const r of setupRows('scale', 'read', { ...coerceSetup('scale', 'read', null), level, pattern: 'straight', key: 'random' })) {
      assert.ok(r.label.length + 1 + r.value.length + 2 <= 21, `${r.label} [${r.value}]`);
    }
  }
  assert.equal(coerceSetup('scale', 'read', null).scale, undefined, 'a scale has no Scale row');
});

test('scaleChart: one scale, its pattern and direction, playable and spelled', () => {
  const s = { pattern: 'straight', direction: 'up' };
  const up = scaleChart('dorian', 2, s);
  assert.deepEqual(up.events.map((e) => e.pitches[0] % 12), [2, 4, 5, 7, 9, 11, 0, 2]);
  assert.equal(up.name, 'D Dorian');
  const both = scaleChart('major', 0, { pattern: 'straight', direction: 'both' });
  assert.equal(both.events.length, 15);
  const thirds = scaleChart('major', 0, { pattern: '3rds', direction: 'up' });
  const p = thirds.events.map((e) => e.pitches[0]);
  assert.deepEqual(p.slice(0, 4).map((x) => x - p[0]), [0, 4, 2, 5], 'C E, D F...');
  /* A course scale Move does not have: Lydian dominant is still a chart. */
  const ld = scaleChart('lydianDominant', 7, { pattern: '5ths', direction: 'down' });
  assert.ok(ld.events.length > 8);
  for (const c of [up, both, thirds, ld]) for (const e of c.events) assert.ok(playable(e.pitches), c.name);
});

test('scaleSpec: every circle x answer x level runs, asks only its scales', () => {
  for (const circle of CIRCLES) {
    for (const answer of circle === 'play' ? ['play'] : ['play', 'name']) {
      for (let level = 1; level <= 10; level++) {
        for (const direction of ['up', 'down', 'both']) {
          const setup = { ...coerceSetup('scale', circle, null, { rootPc: 0 }), answer, level, direction, key: 'random' };
          const spec = trainerSpec('scale', circle, setup, { seed: level });
          const set = itemSet('scale', setup);
          const where = `${circle}/${answer}/L${level}/${direction}`;
          if (spec.chart) {
            assert.ok(set.indexOf(spec.item) >= 0, where);
            continue;
          }
          const quiz = createQuiz({ ...spec, seed: 2 });
          assert.ok(quiz.pool.length > 0, where);
          assert.equal(quiz.subject, 'scale', where);
          assert.equal(quiz.mode, circle, where);
          for (const e of quiz.pool) assert.ok(set.indexOf(e.item || e.answer) >= 0, where);
          if (answer === 'name') assert.ok(quiz.choices.length >= 2 && quiz.choices.length <= MAX_CHOICES, where);
          else assert.equal(quiz.entry.line.length, direction === 'both' ? quiz.entry.staff.length : quiz.entry.line.length);
        }
      }
    }
  }
});

test('a scale played from its name: note by note, any octave, a wrong note starts it again', () => {
  const setup = { ...coerceSetup('scale', 'play', null, { rootPc: 0 }), level: 2 };
  const quiz = createQuiz({ ...trainerSpec('scale', 'play', setup, { seed: 4 }), seed: 4 });
  const line = quiz.entry.line;
  pressPitch(quiz, line[0] + 12);
  pressPitch(quiz, line[1] - 12);
  assert.equal(quiz.played.length, 2);
  assert.equal(pressPitch(quiz, line[2] + 1), WRONG);
  assert.equal(quiz.played.length, 0, 'from the top');
  let res;
  for (const p of line) res = pressPitch(quiz, p);
  assert.equal(res, CORRECT);
  assert.equal(quiz.correct, 1);
  assert.deepEqual(Object.keys(quiz.items), [quiz.entry.item]);
  assert.deepEqual(quiz.items[quiz.entry.item].n, [1, 0], 'missed once: asked, not right');
});

test('the drawing leans on what was missed', () => {
  const setup = { ...coerceSetup('scale', 'read', null, { rootPc: 0 }), level: 2 };
  let dorian = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const spec = trainerSpec('scale', 'read', setup, { seed, history: { dorian: [10, 0] } });
    if (spec.item === 'dorian') dorian++;
  }
  assert.ok(dorian > 80, `dorian drawn ${dorian} of 200 (1 in 5 unweighted)`);
  assert.ok(scaleDistance('major', 'lydian') === 2 && scaleDistance('major', 'major') === 0);
});

/* ---- Progressions --------------------------------------------------------- */

test('the progression trainer: its rows, Key all 12, no Scale row', () => {
  const s = coerceSetup('prog', 'read', null, { rootPc: 0, mode: 'dorian' });
  assert.equal(s.scale, undefined);
  const fields = setupRows('prog', 'read', s).map((r) => r.field || r.act);
  assert.deepEqual(fields, ['answer', 'level', 'key', 'voicing', 'rhythm', 'start']);
  for (let i = 0; i < 13; i++) applySetup('prog', s, 'key', 1);
  assert.equal(s.key, 'all');
  assert.equal(setupRows('prog', 'read', s).find((r) => r.field === 'key').value, 'all 12');
  for (let level = 1; level <= 8; level++) {
    for (const r of setupRows('prog', 'hear', { ...coerceSetup('prog', 'hear', null), level, voicing: 'guide' })) {
      assert.ok(r.label.length + 1 + r.value.length + 2 <= 21, `${r.label} [${r.value}]`);
    }
  }
  assert.equal(coerceSetup('chord', 'read', { key: 'all' }).key, 0, 'all 12 is the progressions\' alone');
});

test('progSpec: every circle x answer x level runs, asks only its progressions', () => {
  for (const circle of CIRCLES) {
    for (const answer of circle === 'play' ? ['play'] : ['play', 'name']) {
      for (let level = 1; level <= 8; level++) {
        for (const key of [2, 'random', 'all']) {
          const setup = { ...coerceSetup('prog', circle, null), answer, level, key, voicing: 'smooth', rhythm: 'pop' };
          const spec = trainerSpec('prog', circle, setup, { seed: level });
          const set = itemSet('prog', setup);
          const where = `${circle}/${answer}/L${level}/${key}`;
          if (spec.chart) {
            assert.ok(set.indexOf(spec.item) >= 0, where);
            for (const e of spec.chart.events) assert.ok(playable(e.pitches), where);
            continue;
          }
          const quiz = createQuiz({ ...spec, seed: 2 });
          assert.ok(quiz.pool.length > 0, where);
          assert.equal(quiz.subject, 'prog');
          assert.equal(quiz.mode, circle);
          for (const e of quiz.pool) assert.ok(set.indexOf(e.item || e.answer) >= 0, where);
          if (answer === 'name') assert.ok(quiz.choices.length >= 2 && quiz.choices.length <= MAX_CHOICES, where);
          else assert.equal(quiz.entry.chords.length, quiz.entry.tokens.length, where);
        }
      }
    }
  }
});

test('Key all 12 walks round the circle: a key a prompt, a key a chart', () => {
  const setup = { ...coerceSetup('prog', 'play', null), level: 2, key: 'all' };
  const quiz = createQuiz({ ...trainerSpec('prog', 'play', setup, { seed: 5 }), seed: 5 });
  const roots = quiz.queue.map((e) => e.root);
  assert.deepEqual(roots, [0, 5, 10, 3, 8, 1]);
  assert.equal(new Set(quiz.pool.map((e) => e.item)).size, 1, 'the same progression');
  const read = { ...coerceSetup('prog', 'read', null), level: 2, key: 'all' };
  const first = trainerSpec('prog', 'read', read, { seed: 1 });
  assert.equal(first.root, 0);
  const second = trainerSpec('prog', 'read', read, { seed: 9, walk: first.walk });
  assert.deepEqual([second.item, second.root], [first.item, 5]);
  const last = trainerSpec('prog', 'read', read, { seed: 9, walk: { item: first.item, at: 11 } });
  assert.equal(last.root, 0, 'after the twelfth key, a new walk');
});

test('a progression played back: chord by chord by name, a wrong chord played again', () => {
  const setup = { ...coerceSetup('prog', 'hear', null), level: 2, key: 0 };
  const quiz = createQuiz({ ...trainerSpec('prog', 'hear', setup, { seed: 3 }), seed: 3 });
  const chords = quiz.entry.chords;
  /* The first chord, inverted: right by name. */
  const inv = chords[0].slice(1).concat([chords[0][0] + 12]);
  let res;
  for (const p of inv) res = pressPitch(quiz, p);
  assert.equal(quiz.chordAt, 1);
  assert.equal(pressPitch(quiz, chords[1][0] + 1), WRONG);
  assert.equal(quiz.chordAt, 1, 'the same chord again');
  for (let i = 1; i < chords.length; i++) for (const p of chords[i]) res = pressPitch(quiz, p);
  assert.equal(res, CORRECT);
  assert.deepEqual(quiz.items[quiz.entry.item].n, [1, 0], 'right only when the whole of it was');
  assert.ok(progChart('Pachelbel', 7, { voicing: 'bass', rhythm: 'waltz' }).timeSig[0] === 3);
});
