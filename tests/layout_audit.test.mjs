/*
 * layout_audit.test.mjs — nothing on any screen may overlap anything else.
 *
 * This exists because five of the nine screens shipped with a collision on
 * them, and none of the 422 tests noticed. Each one was invisible to the sort
 * of test we had: a pixel assertion says "there is ink at (x,y)", and two
 * strings printed on top of each other produce ink in exactly the same place
 * as one string does.
 *
 * So this audits the DRAW CALLS rather than the pixels. The ctx is wrapped to
 * record every text() with its measured width, and every full-width 1px
 * fillRect as a rule; four invariants are then checked per screen. The screens
 * are driven with worst-case content — three-digit rates and streaks, the
 * longest drill label, the longest footer each view can produce — because the
 * defects all needed a long number to show themselves and every one of them
 * looked fine with the tidy values a hand-written fixture uses.
 *
 * The eight failures found on 2026-09-24 are each a case below. A screen added
 * later gets the same coverage by being added to SCREENS.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createScreen } from '../tools/screen_buffer.mjs';
import * as V from '../src/view.mjs';
import * as L from '../src/layout.mjs';
import { makeRecord } from '../src/stats.mjs';
import { scaleRun } from '../src/generator.mjs';
import { createRun } from '../src/scoring.mjs';

/*
 * A ctx that draws normally and keeps a transcript of what it was asked to.
 *
 * Erasure has to be modelled or the transcript lies: the ready view draws the
 * whole reading view and then blanks the bottom band before writing its own
 * hint there, so the progress counter underneath is intent that never reaches
 * the screen. A text fully covered by a LATER blanking rect is dropped.
 */
function probe() {
  const c = createScreen();
  const texts = [];
  const rules = [];
  const erases = [];
  const text = c.text.bind(c);
  const fillRect = c.fillRect.bind(c);
  let seq = 0;
  c.text = (x, y, s, v) => {
    if (s) texts.push({ x, y, w: c.textWidth(s), s, seq: seq++ });
    return text(x, y, s, v);
  };
  c.fillRect = (x, y, w, h, v) => {
    if (v && x <= 0 && w >= L.SCREEN_W && h === 1) rules.push(y);
    if (!v) erases.push({ x, y, w, h, seq });
    seq++;
    return fillRect(x, y, w, h, v);
  };
  c.transcript = () => ({
    texts: texts.filter((t) => !erases.some((e) => e.seq > t.seq
      && e.x <= t.x && e.x + e.w >= t.x + t.w
      && e.y <= t.y && e.y + e.h >= t.y + L.TEXT_H)),
    rules,
  });
  return c;
}

/* Every way one draw can spoil another, as one list of complaints. */
function collisions(c) {
  const { texts, rules } = c.transcript();
  const bad = [];
  for (const t of texts) {
    if (t.x < 0 || t.x + t.w > L.SCREEN_W) {
      bad.push(`off screen: ${JSON.stringify(t.s)} spans x=${t.x}..${t.x + t.w}`);
    }
    if (t.y < 0 || t.y + L.TEXT_H > L.SCREEN_H) {
      bad.push(`off screen: ${JSON.stringify(t.s)} at y=${t.y}`);
    }
    for (const r of rules) {
      if (r > t.y && r < t.y + L.TEXT_H) {
        bad.push(`rule at y=${r} cuts ${JSON.stringify(t.s)} at y=${t.y}`);
      }
    }
  }
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i];
      const b = texts[j];
      if (Math.abs(a.y - b.y) >= L.TEXT_H) continue;
      if (a.x + a.w <= b.x || b.x + b.w <= a.x) continue;
      bad.push(`${JSON.stringify(a.s)} @${a.x},${a.y} over ${JSON.stringify(b.s)} @${b.x},${b.y}`);
    }
  }
  return bad;
}

const chart = scaleRun({ rootPc: 0, direction: 'updown', bpm: 80 });

function records(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(makeRecord({
      drill: 'guess:chords:types', n: 20, ms: 9000 - i * 50, wrong: i % 5, hints: 0, at: i * 86400000,
    }));
  }
  return out;
}

/*
 * Worst case for each screen, not a typical one. Three digits everywhere a
 * number can reach three digits, and the longest string each view can select:
 * every collision found in the audit needed one of those to appear.
 */
