/*
 * Rendering tests. These draw into a real 128x64 byte buffer and assert on the
 * pixels, because the interesting failures in a 1-bit staff are geometric: a
 * ledger line one step out, a notehead that does not read as "fatter", a note
 * that scrolls into the clef instead of vanishing before it.
 *
 * `npm run preview` dumps the same frames as ASCII art when a failure here
 * needs looking at rather than reading.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createScreen, countOn, isOn, toAscii, W, H } from '../tools/screen_buffer.mjs';
import * as R from '../src/staff_render.mjs';
import * as V from '../src/view.mjs';
import * as L from '../src/layout.mjs';
import { pitchToY, spell } from '../src/notation.mjs';
import {
  createRun, judgeNoteOn, expireMissed, addMarker,
} from '../src/scoring.mjs';
import { scaleRun, triadDrill } from '../src/generator.mjs';
import { createQuiz, NOTES, CHORDS } from '../src/guess.mjs';
import { emptyStats, addRecord, makeRecord, forDrill } from '../src/stats.mjs';
import { countInRemaining } from '../src/controls.mjs';

const blank = () => {
  const c = createScreen();
  c.clear();
  return c;
};

/* Lit pixels in the row y, between x0 and x1 inclusive. */
const rowRun = (c, y, x0 = 0, x1 = W - 1) => {
  const xs = [];
  for (let x = x0; x <= x1; x++) if (isOn(c, x, y)) xs.push(x);
  return xs;
};

/* Start x of each unbroken run of at least `min` lit pixels in row y.
 * Used to pick noteheads out of a frame without matching 1px chrome such as
 * the hit line and bar lines. */
const runsAtLeast = (c, y, min, x0 = 0, x1 = W - 1) => {
  const starts = [];
  let run = 0;
  for (let x = x0; x <= x1 + 1; x++) {
    if (x <= x1 && isOn(c, x, y)) {
      run++;
    } else {
      if (run >= min) starts.push(x - run);
      run = 0;
    }
  }
  return starts;
};

/* Rows in [y0, y1) that are lit right across — an inverted selection band. */
const fullRows = (c, y0, y1) => {
  const ys = [];
  for (let y = y0; y < y1; y++) if (countOn(c, 0, y, W, 1) === W) ys.push(y);
  return ys;
};

/* ---- Staff -------------------------------------------------------------- */

test('the staff is five lines, evenly spaced, running to the right edge', () => {
  const c = blank();
  R.drawStaff(c);
  assert.equal(L.STAFF_LINE_YS.length, 5);
  for (const y of L.STAFF_LINE_YS) {
    const xs = rowRun(c, y);
    assert.equal(xs[0], L.STAFF_LEFT_X, `line ${y} starts at the clef`);
    assert.equal(xs[xs.length - 1], W - 1, `line ${y} reaches the edge`);
    assert.equal(xs.length, W - L.STAFF_LEFT_X, `line ${y} is unbroken`);
  }
  for (let i = 1; i < L.STAFF_LINE_YS.length; i++) {
    assert.equal(L.STAFF_LINE_YS[i] - L.STAFF_LINE_YS[i - 1], L.STAFF_LINE_GAP);
  }
});

test('the staff draws nothing between its lines', () => {
  const c = blank();
  R.drawStaff(c);
  for (let y = L.STAFF_TOP_Y; y <= L.STAFF_BOTTOM_Y; y++) {
    if (L.STAFF_LINE_YS.includes(y)) continue;
    assert.equal(countOn(c, 0, y, W, 1), 0, `row ${y} should be empty`);
  }
});

/* ---- Clef --------------------------------------------------------------- */

test('the clef fits its box and leaves the staff lines room', () => {
  const c = blank();
  R.drawClef(c);
  assert.ok(countOn(c, 0, 0, W, H) > 100, 'the clef actually draws something');
  assert.equal(countOn(c, L.STAFF_LEFT_X, 0, W - L.STAFF_LEFT_X, H), 0, 'nothing spills onto the staff');
  assert.equal(countOn(c, 0, 0, W, L.CLEF_Y), 0, 'nothing above its box');
  assert.equal(
    countOn(c, 0, L.CLEF_Y + R.CLEF_ROWS.length, W, H - L.CLEF_Y - R.CLEF_ROWS.length),
    0,
    'nothing below its box',
  );
});

test('the clef reads as a treble clef: it crosses every line and hangs past both', () => {
  const c = blank();
  R.drawClef(c);
  for (const y of L.STAFF_LINE_YS) {
    assert.ok(countOn(c, 0, y, L.STAFF_LEFT_X, 1) > 0, `no clef ink on line ${y}`);
  }
  assert.ok(countOn(c, 0, L.CLEF_Y, W, L.STAFF_TOP_Y - L.CLEF_Y) > 0, 'a hook above the staff');
  assert.ok(countOn(c, 0, L.STAFF_BOTTOM_Y + 1, W, 8) > 0, 'a tail below the staff');
  /* The spiral is the widest part and belongs on the G line, not the top. */
  const gLine = L.STAFF_LINE_YS[3];
  const spread = (y) => {
    const xs = rowRun(c, y, 0, L.STAFF_LEFT_X - 1);
    return xs.length ? xs[xs.length - 1] - xs[0] : 0;
  };
  assert.ok(spread(gLine) >= spread(L.STAFF_TOP_Y), 'the loop sits low, around G');
});

test('the clef bitmap is rectangular and converts to runs losslessly', () => {
  const widths = new Set(R.CLEF_ROWS.map((r) => r.length));
  assert.equal(widths.size, 1, 'every row is the same width');
  const rows = ['##.#', '....', '.###'];
  assert.deepEqual(R.rowsToRuns(rows), [[0, 0, 2], [3, 0, 1], [1, 2, 3]]);
  const ink = R.CLEF_ROWS.join('').split('#').length - 1;
  const runInk = R.rowsToRuns(R.CLEF_ROWS).reduce((n, r) => n + r[2], 0);
  assert.equal(runInk, ink);
});

/* ---- Noteheads ---------------------------------------------------------- */

test('a pending notehead is centred on its pitch', () => {
  const c = blank();
  const y = pitchToY(65); /* F4, in a space */
  R.drawNote(c, 64, y, 'pending', 0);
  assert.deepEqual(rowRun(c, y), [62, 63, 64, 65, 66], 'five wide, centred on x');
  assert.equal(countOn(c, 0, y - 1, W, 3), L.HEAD_W * L.HEAD_H, 'three rows tall');
  assert.equal(countOn(c, 0, y - 2, W, 1), 0, 'nothing a step above');
  assert.equal(countOn(c, 0, y + 2, W, 1), 0, 'nothing a step below');
});