const SCREENS = {
  'result, worst case': (c) => V.drawRoundResult(c, {
    rate: 144, ms: 480000, n: 30, wrong: 12, bestStreak: 100, hints: 2,
    best: 144, isBest: false, records: records(12),
  }),
  'result, personal best': (c) => V.drawRoundResult(c, {
    rate: 8, ms: 150000, n: 20, wrong: 0, bestStreak: 20, hints: 0,
    best: 8, isBest: true, records: records(1),
  }),
  'result, no history yet': (c) => V.drawRoundResult(c, {
    rate: 31, ms: 43900, n: 20, wrong: 3, bestStreak: 9, hints: 0,
    best: 0, isBest: true, records: [],
  }),
  'progress': (c) => V.drawProgress(c, {
    drill: 'guess:chords:types', records: records(40), drillIndex: 6, drillCount: 12,
  }),
  'progress, one drill': (c) => V.drawProgress(c, {
    drill: 'hear:notes:half', records: records(1), drillIndex: 0, drillCount: 1,
  }),
  'progress, nothing yet': (c) => V.drawProgress(c, {
    drill: null, records: [], drillIndex: 0, drillCount: 0,
  }),
  'pick, hint available': (c) => V.drawPick(c, {
    title: 'NAME CHORD', score: '19/20', index: 2, options: ['Cmaj7', 'Cm7', 'C7'],
    hint: 'which pad is lit?', footer: 'JOG pick  REC help',
  }),
  'pick, an option struck out': (c) => V.drawPick(c, {
    title: 'NAME NOTE', score: '19/20', index: 0, options: ['F#4', 'G4', 'E4'],
    eliminated: [2], footer: 'JOG pick  CLICK ok',
  }),
  'guess': (c) => V.drawGuessView(c, {
    prompt: [60, 64, 67], fifths: 0, title: 'CHORD', score: '19/20',
    footer: 'hint 2/2   streak 100',
  }),
  'guess, hidden with a hint': (c) => V.drawGuessView(c, {
    prompt: [60, 64, 67], fifths: 0, hidden: true, hint: 1, label: 'Cmaj7',
    title: 'HEAR', score: '19/20', footer: 'streak 100   REC help',
  }),
  'summary': (c) => V.drawSummary(c, chart, createRun(chart)),
  'exercise list': (c) => V.drawList(c, 'EXERCISE', [
    { label: 'Guess: chords all types', value: 'q' },
    { label: 'Hear: chords all types', value: 'q' },
    { label: 'Name: chords all types', value: 'q' },
    { label: 'C major scale, two octaves', value: 'f' },
  ], 0, { footer: V.SETTINGS_HINT, centreFooter: true }),
  /* "Key = C# mixolydian" is the widest row this module can actually produce,
   * at 114px; the second fixture is past anything real, to prove the label is
   * fitted against the value rather than against a fixed budget. */
  'settings list': (c) => V.drawList(c, 'SETTINGS', [
    { label: 'Key', value: 'C# mixolydian' },
    { label: 'MIDI out', value: 'trk+USB' },
  ], 0, { footer: 'CLICK edit SHIFT back' }),
  'settings list, editing': (c) => V.drawList(c, 'SETTINGS', [
    { label: 'Key', value: 'C# mixolydian' },
  ], 0, { footer: 'turn change  CLICK ok', editing: true }),
  'settings list, an implausibly long value': (c) => V.drawList(c, 'SETTINGS', [
    { label: 'Read ahead', value: '48 pixels per beat' },
  ], 0, { footer: 'turn change  CLICK ok', editing: true }),
  'ready': (c) => V.drawReadyView(c, {
    chart, run: createRun(chart), songBeats: 0, pxPerBeat: 48, outLabel: 'trk+USB 16',
  }),
  'reading': (c) => V.drawReadingView(c, {
    chart, run: createRun(chart), songBeats: 2.5, pxPerBeat: 24,
  }),
};

for (const [name, draw] of Object.entries(SCREENS)) {
  test(`nothing overlaps on: ${name}`, () => {
    const c = probe();
    draw(c);
    const bad = collisions(c);
    assert.deepEqual(bad, [], `${name}\n  ` + bad.join('\n  '));
  });
}

/* ---- The specific faults, so a regression names itself ------------------- */

test('the name-lane rule is drawn only by the views that have a name lane', () => {
  const laned = ['reading', 'guess', 'ready'];
  for (const [name, draw] of Object.entries(SCREENS)) {
    const c = probe();
    draw(c);
    const has = c.transcript().rules.indexOf(L.NAME_RULE_Y) >= 0;
    const wants = laned.some((k) => name.startsWith(k));
    assert.equal(has, wants, `${name}: lane rule ${has ? 'drawn' : 'missing'}`);
  }
});

test('the ready view puts one label in the header, not two', () => {
  const c = probe();
  SCREENS.ready(c);
  const header = c.transcript().texts.filter((t) => t.y < L.HEADER_H);
  /* Left title and one right label. Two right-aligned labels is the bug: the
   * MIDI-out text used to be printed over the top of bar.beat. */
  assert.equal(header.length, 2);
  assert.equal(header.filter((t) => t.x + t.w > L.SCREEN_W - 4).length, 1);
});

test('every footer this module can show fits across the screen', () => {
  const c = createScreen();
  const footers = [
    'PLAY again  BACK list', 'PLAY again  JOG pick', 'JOG pick  REC help',
    'JOG pick  CLICK ok', 'CLICK edit SHIFT back', 'turn change  CLICK ok',
    V.SETTINGS_HINT, 'jog: another drill', 'jog: drill 12/12', 'play a round',
    'hint 2/2   streak 100', 'streak 100   REC help',
  ];
  for (const f of footers) {
    assert.ok(c.textWidth(f) <= L.TEXT_MAX_PX, `${JSON.stringify(f)} is ${c.textWidth(f)}px`);
  }
});