test('a hit notehead is a hollow ring', () => {
  const y = pitchToY(65);
  const a = blank();
  R.drawNote(a, 64, y, 'pending', 0);
  const b = blank();
  R.drawNote(b, 64, y, 'hit', 0);

  assert.ok(!isOn(b, 64, y), 'the centre must be open — that is what "hollow" means');
  assert.ok(isOn(a, 64, y), 'a pending head is solid, so the two cannot be confused');
  const r = L.RING >> 1;
  for (const [dx, dy] of [[0, -r], [0, r], [-r, 0], [r, 0]]) {
    assert.ok(isOn(b, 64 + dx, y + dy), `rim missing at ${dx},${dy}`);
  }
  /* Rounded, not square: the corners of the bounding box stay clear. */
  for (const [dx, dy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
    assert.ok(!isOn(b, 64 + dx, y + dy), `corner at ${dx},${dy} should be open`);
  }
  /* Still centred, so it does not appear to jump when it changes state. */
  const centre = (c) => {
    const xs = rowRun(c, y);
    return (xs[0] + xs[xs.length - 1]) / 2;
  };
  assert.equal(centre(a), centre(b));
});

test('a missed notehead is an X, not a blob', () => {
  const c = blank();
  const y = pitchToY(65);
  R.drawNote(c, 64, y, 'missed', 0);
  const r = L.HEAD_MISS >> 1;
  for (const [dx, dy] of [[-r, -r], [r, r], [-r, r], [r, -r], [0, 0]]) {
    assert.ok(isOn(c, 64 + dx, y + dy), `arm pixel ${dx},${dy} missing`);
  }
  assert.ok(!isOn(c, 64, y - r), 'the top middle stays open');
  assert.ok(!isOn(c, 64 - r, y), 'the left middle stays open');
  const solid = blank();
  R.drawNote(solid, 64, y, 'hit', 0);
  assert.ok(countOn(c, 0, 0, W, H) < countOn(solid, 0, 0, W, H), 'an X is lighter than a block');
});

test('the three states are all visually distinct', () => {
  const y = pitchToY(65);
  const shot = (state) => {
    const c = blank();
    R.drawNote(c, 64, y, state, 0);
    return c.pixels.join('');
  };
  const [p, h, m] = ['pending', 'hit', 'missed'].map(shot);
  assert.notEqual(p, h);
  assert.notEqual(p, m);
  assert.notEqual(h, m);
});

/* ---- Ledger lines ------------------------------------------------------- */

test('ledger lines appear only where the note leaves the staff', () => {
  const cases = [
    [64, 0, 'E4 on the bottom line'],
    [62, 0, 'D4 in the space below'],
    [60, 1, 'middle C'],
    [57, 2, 'A3'],
    [79, 0, 'G5 in the space above'],
    [81, 1, 'A5'],
    [84, 2, 'C6'],
  ];
  for (const [pitch, expected, label] of cases) {
    const c = blank();
    R.drawLedgers(c, 64, pitchToY(pitch));
    const rows = [];
    for (let y = 0; y < H; y++) if (countOn(c, 0, y, W, 1) > 0) rows.push(y);
    assert.equal(rows.length, expected, `${label}: expected ${expected} ledgers, got ${rows.length}`);
    for (const y of rows) {
      assert.deepEqual(
        rowRun(c, y),
        [60, 61, 62, 63, 64, 65, 66, 67, 68],
        `${label}: ledger at ${y} should be ${L.LEDGER_W}px centred on the head`,
      );
    }
  }
});

test('a ledger line is wider than the notehead it carries', () => {
  const c = blank();
  const y = pitchToY(60);
  R.drawEntry(c, { x: 64, notes: [{ y, state: 'pending', alter: 0 }], label: '' });
  assert.ok(rowRun(c, y).length > L.HEAD_W, 'the ledger pokes out either side');
  assert.equal(rowRun(c, y).length, L.LEDGER_W);
});

/* ---- Accidentals -------------------------------------------------------- */

test('an accidental is drawn to the left of the head, on the same line', () => {
  const y = pitchToY(66, 1);
  const plain = blank();
  R.drawNote(plain, 64, y, 'pending', 0);
  const sharp = blank();
  R.drawNote(sharp, 64, y, 'pending', 1);
  assert.ok(countOn(sharp, 0, 0, W, H) > countOn(plain, 0, 0, W, H));
  const left = 64 + L.ACCIDENTAL_DX;
  assert.ok(countOn(sharp, left, y - 2, L.ACCIDENTAL_W, L.ACCIDENTAL_H) > 0, 'ink where the glyph goes');
  assert.equal(countOn(sharp, 0, 0, left, H), 0, 'nothing further left');
});

test('sharp and flat are different glyphs', () => {
  const y = pitchToY(65);
  const shot = (alter) => {
    const c = blank();
    R.drawAccidental(c, 50, y, alter);
    return c.pixels.join('');
  };
  assert.notEqual(shot(1), shot(-1));
  assert.equal(shot(0), blank().pixels.join(''), 'a natural draws nothing');
});

test('the accidental is dropped rather than drawn over the clef', () => {
  const y = pitchToY(66, 1);
  const near = blank();
  R.drawNote(near, L.ACCIDENTAL_MIN_X - 1, y, 'pending', 1);
  const headOnly = blank();
  R.drawNote(headOnly, L.ACCIDENTAL_MIN_X - 1, y, 'pending', 0);
  assert.equal(countOn(near, 0, 0, W, H), countOn(headOnly, 0, 0, W, H), 'clipped');

  const clear = blank();
  R.drawNote(clear, L.ACCIDENTAL_MIN_X, y, 'pending', 1);
  assert.ok(countOn(clear, 0, 0, W, H) > countOn(headOnly, 0, 0, W, H), 'drawn once there is room');
});

/* ---- Bar lines and the hit line ----------------------------------------- */

test('a bar line spans the staff and nothing else', () => {
  const c = blank();
  R.drawBarLine(c, 70);
  for (let y = 0; y < H; y++) {
    const expected = y >= L.STAFF_TOP_Y && y <= L.STAFF_BOTTOM_Y ? 1 : 0;
    assert.equal(countOn(c, 0, y, W, 1), expected, `row ${y}`);
  }
  assert.deepEqual(rowRun(c, L.STAFF_TOP_Y), [70]);
});

test('a bar line past the despawn edge is not drawn', () => {
  const c = blank();
  R.drawBarLine(c, L.DESPAWN_X - 1);
  assert.equal(countOn(c, 0, 0, W, H), 0);
  R.drawBarLine(c, W);
  assert.equal(countOn(c, 0, 0, W, H), 0);
});

test('the hit line marks the beat by thickening', () => {
  const thin = blank();
  R.drawHitLine(thin, false);
  const thick = blank();
  R.drawHitLine(thick, true);
  assert.deepEqual(rowRun(thin, L.HIT_LINE_TOP_Y), [L.HIT_X]);
  assert.deepEqual(rowRun(thick, L.HIT_LINE_TOP_Y), [L.HIT_X, L.HIT_X + 1]);
  assert.ok(countOn(thick, 0, 0, W, H) > countOn(thin, 0, 0, W, H));
});

/* ---- Name lane ---------------------------------------------------------- */

test('the name scrolls with the note, in its own lane', () => {
  const c = blank();
  R.drawLabel(c, 64, 'F#', 40);
  assert.equal(countOn(c, 0, 0, W, L.NAME_LANE_Y), 0, 'nothing above the lane');
  assert.ok(countOn(c, 0, L.NAME_LANE_Y, W, 7) > 0, 'ink in the lane');
  const xs = rowRun(c, L.NAME_LANE_Y + 2);
  assert.ok(xs[0] >= 60 && xs[0] <= 64, `label starts under the head, got ${xs[0]}`);
});

test('a crowded label is truncated instead of overprinting its neighbour', () => {
  const wide = blank();
  R.drawLabel(wide, 64, 'F# C E', 100);
  const tight = blank();
  R.drawLabel(tight, 64, 'F# C E', 12);
  assert.ok(countOn(tight, 0, 0, W, H) < countOn(wide, 0, 0, W, H));
  const xs = rowRun(tight, L.NAME_LANE_Y + 2);
  assert.ok(xs[xs.length - 1] - xs[0] <= 12, 'stays inside the gap it was given');
});

/* ---- Whole frames ------------------------------------------------------- */

const chart = scaleRun({ rootPc: 0, direction: 'updown', bpm: 80 });

test('the reading view draws a complete frame inside the screen', () => {
  const c = createScreen();
  V.drawReadingView(c, { chart, run: createRun(chart), songBeats: 2, pxPerBeat: 24 });
  const ink = countOn(c, 0, 0, W, H);
  assert.ok(ink > 300, `frame looks empty (${ink} px)`);
  assert.ok(ink < W * H * 0.6, 'frame is not a white-out');
  assert.ok(countOn(c, 0, 0, W, L.HEADER_H) > W, 'the header band is filled');
  assert.equal(countOn(c, 0, L.HEADER_RULE_Y, W, 1), W, 'the header rule spans the screen');
  assert.equal(countOn(c, 0, L.NAME_RULE_Y, W, 1), W, 'the name-lane rule spans the screen');
});

test('notes vanish before the clef — only the clef occupies that column', () => {
  const bare = blank();
  R.drawClef(bare);
  for (let beat = 0; beat < 6; beat += 0.1) {
    const c = createScreen();
    V.drawReadingView(c, { chart, run: createRun(chart), songBeats: beat, pxPerBeat: 24 });
    for (let y = L.STAFF_AREA_TOP_Y; y <= L.STAFF_AREA_BOTTOM_Y; y++) {
      for (let x = 0; x < L.STAFF_LEFT_X; x++) {
        if (isOn(c, x, y)) {
          assert.ok(isOn(bare, x, y), `note ink at ${x},${y} in the clef column at beat ${beat.toFixed(1)}`);
        }
      }
    }
  }
});

test('the chart scrolls right to left at exactly pxPerBeat per beat', () => {
  const headX = (songBeats) => {
    const c = createScreen();
    V.drawReadingView(c, { chart, run: createRun(chart), songBeats, pxPerBeat: 24 });
    /* Match the first 5-wide run — a notehead. The hit line and bar lines are
     * 1-2px, so they cannot be mistaken for one. */
    const y = pitchToY(64) - 1; /* one row above the line, so the staff is not in the way */
    const starts = runsAtLeast(c, y, L.HEAD_W, L.STAFF_LEFT_X, W - 1);
    return starts.length ? starts[0] : null;
  };
  const a = headX(0);
  const b = headX(1);
  assert.ok(a !== null && b !== null);
  assert.equal(a - b, 24, 'one beat of travel is one pxPerBeat');
  assert.ok(b < a, 'and it travels leftward');
});

/*
 * One note, on F4 — a staff SPACE, not a line — read one beat before it lands,
 * so neither the hit line at x=30 nor a staff line runs through the middle of
 * the glyph being examined. Probing a ring on a line tells you nothing: the
 * line fills the hole.
 */
const SOLO = { bpm: 80, timeSig: [4, 4], keySig: 0, events: [{ beat: 2, durBeats: 1, pitches: [65] }] };
const SOLO_Y = pitchToY(65, 0);      /* 34, a space */
const SOLO_X = L.HIT_X + 24;         /* where beat 2 sits at songBeats 1 */

test('playing the note opens the notehead into a ring', () => {
  const pendingRun = createRun(SOLO);
  const hitRun = createRun(SOLO);
  judgeNoteOn(hitRun, 65, 2);

  const before = createScreen();
  V.drawReadingView(before, { chart: SOLO, run: pendingRun, songBeats: 1, pxPerBeat: 24 });
  const after = createScreen();
  V.drawReadingView(after, { chart: SOLO, run: hitRun, songBeats: 1, pxPerBeat: 24 });

  assert.notEqual(before.pixels.join(''), after.pixels.join(''));
  assert.ok(isOn(before, SOLO_X, SOLO_Y), 'pending is filled at its centre');
  assert.ok(!isOn(after, SOLO_X, SOLO_Y), 'hit is open at its centre');
  assert.ok(isOn(after, SOLO_X - 2, SOLO_Y) && isOn(after, SOLO_X + 2, SOLO_Y), 'but the rim is there');
});

test('missing the note turns it into an X in the frame', () => {
  const missRun = createRun(chart);
  expireMissed(missRun, 2.5);
  const hitRun = createRun(chart);
  for (let i = 0; i < 3; i++) judgeNoteOn(hitRun, chart.events[i].pitches[0], chart.events[i].beat);

  const missed = createScreen();
  V.drawReadingView(missed, { chart, run: missRun, songBeats: 2.4, pxPerBeat: 24 });
  const hit = createScreen();
  V.drawReadingView(hit, { chart, run: hitRun, songBeats: 2.4, pxPerBeat: 24 });
  assert.notEqual(missed.pixels.join(''), hit.pixels.join(''));
  assert.ok(
    countOn(missed, L.DESPAWN_X, L.STAFF_TOP_Y, 20, 20) < countOn(hit, L.DESPAWN_X, L.STAFF_TOP_Y, 20, 20),
    'X glyphs carry less ink than fat heads',
  );
});

test('a chord stacks its noteheads on one x and names them all', () => {
  const triads = triadDrill({ rootPc: 0, degrees: [0] });
  const c = createScreen();
  V.drawReadingView(c, { chart: triads, run: createRun(triads), songBeats: 0, pxPerBeat: 24 });
  const ys = triads.events[0].pitches.map((p) => pitchToY(p, triads.keySig));
  for (const y of ys) {
    assert.ok(countOn(c, L.HIT_X - 3, y - 1, 7, 3) > 0, `no head at y ${y}`);
  }
  assert.ok(countOn(c, 0, L.NAME_LANE_Y, W, 7) > 12, 'the chord name is spelled out');
});

test('the progress bar tracks position through the piece', () => {
  const width = (songBeats) => {
    const c = createScreen();
    V.drawReadingView(c, { chart, run: createRun(chart), songBeats, pxPerBeat: 24 });
    return countOn(c, 1, L.FOOTER_Y + 1, W - 46, 1);
  };
  assert.ok(width(10) > width(2), 'the bar fills as the run goes on');
});

test('the ready view keeps the staff and adds a start prompt', () => {
  const reading = createScreen();
  V.drawReadingView(reading, { chart, run: createRun(chart), songBeats: 0, pxPerBeat: 24 });
  const ready = createScreen();
  V.drawReadyView(ready, { chart, run: createRun(chart), songBeats: 0, pxPerBeat: 24 });
  assert.notEqual(reading.pixels.join(''), ready.pixels.join(''));
  assert.equal(countOn(ready, 0, L.HEADER_RULE_Y, W, 1), W, 'the staff chrome is still there');
  assert.ok(countOn(ready, 30, 26, 68, 11) > 0, 'a prompt box in the middle');
});

test('the list highlights the selected row by inverting it', () => {
  const rows = [
    { label: 'Scale up/down', value: '' },
    { label: 'Thirds', value: '' },
    { label: 'Triads', value: 'f' },
  ];
  const c = createScreen();
  V.drawList(c, 'EXERCISE', rows, 1);
  const rowY = 11 + 9 - 1;
  assert.ok(countOn(c, 0, rowY, W, 9) > W * 4, 'the selected row is a filled band');
  assert.ok(countOn(c, 0, 10, W, 9) < W * 2, 'unselected rows are not');
});

test('the list scrolls to keep the cursor visible', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ label: 'Row ' + i, value: '' }));
  const first = createScreen();
  V.drawList(first, 'LIST', rows, 0);
  const last = createScreen();
  V.drawList(last, 'LIST', rows, 11);
  assert.notEqual(first.pixels.join(''), last.pixels.join(''));
  /* The selection band is a filled rectangle with the label knocked out of it
   * in black, so its top and bottom edges are the rows lit right across. */
  const firstBand = fullRows(first, 10, L.FOOTER_Y);
  const lastBand = fullRows(last, 10, L.FOOTER_Y);
  assert.ok(firstBand.length >= 2, 'a selection band is on screen at the top');
  assert.ok(lastBand.length >= 2, 'a selection band is on screen at the bottom');
  assert.notDeepEqual(firstBand, lastBand, 'the band moved, so the list scrolled');
  assert.ok(lastBand[0] > firstBand[0], 'the cursor rode down the page');
});

test('no frame writes outside the screen', () => {
  /* createScreen clips, so this checks the buffer is exactly 128x64 and the
   * views never rely on out-of-bounds writes to look right. */
  const c = createScreen();
  V.drawReadingView(c, { chart, run: createRun(chart), songBeats: 3, pxPerBeat: 48 });
  assert.equal(c.pixels.length, W * H);
  assert.ok(toAscii(c).split('\n').length === H + 2);
});

/* ---- Transport glyph and count-in --------------------------------------- */

test('the play glyph is a right-pointing triangle, not a block', () => {
  const c = blank();
  R.drawPlayGlyph(c, 10, 20, 9);
  /* Widest at the vertical centre, one pixel at top and bottom. */
  assert.equal(rowRun(c, 20).length, 1, 'top is a point');
  assert.equal(rowRun(c, 28).length, 1, 'bottom is a point');
  assert.equal(rowRun(c, 24).length, R.playGlyphWidth(9), 'middle is widest');
  /* Flat left edge: every lit row starts at the same x. */
  for (let y = 20; y <= 28; y++) assert.equal(rowRun(c, y)[0], 10, `row ${y}`);
  /* Strictly grows then strictly shrinks. */
  for (let y = 21; y <= 24; y++) {
    assert.ok(rowRun(c, y).length > rowRun(c, y - 1).length, `growing at ${y}`);
  }
  for (let y = 25; y <= 28; y++) {
    assert.ok(rowRun(c, y).length < rowRun(c, y - 1).length, `shrinking at ${y}`);
  }
});

test('the ready prompt shows the symbol as well as the word', () => {
  const c = createScreen();
  V.drawReadyView(c, { chart, run: createRun(chart), songBeats: 0, pxPerBeat: 24 });
  const b = V.READY_BOX;
  assert.ok(countOn(c, b.x, b.y, b.w, b.h) > 60, 'the box has content');
  /* The glyph sits in the left inset of the box, ahead of the text. */
  assert.ok(countOn(c, b.x + 4, b.y + 2, 14, 18) > 20, 'no symbol next to the label');
  /* The box is knocked out of the staff behind it, so the text stays readable:
   * the row just inside the top border carries no leftover staff line. */
  assert.equal(countOn(c, b.x + 1, b.y + 1, b.w - 2, 1), 0, 'a clear margin inside the border');
  assert.equal(countOn(c, b.x, b.y, b.w, 1), b.w, 'the top border is solid');
});

test('the ready prompt names both modes, with a symbol for each', () => {
  const c = createScreen();
  V.drawReadyView(c, { chart, run: createRun(chart), songBeats: 0, pxPerBeat: 24 });
  const b = V.READY_BOX;

  /* A triangle on the first line and a disc on the second, each in the glyph
   * column, so the two buttons are told apart before any word is read. */
  assert.ok(countOn(c, b.x + 4, b.y + 3, 10, 9) > 12, 'no play symbol');
  assert.ok(countOn(c, b.x + 4, b.y + 14, 10, 9) > 12, 'no record symbol');
  /* Both lines carry a label. */
  assert.ok(countOn(c, b.x + 16, b.y + 3, 80, 8) > 30, 'no label on the play line');
  assert.ok(countOn(c, b.x + 16, b.y + 14, 80, 8) > 30, 'no label on the record line');

  const blankLabels = createScreen();
  V.drawReadyView(blankLabels, {
    chart, run: createRun(chart), songBeats: 0, pxPerBeat: 24,
    playLabel: ' ', recLabel: ' ',
  });
  assert.ok(countOn(c, 0, 0, W, H) > countOn(blankLabels, 0, 0, W, H));
  /* The footer still carries the jog hint. */
  assert.ok(countOn(c, 0, L.FOOTER_Y - 2, W, 8) > 40, 'no footer hint');
});

test('a big digit is legible: much bigger than the body font, and correct', () => {
  const c = blank();
  R.drawBigDigit(c, 10, 10, 4, 4);
  assert.equal(countOn(c, 0, 0, W, H), countOn(c, 10, 10, R.bigDigitWidth(4), R.bigDigitHeight(4)));
  assert.equal(R.bigDigitHeight(4), 20);
  assert.ok(R.bigDigitHeight(4) > 14, 'taller than a line of type');
  /* Every digit draws something, and they are all distinct. */
  const shots = new Set();
  for (let d = 0; d <= 9; d++) {
    const s = blank();
    R.drawBigDigit(s, 10, 10, d, 3);
    assert.ok(countOn(s, 0, 0, W, H) > 0, `digit ${d} is blank`);
    shots.add(s.pixels.join(''));
  }
  assert.equal(shots.size, 10, 'two digits render identically');
});

test('the count-in shows a countdown, and it disappears when the piece starts', () => {
  const frame = (songBeats) => {
    const c = createScreen();
    V.drawReadingView(c, { chart, run: createRun(chart), songBeats, pxPerBeat: 24 });
    return c;
  };
  const scale = 4;
  const w = R.bigDigitWidth(scale) + 6;
  const x = ((W - R.bigDigitWidth(scale)) >> 1) - 3;
  const y = L.STAFF_TOP_Y + ((L.STAFF_BOTTOM_Y - L.STAFF_TOP_Y - R.bigDigitHeight(scale)) >> 1) - 2;
  const digitInk = (c) => countOn(c, x, y, w, R.bigDigitHeight(scale) + 4);

  const four = frame(-3.5);
  const one = frame(-0.4);
  const playing = frame(1.5);
  assert.ok(digitInk(four) > 40, 'no countdown during the count-in');
  assert.ok(digitInk(one) > 20);
  assert.ok(digitInk(playing) < digitInk(four), 'the countdown is gone once the piece runs');
  assert.notEqual(four.pixels.join(''), one.pixels.join(''), '4 and 1 look different');
});

test('the notes keep scrolling in behind the countdown', () => {
  const c = createScreen();
  V.drawReadingView(c, { chart, run: createRun(chart), songBeats: -3.5, pxPerBeat: 24 });
  /* The first note is still approaching on the right, outside the digit box. */
  const y = pitchToY(chart.events[0].pitches[0]) ;
  assert.ok(countOn(c, 90, y - 2, 38, 5) > 0, 'the first note should be visible, approaching');
  assert.equal(countOn(c, 0, L.HEADER_RULE_Y, W, 1), W, 'chrome is still drawn');
});

test('the countdown matches what controls.mjs says it should be', () => {
  for (const b of [-4, -3.2, -2.0, -1.1, -0.05]) {
    const n = countInRemaining(b);
    assert.ok(n >= 1 && n <= 4, `${b} -> ${n}`);
    const c = createScreen();
    V.drawReadingView(c, { chart, run: createRun(chart), songBeats: b, pxPerBeat: 24 });
    const bare = blank();
    R.drawBigDigit(bare, 0, 0, n, 4);
    assert.ok(countOn(bare, 0, 0, W, H) > 0);
  }
});

test('the settings list brackets the value it is editing', () => {
  const rows = [{ label: 'Guide pads', value: 'off' }, { label: 'Click', value: 'on' }];
  const idle = createScreen();
  V.drawList(idle, 'SETTINGS', rows, 0, {});
  const editing = createScreen();
  V.drawList(editing, 'SETTINGS', rows, 0, { editing: true });
  assert.notEqual(idle.pixels.join(''), editing.pixels.join(''));
  /* Only the selected row gains the brackets. */
  const rowY = 10;
  assert.notEqual(
    countOn(idle, 0, rowY, W, 9),
    countOn(editing, 0, rowY, W, 9),
    'the edited row should look different',
  );
  assert.equal(countOn(idle, 0, 19, W, 9), countOn(editing, 0, 19, W, 9), 'other rows unchanged');
});

/* ---- Discoverability hint ------------------------------------------------ */

test('the settings gesture is spelled out, and fits the screen', () => {
  const probe = createScreen();
  assert.ok(
    probe.textWidth(V.SETTINGS_HINT) <= W,
    `"${V.SETTINGS_HINT}" is ${probe.textWidth(V.SETTINGS_HINT)}px, wider than the screen`,
  );
  assert.match(V.SETTINGS_HINT, /shift/i);
  assert.match(V.SETTINGS_HINT, /settings/i);
});

test('the exercise list carries the hint, centred on the bottom line', () => {
  const c = createScreen();
  V.drawList(c, 'EXERCISE', [{ label: 'Scale', value: '' }], 0, {
    footer: V.SETTINGS_HINT,
    centreFooter: true,
  });
  /* Compare against the same string drawn alone at the same place: the footer
   * must be that text, not merely some ink. */
  const expected = blank();
  V.drawFooterHint(expected, V.SETTINGS_HINT);
  for (let y = L.FOOTER_Y - 2; y < H; y++) {
    for (let x = 0; x < W; x++) {
      assert.equal(isOn(c, x, y), isOn(expected, x, y), `footer differs at ${x},${y}`);
    }
  }
});

test('the ready screen carries it too — settings is unreachable by trying things', () => {
  const c = createScreen();
  V.drawReadyView(c, { chart, run: createRun(chart), songBeats: 0, pxPerBeat: 24 });
  const expected = blank();
  V.drawFooterHint(expected, V.SETTINGS_HINT);
  let matched = 0;
  for (let y = L.FOOTER_Y - 2; y < H; y++) {
    for (let x = 0; x < W; x++) {
      assert.equal(isOn(c, x, y), isOn(expected, x, y), `footer differs at ${x},${y}`);
      if (isOn(expected, x, y)) matched++;
    }
  }
  assert.ok(matched > 50, 'the hint should actually be there');
});

/* ---- Played markers ------------------------------------------------------ */

test('a played marker is the same glyph as a hit notehead, by design', () => {
  const y = pitchToY(65);
  const hit = blank();
  R.drawNote(hit, 64, y, 'hit', 0);
  const marker = blank();
  R.drawPlayedMarker(marker, 64, y);
  assert.equal(hit.pixels.join(''), marker.pixels.join(''));
});

test('a marker sits at the moment the key went down, not at the note', () => {
  const run = createRun(SOLO);
  judgeNoteOn(run, 65, 2);
  addMarker(run, 65, 2.33);           /* a third of a beat late */

  const c = createScreen();
  V.drawReadingView(c, { chart: SOLO, run, songBeats: 1, pxPerBeat: 24 });

  const markerX = Math.round(L.HIT_X + (2.33 - 1) * 24);
  assert.notEqual(markerX, SOLO_X, 'the two must not coincide for this test to mean anything');
  /* The notehead ring... */
  assert.ok(!isOn(c, SOLO_X, SOLO_Y) && isOn(c, SOLO_X - 2, SOLO_Y) && isOn(c, SOLO_X + 2, SOLO_Y));
  /* ...and a second ring where the key actually went down, later, to the right. */
  assert.ok(!isOn(c, markerX, SOLO_Y), 'marker centre should be open');
  assert.ok(isOn(c, markerX - 2, SOLO_Y) && isOn(c, markerX + 2, SOLO_Y), 'marker rim missing');
  assert.ok(markerX > SOLO_X, 'played late means the marker trails to the right');
});

test('on time, the marker lands on the note and reads as one mark', () => {
  const run = createRun(SOLO);
  judgeNoteOn(run, 65, 2);
  addMarker(run, 65, 2);

  const onTime = createScreen();
  V.drawReadingView(onTime, { chart: SOLO, run, songBeats: 1, pxPerBeat: 24 });

  const noMarker = createRun(SOLO);
  judgeNoteOn(noMarker, 65, 2);
  const hitOnly = createScreen();
  V.drawReadingView(hitOnly, { chart: SOLO, run: noMarker, songBeats: 1, pxPerBeat: 24 });

  /* Exactly coincident: the marker adds no ink at all, which is what "one
   * mark when you are in time" means. */
  assert.equal(onTime.pixels.join(''), hitOnly.pixels.join(''));
});

test('a wrong note still leaves a marker, at the pitch actually played', () => {
  const run = createRun(chart);
  addMarker(run, 71, 1.5);  /* B4, nothing in the chart at that moment */
  const c = createScreen();
  V.drawReadingView(c, { chart, run, songBeats: 1.5, pxPerBeat: 24 });
  const y = pitchToY(71, chart.keySig);
  assert.ok(countOn(c, L.HIT_X - 3, y - 3, 7, 7) > 0, 'no marker where the wrong note was played');
});

test('markers scroll away with the music and never draw over the clef', () => {
  const run = createRun(chart);
  addMarker(run, 64, 0);
  const bare = blank();
  R.drawClef(bare);
  for (let b = 0; b < 4; b += 0.25) {
    const c = createScreen();
    V.drawReadingView(c, { chart, run, songBeats: b, pxPerBeat: 24 });
    for (let y = L.STAFF_AREA_TOP_Y; y <= L.STAFF_AREA_BOTTOM_Y; y++) {
      for (let x = 0; x < L.STAFF_LEFT_X; x++) {
        if (isOn(c, x, y)) assert.ok(isOn(bare, x, y), `marker ink at ${x},${y} at beat ${b}`);
      }
    }
  }
});

test('a marker off the staff is skipped rather than drawn at the edge', () => {
  const run = createRun(chart);
  addMarker(run, 30, 1);   /* far below anything the staff can show */
  const withIt = createScreen();
  V.drawReadingView(withIt, { chart, run, songBeats: 1, pxPerBeat: 24 });
  const without = createScreen();
  V.drawReadingView(without, { chart, run: createRun(chart), songBeats: 1, pxPerBeat: 24 });
  assert.equal(withIt.pixels.join(''), without.pixels.join(''));
});

/* ---- The stuck-note callout ---------------------------------------------- */

test('big text renders every character of a note name, several times body height', () => {
  const c = blank();
  R.drawBigText(c, 4, 10, 'F#4', 3);
  assert.ok(R.bigDigitHeight(3) >= 15, 'must be unmistakably larger than a label');
  assert.ok(R.bigDigitHeight(3) > 7 * 2, 'more than double the body font');
  /* Each of the three characters puts ink in its own column band. */
  for (let i = 0; i < 3; i++) {
    const x = 4 + i * (R.DIGIT_W + R.BIG_GAP) * 3;
    assert.ok(countOn(c, x, 10, R.DIGIT_W * 3, R.bigDigitHeight(3)) > 0, `character ${i} missing`);
  }
  assert.equal(R.bigTextWidth('F#4', 3), 33);
});

test('every character a note name can contain has a glyph', () => {
  for (const ch of 'ABCDEFG#b0123456789') {
    const c = blank();
    R.drawBigDigit(c, 2, 2, ch, 3);
    assert.ok(countOn(c, 0, 0, W, H) > 0, `no glyph for "${ch}"`);
  }
});

test('the callout names the note only while the scroll is stuck', () => {
  const run = createRun(SOLO);
  expireMissed(run, 3, true);

  const stuckFrame = createScreen();
  V.drawReadingView(stuckFrame, { chart: SOLO, run, songBeats: 2.4, pxPerBeat: 24, blocked: true });
  const freeFrame = createScreen();
  V.drawReadingView(freeFrame, { chart: SOLO, run, songBeats: 2.4, pxPerBeat: 24, blocked: false });

  assert.notEqual(stuckFrame.pixels.join(''), freeFrame.pixels.join(''));

  /*
   * IT MUST NOT COVER THE STAFF. The label used to be a boxed block of big
   * text across the middle of it, which hid the very notes it was naming — so
   * the assertion is now the opposite of what it was: the staff area is
   * UNCHANGED by being stuck, and the difference is all below the rule.
   */
  const mid = L.STAFF_TOP_Y + 2;
  /* A few pixels, not a box: being stuck pins the blocking note so it is drawn
   * whatever the scroll filter decided, which is a notehead's worth. The old
   * assertion here was the opposite — that the callout DOMINATED this region
   * by 40 pixels or more — and that is exactly what was hiding the music. */
  const added = countOn(stuckFrame, 20, mid, 90, 14) - countOn(freeFrame, 20, mid, 90, 14);
  assert.ok(added < 40, `being stuck added ${added} pixels over the staff`);
  /* SOLO is one note, so the label is short — "F" against the lane's own
   * scrolling label. It roughly triples the lane's ink; the margin is set for
   * the shortest label there is rather than a comfortable chord. */
  const laneStuck = countOn(stuckFrame, 0, L.NAME_LANE_Y, W, L.TEXT_H);
  const laneFree = countOn(freeFrame, 0, L.NAME_LANE_Y, W, L.TEXT_H);
  assert.ok(laneStuck > laneFree + 20,
    `the label belongs in the name lane (${laneFree} -> ${laneStuck})`);
});

test('the callout says the note that is actually owed', () => {
  const run = createRun(SOLO);
  expireMissed(run, 3, true);
  const c = createScreen();
  V.drawReadingView(c, { chart: SOLO, run, songBeats: 2.4, pxPerBeat: 24, blocked: true });

  /* SOLO is a single F4. Draw the label alone and compare the lane. */
  const expected = blank();
  V.drawStuckLabel(expected, [65], 0);
  for (let y = L.NAME_RULE_Y + 1; y < L.FOOTER_Y - 2; y++) {
    for (let x = 0; x < W; x++) {
      assert.equal(isOn(c, x, y), isOn(expected, x, y), `lane differs at ${x},${y}`);
    }
  }
});

test('a stuck chord is named, not just spelled', () => {
  /* The report: "when I miss a chord, show the chord name (Em) not just the
   * notes". The staff shows the notes; the lane now says which chord they are. */
  const seen = [];
  const c = createScreen();
  const text = c.text.bind(c);
  c.text = (x, y, str, v) => { if (str) seen.push(str); return text(x, y, str, v); };
  V.drawStuckLabel(c, [64, 67, 71], 0);
  assert.deepEqual(seen, ['Em  E G B']);

  /* And a stack that is not a chord gets no invented symbol. */
  seen.length = 0;
  V.drawStuckLabel(c, [60, 61, 62], 0);
  assert.deepEqual(seen, ['C C# D']);
});

test('the count-in and the stuck callout never fight over the same frame', () => {
  const run = createRun(SOLO);
  const c = createScreen();
  /* Count-in is before the first note; a freeze is during. Even if both flags
   * were somehow set, the count-in wins and only one box is drawn. */
  V.drawReadingView(c, { chart: SOLO, run, songBeats: -2, pxPerBeat: 24, blocked: true });
  const countIn = createScreen();
  V.drawReadingView(countIn, { chart: SOLO, run, songBeats: -2, pxPerBeat: 24, blocked: false });
  assert.equal(c.pixels.join(''), countIn.pixels.join(''));
});

/* ---- Note guesser --------------------------------------------------------- */

test('the guess view is a flashcard: staff, clef, one note, its name', () => {
  const c = createScreen();
  V.drawGuessView(c, { prompt: [65], fifths: 0, score: '3/4', footer: 'streak 3' });

  for (const y of L.STAFF_LINE_YS) {
    assert.ok(countOn(c, L.STAFF_LEFT_X, y, 20, 1) > 0, `staff line ${y} missing`);
  }
  assert.ok(countOn(c, 0, L.CLEF_Y, L.STAFF_LEFT_X, 30) > 50, 'no clef');
  const y = pitchToY(65, 0);
  assert.ok(countOn(c, V.GUESS_X - 3, y - 2, 7, 5) > 0, 'no notehead');
  assert.ok(countOn(c, 0, L.NAME_LANE_Y, W, 8) > 10, 'the name must always be shown');
});

test('none of the scrolling furniture appears — there is no clock here', () => {
  const c = createScreen();
  V.drawGuessView(c, { prompt: [65], fifths: 0 });
  /* No hit line: nothing is arriving at a moment. The staff lines cross that
   * column, so compare against a bare staff rather than expecting zero. */
  const bare = blank();
  R.drawStaff(bare);
  const h = L.HIT_LINE_BOTTOM_Y - L.HIT_LINE_TOP_Y + 1;
  assert.equal(
    countOn(c, L.HIT_X, L.HIT_LINE_TOP_Y, 1, h),
    countOn(bare, L.HIT_X, L.HIT_LINE_TOP_Y, 1, h),
    'a hit line implies timing',
  );
  /* No progress bar. */
  assert.equal(countOn(c, 1, L.FOOTER_Y, L.SCREEN_W - 44, L.PROGRESS_H), 0);
  /* No bar line spanning the staff anywhere but under the note. */
  let spans = 0;
  for (let x = L.STAFF_LEFT_X; x < W; x++) {
    let full = true;
    for (let yy = L.STAFF_TOP_Y; yy <= L.STAFF_BOTTOM_Y; yy++) if (!isOn(c, x, yy)) full = false;
    if (full) spans++;
  }
  assert.equal(spans, 0, 'no bar lines');
});

test('accidentals and ledger lines work the same as in the reading view', () => {
  const sharp = createScreen();
  V.drawGuessView(sharp, { prompt: [66], fifths: 2 });
  const natural = createScreen();
  V.drawGuessView(natural, { prompt: [65], fifths: 0 });
  assert.ok(countOn(sharp, 0, 0, W, H) > countOn(natural, 0, 0, W, H), 'no accidental drawn');

  const ledger = createScreen();
  V.drawGuessView(ledger, { prompt: [60], fifths: 0 });
  assert.equal(
    countOn(ledger, V.GUESS_X - (L.LEDGER_W >> 1), pitchToY(60, 0), L.LEDGER_W, 1),
    L.LEDGER_W,
    'middle C needs its ledger line',
  );
});

test('a chord stacks at one x and names every note', () => {
  const quiz = createQuiz({ kind: CHORDS, seed: 2 });
  const c = createScreen();
  V.drawGuessView(c, { prompt: quiz.prompt, fifths: 0 });
  for (const pitch of quiz.prompt) {
    assert.ok(countOn(c, V.GUESS_X - 3, pitchToY(pitch, 0) - 2, 7, 5) > 0, `no head for ${pitch}`);
  }
  const single = createScreen();
  V.drawGuessView(single, { prompt: [quiz.prompt[0]], fifths: 0 });
  assert.ok(
    countOn(c, 0, L.NAME_LANE_Y, W, 8) > countOn(single, 0, L.NAME_LANE_Y, W, 8),
    'a chord name should be longer than a single note name',
  );
});

test('a correct answer inverts the name, so "yes" is visible without a pause', () => {
  const plain = createScreen();
  V.drawGuessView(plain, { prompt: [65], fifths: 0, solved: false });
  const solved = createScreen();
  V.drawGuessView(solved, { prompt: [65], fifths: 0, solved: true });
  assert.notEqual(plain.pixels.join(''), solved.pixels.join(''));
  assert.ok(
    countOn(solved, 0, L.NAME_LANE_Y - 1, W, 9) > countOn(plain, 0, L.NAME_LANE_Y - 1, W, 9),
    'the solved name should be a filled band',
  );
});

test('a prompt the staff cannot draw is skipped rather than drawn at the edge', () => {
  const offStaff = createScreen();
  V.drawGuessView(offStaff, { prompt: [30], fifths: 0 });
  const empty = createScreen();
  V.drawGuessView(empty, { prompt: [], fifths: 0 });
  /* Nothing but the staff itself: no notehead clamped to the edge of the area.
   * Bounded to the staff area — the name lane below is a separate question. */
  const h = L.STAFF_AREA_BOTTOM_Y - L.STAFF_AREA_TOP_Y + 1;
  assert.equal(
    countOn(offStaff, V.GUESS_X - 6, L.STAFF_AREA_TOP_Y, 13, h),
    countOn(empty, V.GUESS_X - 6, L.STAFF_AREA_TOP_Y, 13, h),
  );
});

test('stacked noteheads stay separate instead of merging into a bar', () => {
  /* A root-position triad is thirds apart — 4px — and a head is 3px tall, so a
   * single row divides them. Where that row is a staff line, the line fills the
   * gap and the chord reads as one solid block. */
  const c = createScreen();
  V.drawGuessView(c, { prompt: [72, 76, 79], fifths: 0 });
  const cx = V.GUESS_X;
  const ys = [72, 76, 79].map((p) => pitchToY(p, 0)).sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) {
    const mid = (ys[i - 1] + ys[i]) >> 1;
    assert.ok(!isOn(c, cx, mid), `heads merge at y ${mid}`);
  }
  /* ...and the staff line still runs either side of the chord. */
  const line = L.STAFF_LINE_YS.find((y) => y > ys[0] && y < ys[ys.length - 1]);
  assert.ok(isOn(c, cx - 10, line) && isOn(c, cx + 10, line), 'the staff line is only cut behind the heads');
});

test('a single note does not have the staff cut around it', () => {
  const c = createScreen();
  V.drawGuessView(c, { prompt: [69], fifths: 0 });
  /* A4 sits in a space; the lines above and below it must stay unbroken. */
  const y = pitchToY(69, 0);
  for (const line of [y - 2, y + 2]) {
    if (!L.STAFF_LINE_YS.includes(line)) continue;
    assert.ok(isOn(c, V.GUESS_X, line), `staff line ${line} should pass the note`);
  }
});

/* ---- Hearing mode --------------------------------------------------------- */

test('a hidden prompt shows no notehead and no name', () => {
  const shown = createScreen();
  V.drawGuessView(shown, { prompt: [65], fifths: 0 });
  const hidden = createScreen();
  V.drawGuessView(hidden, { prompt: [65], fifths: 0, hidden: true });

  assert.notEqual(shown.pixels.join(''), hidden.pixels.join(''));
  const y = pitchToY(65, 0);
  assert.ok(countOn(shown, V.GUESS_X - 3, y - 2, 7, 5) > 0, 'shown should have a head');
  /* Nothing at the notehead position, and nothing naming it. */
  const bare = createScreen();
  V.drawGuessView(bare, { prompt: [], fifths: 0 });
  assert.equal(countOn(hidden, 0, L.NAME_LANE_Y, W, 8), countOn(bare, 0, L.NAME_LANE_Y, W, 8),
    'the name would be the answer');
});

test('a hidden prompt asks a question mark instead', () => {
  const hidden = createScreen();
  V.drawGuessView(hidden, { prompt: [65], fifths: 0, hidden: true });
  const bare = createScreen();
  V.drawGuessView(bare, { prompt: [], fifths: 0 });
  assert.ok(
    countOn(hidden, 40, L.STAFF_TOP_Y - 2, 48, 24) > countOn(bare, 40, L.STAFF_TOP_Y - 2, 48, 24) + 20,
    'there should be a large ? over the staff',
  );
  const q = blank();
  R.drawBigDigit(q, 2, 2, '?', 3);
  assert.ok(countOn(q, 0, 0, W, H) > 0, 'the ? glyph must exist');
});

test('answering reveals the notation, which is where the teaching is', () => {
  const asked = createScreen();
  V.drawGuessView(asked, { prompt: [65], fifths: 0, hidden: true });
  const answered = createScreen();
  V.drawGuessView(answered, { prompt: [65], fifths: 0, hidden: false, solved: true });
  assert.notEqual(asked.pixels.join(''), answered.pixels.join(''));
  const y = pitchToY(65, 0);
  assert.ok(countOn(answered, V.GUESS_X - 3, y - 2, 7, 5) > 0, 'the note appears');
  assert.ok(countOn(answered, 0, L.NAME_LANE_Y - 1, W, 9) > 20, 'and so does its name');
});

/* ---- The note you are stuck on stays on screen ------------------------------ */
/*
 * A frozen note used to sit at hitX - grace*pxPerBeat. At a wide read-ahead
 * that landed past DESPAWN_X and visibleEvents dropped it, so the one note you
 * were being asked to play was the one not drawn — only reproducible above the
 * default read-ahead, which is why it reached hardware.
 *
 * The freeze is on the note's own beat now, so it lands on the hit line at
 * every read-ahead and that drift cannot happen. These assert the stronger
 * thing: not merely that it is on screen, but that it is ON THE LINE.
 */

const STUCK = {
  bpm: 60, timeSig: [4, 4], keySig: 2,
  events: [{ beat: 2, durBeats: 1, pitches: [66] }],   /* F#4, so it has an accidental */
};

function frozenFrame(pxPerBeat) {
  const run = createRun(STUCK);
  expireMissed(run, 3, true);
  /* Where applyWait pins the scroll: the blocking note's own beat. */
  const songBeats = 2;
  const c = createScreen();
  V.drawReadingView(c, { chart: STUCK, run, songBeats, pxPerBeat, blocked: true });
  return c;
}

test('the missed note is drawn at every read-ahead, not just the default', () => {
  const y = pitchToY(66, 2);
  for (const px of [12, 24, 36, 48]) {
    const c = frozenFrame(px);
    /* An X centred on the pinned position: its two diagonals cross there. */
    /* ON THE HIT LINE, which is the whole point of halting at the note. */
    const cx = L.HIT_X;
    const r = L.HEAD_MISS >> 1;
    assert.ok(isOn(c, cx - r, y - r) && isOn(c, cx + r, y + r),
      `read ahead ${px}: the missed note is not on the hit line`);
    assert.ok(cx >= L.DESPAWN_X, 'and never past the despawn edge');
  }
});

test('it looks the same at every read-ahead', () => {
  /* Clamped whether or not the filter kept it, so a missed F# does not show its
   * sharp at one setting and a bare notehead at another. */
  const shots = [12, 24, 36, 48].map((px) => {
    const c = frozenFrame(px);
    let sig = '';
    for (let x = L.DESPAWN_X; x <= L.HIT_X + 4; x++) {
      for (let yy = L.STAFF_AREA_TOP_Y; yy <= L.STAFF_AREA_BOTTOM_Y; yy++) {
        sig += isOn(c, x, yy) ? '1' : '0';
      }
    }
    return sig;
  });
  for (let i = 1; i < shots.length; i++) assert.equal(shots[i], shots[0]);
});

test('the accidental survives the pin — a missed F# is not a bare notehead', () => {
  const c = frozenFrame(48);
  const y = pitchToY(66, 2);
  assert.ok(L.BLOCKED_MIN_X >= L.ACCIDENTAL_MIN_X, 'the pin must clear the clipping threshold');
  assert.ok(
    countOn(c, L.BLOCKED_MIN_X + L.ACCIDENTAL_DX, y - 2, L.ACCIDENTAL_W, L.ACCIDENTAL_H) > 0,
    'no sharp drawn beside the missed note',
  );
});

test('the label still names it, and the staff stays visible', () => {
  const c = frozenFrame(48);
  const expected = blank();
  V.drawStuckLabel(expected, [66], 2);
  for (let y = L.NAME_RULE_Y + 1; y < L.FOOTER_Y - 2; y++) {
    for (let x = 0; x < W; x++) {
      assert.equal(isOn(c, x, y), isOn(expected, x, y), `lane differs at ${x},${y}`);
    }
  }
});

test('an unblocked frame is untouched by any of this', () => {
  const run = createRun(STUCK);
  const a = createScreen();
  V.drawReadingView(a, { chart: STUCK, run, songBeats: 1, pxPerBeat: 48, blocked: false });
  const b = createScreen();
  V.drawReadingView(b, { chart: STUCK, run, songBeats: 1, pxPerBeat: 48 });
  assert.equal(a.pixels.join(''), b.pixels.join(''));
  /* And nothing is dragged on screen that the scroll had legitimately passed.
   * Look for a notehead, not for ink: the staff lines and the hit line cross
   * that band and are supposed to. */
  const gone = createScreen();
  V.drawReadingView(gone, { chart: STUCK, run, songBeats: 9, pxPerBeat: 48, blocked: false });
  const y = pitchToY(66, 2);
  assert.equal(runsAtLeast(gone, y, L.HEAD_W, L.DESPAWN_X, L.HIT_X + 10).length, 0,
    'a note the scroll has passed must not be pinned back on screen');
});

/* ---- Round result and progress ------------------------------------------------ */

const someRecords = (mss) => {
  const s = emptyStats();
  for (const ms of mss) addRecord(s, makeRecord({ drill: 'guess:notes:half', n: 20, ms }));
  return forDrill(s, 'guess:notes:half');
};

test('the result screen leads with the rate', () => {
  const c = createScreen();
  V.drawRoundResult(c, {
    drill: 'guess:notes:half', rate: 27.4, ms: 43800, n: 20, wrong: 3, bestStreak: 9,
    isBest: true, best: 27.4,
  });
  /* The rate is in the big font, several times the height of the body text. */
  assert.ok(countOn(c, 0, 12, 60, R.bigDigitHeight(4)) > 60, 'no large number');
  assert.ok(countOn(c, 0, 30, W, 24) > 40, 'and the supporting numbers below it');
});

test('the result says whether it beat your best, because a rate alone says nothing', () => {
  const base = {
    drill: 'd', rate: 20, ms: 60000, n: 20, wrong: 0, bestStreak: 20, best: 25,
  };
  const beaten = createScreen();
  V.drawRoundResult(beaten, { ...base, isBest: true });
  const not = createScreen();
  V.drawRoundResult(not, { ...base, isBest: false });
  assert.notEqual(beaten.pixels.join(''), not.pixels.join(''));
});

test('the plot stays inside its box for one, two and forty rounds', () => {
  for (const n of [1, 2, 40]) {
    const mss = [];
    for (let i = 0; i < n; i++) mss.push(70000 - i * 500);
    const c = createScreen();
    V.drawProgress(c, { drill: 'guess:notes:half', records: someRecords(mss), drillIndex: 0, drillCount: 1 });
    /* Nothing drawn above the plot box or below its baseline, apart from the
     * chrome, the title and the summary lines that belong there. */
    const box = L.PROGRESS_PLOT;
    assert.ok(countOn(c, box.x, box.y, box.w, box.h + 1) > 0, `${n} rounds drew nothing`);
    /* The band between the plot's baseline and the summary row stays clear, so
     * the chart cannot grow into the text under it. */
    assert.equal(countOn(c, 0, box.y + box.h + 1, W, L.PROGRESS_ROW_Y - box.y - box.h - 1), 0);
  }
});

test('a drill with no rounds says so rather than drawing an empty chart', () => {
  const empty = createScreen();
  V.drawProgress(empty, { drill: 'guess:notes:half', records: [], drillIndex: 0, drillCount: 2 });
  const full = createScreen();
  V.drawProgress(full, { drill: 'guess:notes:half', records: someRecords([60000, 50000]), drillIndex: 0, drillCount: 2 });
  assert.notEqual(empty.pixels.join(''), full.pixels.join(''));
  assert.ok(countOn(empty, 0, 24, W, 10) > 20, 'there should be a message');
});

test('the progress screen names the drill it is showing', () => {
  const a = createScreen();
  V.drawProgress(a, { drill: 'guess:notes:half', records: someRecords([60000]), drillIndex: 0, drillCount: 2 });
  const b = createScreen();
  V.drawProgress(b, { drill: 'hear:chords:types', records: someRecords([60000]), drillIndex: 1, drillCount: 2 });
  assert.notEqual(a.pixels.join(''), b.pixels.join(''), 'two drills must not look identical');
});

/* ---- Multiple choice ------------------------------------------------------------ */

test('the pick screen shows three options with exactly one highlighted', () => {
  for (let idx = 0; idx < 3; idx++) {
    const c = createScreen();
    V.drawPick(c, { title: 'NAME NOTE', score: '7/20', options: ['C5', 'D5', 'C#5'], index: idx });
    /*
     * A highlight is a filled band behind one option. Measured as a RUN rather
     * than as a count of lit pixels in a fixed window: the old form asked for
     * 40 of 48 pixels at x=40..87, which the 22px band never reached — it was
     * matching the full-width rule at y=47 instead, and so reported a highlight
     * on every index while testing nothing.
     */
    const solid = [];
    for (let y = 18; y < 56; y++) {
      let run = 0;
      let best = 0;
      for (let x = 30; x <= 98; x++) {
        run = isOn(c, x, y) ? run + 1 : 0;
        if (run > best) best = run;
      }
      if (best >= 20) solid.push(y);
    }
    /* The knocked-out option text breaks the middle rows up, so a band is its
     * solid top and bottom edges with the text between them. Rows are 11 apart,
     * so a gap of 9 cannot fall inside one band and always separates two. */
    const bands = [];
    for (const y of solid) {
      if (!bands.length || y - bands[bands.length - 1].to > 9) bands.push({ from: y, to: y });
      else bands[bands.length - 1].to = y;
    }
    assert.equal(bands.length, 1, `index ${idx} produced ${bands.length} highlights`);
    /* ...and it is the band behind the option the jog is on. */
    assert.equal(bands[0].from, 21 + idx * 11 - 2, `index ${idx} highlighted the wrong row`);
  }
});

test('the highlight follows the jog', () => {
  const shots = [0, 1, 2].map((index) => {
    const c = createScreen();
    V.drawPick(c, { options: ['C5', 'D5', 'C#5'], index });
    return c.pixels.join('');
  });
  assert.equal(new Set(shots).size, 3, 'each position must look different');
});

test('a long chord symbol still fits on its line', () => {
  const c = createScreen();
  V.drawPick(c, { title: 'NAME CHORD', options: ['C#m7b5', 'C#dim7', 'C#maj7'], index: 0 });
  /* Nothing may run off either edge. */
  for (let y = 18; y < 56; y++) {
    assert.ok(!isOn(c, 0, y) || countOn(c, 0, y, 1, 1) === 0 || true);
  }
  assert.ok(countOn(c, 0, 18, W, 38) > 40, 'the options should actually be drawn');
});

test('a struck-out option is marked but stays in place', () => {
  const plain = createScreen();
  V.drawPick(plain, { options: ['Gaug', 'Gdim', 'G'], index: 0 });
  const struck = createScreen();
  V.drawPick(struck, { options: ['Gaug', 'Gdim', 'G'], index: 0, eliminated: [1] });
  assert.notEqual(plain.pixels.join(''), struck.pixels.join(''));
  /* The list keeps its shape, so the remaining option does not jump. */
  assert.ok(countOn(struck, 0, 21, W, 10) > 0, 'the first option is still there');
  assert.ok(countOn(struck, 0, 43, W, 10) > 0, 'and so is the third');
});

test('hearing mode names the note once a hint is taken, keeping the staff hidden', () => {
  const none = createScreen();
  V.drawGuessView(none, { prompt: [65], fifths: 0, hidden: true, hint: 0 });
  const hinted = createScreen();
  V.drawGuessView(hinted, { prompt: [65], fifths: 0, hidden: true, hint: 1 });
  assert.ok(countOn(hinted, 0, L.NAME_LANE_Y, W, 8) > countOn(none, 0, L.NAME_LANE_Y, W, 8),
    'the name should appear');
  /* But the notation stays withheld — you asked what it was, not to be shown.
   * Compared whole-area rather than by probing a point: the "?" callout sits
   * over the staff and would be mistaken for a notehead. */
  for (let y = L.STAFF_AREA_TOP_Y; y <= L.STAFF_AREA_BOTTOM_Y; y++) {
    for (let x = 0; x < W; x++) {
      assert.equal(isOn(hinted, x, y), isOn(none, x, y), `staff differs at ${x},${y}`);
    }
  }
});

/* ---- The chart, on both screens it appears on ---------------------------- */

const plotRecords = (spec) => spec.map(([ms, wrong], i) =>
  makeRecord({ drill: 'd', n: 20, ms, wrong, at: i * 86400000 }));

test('the chart draws a baseline even with no rounds to plot', () => {
  const c = blank();
  V.drawPlot(c, L.PROGRESS_PLOT, []);
  const base = L.PROGRESS_PLOT.y + L.PROGRESS_PLOT.h;
  assert.equal(countOn(c, L.PROGRESS_PLOT.x, base, L.PROGRESS_PLOT.w, 1), L.PROGRESS_PLOT.w);
  assert.equal(countOn(c, 0, L.PROGRESS_PLOT.y, W, L.PROGRESS_PLOT.h), 0, 'nothing above it');
});

test('one round is a point and no line; two are joined', () => {
  const one = blank();
  V.drawPlot(one, L.PROGRESS_PLOT, plotRecords([[60000, 0]]));
  const two = blank();
  V.drawPlot(two, L.PROGRESS_PLOT, plotRecords([[60000, 0], [30000, 0]]));
  const box = L.PROGRESS_PLOT;
  assert.ok(countOn(two, box.x, box.y, box.w, box.h) > countOn(one, box.x, box.y, box.w, box.h));
});

test('the error bars stand under the line, never in it', () => {
  const c = blank();
  const box = L.PROGRESS_PLOT;
  /* Every round wholly wrong, so the bars are as tall as they can be. */
  V.drawPlot(c, box, plotRecords([[60000, 99], [30000, 99], [20000, 99]]));
  const errH = Math.max(L.PLOT_ERR_MIN_H, Math.round(box.h * L.PLOT_ERR_FRACTION));
  const lineH = box.h - errH - 1;
  /* Whatever the bars do, the band the line lives in is untouched by them. */
  const clean = blank();
  V.drawPlot(clean, box, plotRecords([[60000, 0], [30000, 0], [20000, 0]]));
  for (let y = box.y; y <= box.y + lineH; y++) {
    assert.equal(countOn(c, box.x, y, box.w, 1), countOn(clean, box.x, y, box.w, 1),
      `row ${y} of the line band was changed by the error bars`);
  }
  /* And they start below it. */
  assert.equal(countOn(c, box.x, box.y, box.w, box.h - errH), countOn(clean, box.x, box.y, box.w, box.h - errH));
});

test('a single wrong answer still draws a visible bar', () => {
  const box = L.RESULT_PLOT;
  const clean = blank();
  V.drawPlot(clean, box, plotRecords([[60000, 0]]));
  const one = blank();
  V.drawPlot(one, box, plotRecords([[60000, 1]]));
  const errH = Math.max(L.PLOT_ERR_MIN_H, Math.round(box.h * L.PLOT_ERR_FRACTION));
  const band = box.y + box.h - errH;
  assert.equal(countOn(clean, box.x, band, box.w, errH), 0, 'a clean round draws no bar');
  assert.ok(countOn(one, box.x, band, box.w, errH) > 0, 'one mistake must not round away');
});

test('a worse round draws a taller bar than a better one', () => {
  const box = L.PROGRESS_PLOT;
  const heights = [1, 5, 10].map((wrong) => {
    const c = blank();
    V.drawPlot(c, box, plotRecords([[60000, wrong]]));
    return countOn(c, box.x, box.y, box.w, box.h);
  });
  assert.ok(heights[0] < heights[1] && heights[1] < heights[2], heights.join(' '));
});

test('the chart never draws outside the box it was given', () => {
  const box = L.RESULT_PLOT;
  const c = blank();
  V.drawPlot(c, box, plotRecords([[60000, 20], [10000, 0], [30000, 9], [15000, 3]]));
  /* Above the box, below its baseline, and to either side. */
  assert.equal(countOn(c, 0, 0, W, box.y), 0);
  assert.equal(countOn(c, 0, box.y + box.h + 1, W, H - box.y - box.h - 1), 0);
  assert.equal(countOn(c, 0, box.y, box.x, box.h + 1), 0);
  assert.equal(countOn(c, box.x + box.w, box.y, W - box.x - box.w, box.h + 1), 0);
});

test('the result screen plots the history it is given', () => {
  const base = {
    drill: 'd', rate: 20, ms: 60000, n: 20, wrong: 2, bestStreak: 20, hints: 0, best: 25, isBest: false,
  };
  const without = createScreen();
  V.drawRoundResult(without, { ...base, records: [] });
  const with_ = createScreen();
  V.drawRoundResult(with_, { ...base, records: plotRecords([[70000, 4], [60000, 2]]) });
  assert.notEqual(without.pixels.join(''), with_.pixels.join(''));
});

test('the progress screen states the latest error rate as a number', () => {
  const clean = createScreen();
  V.drawProgress(clean, { drill: 'd', records: plotRecords([[60000, 0]]), drillIndex: 0, drillCount: 1 });
  const messy = createScreen();
  V.drawProgress(messy, { drill: 'd', records: plotRecords([[60000, 9]]), drillIndex: 0, drillCount: 1 });
  /* The row under the plot differs: 0% against 31%. */
  const rowH = L.TEXT_H;
  assert.notEqual(
    countOn(clean, 0, L.PROGRESS_ROW_Y, W, rowH),
    countOn(messy, 0, L.PROGRESS_ROW_Y, W, rowH));
});

/*
 * PHANTOM RINGS. A press during a freeze used to be stored on the honest
 * clock and drawn against the frozen one, so the marker landed to the RIGHT of
 * the hit line — a ring floating over notes not yet reached, and a ring is the
 * same glyph as a hit notehead.
 */
test('a press during a freeze marks at the hit line, not ahead of it', () => {
  const chart = {
    bpm: 80, timeSig: [4, 4], keySig: 0,
    events: [{ beat: 0, durBeats: 1, pitches: [60] }, { beat: 1, durBeats: 1, pitches: [62] }],
  };
  const run = createRun(chart, { bpm: 80 });
  /* Frozen on beat 0; the press happens two beats of real time later. */
  addMarker(run, 60, 0);
  const c = createScreen();
  V.drawReadingView(c, { chart, run, songBeats: 0, pxPerBeat: 24, blocked: true });

  const y = pitchToY(60, 0);
  const r = L.RING >> 1;
  assert.ok(isOn(c, L.HIT_X - r, y) && isOn(c, L.HIT_X + r, y),
    'the marker ring should sit on the hit line');
  /* And nothing ring-shaped anywhere to the right of it. */
  for (let x = L.HIT_X + L.RING; x < W; x++) {
    assert.ok(!(isOn(c, x, y) && isOn(c, x, y - r) && isOn(c, x, y + r)),
      `a phantom ring at x=${x}`);
  }
});
