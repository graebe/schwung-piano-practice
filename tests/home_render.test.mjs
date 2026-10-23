// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * The home screen's circles, grow and drawing, asserted on pixels. Imports
 * only src/home -- the 128x64 buffer below is this file's own -- so it runs
 * unchanged in Drums Practice, which vendors the engine byte for byte.
 *
 * `npm run preview -- --view home [--selected N --t ms]` shows the same
 * screen as ASCII art.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HOME_X, HOME_Y, HOME_COUNT, HOME_PADS, HOME_MAX, R_SMALL, R_LARGE, ICON_SWITCH_R, LABEL_Y, GROW_MS, BAND_Y, BAND_H,
  homeLayout, homePads,
  circleRows, circleRuns, compile, rowsToRuns, runsToRects, iconRows,
  createGrow, startGrow, radiusAt, growAt, growing, itemOfPad, drawHome,
} from '../src/home/render.mjs';
import { ICONS, PRACTICE_DRUMS, PRACTICE_PIANO } from '../src/home/icons.mjs';

/* ---- A 128x64 1-bit screen that counts the calls made to it ------------- */
const W = 128;
const H = 64;
function screen(fill = 0) {
  const px = new Uint8Array(W * H).fill(fill);
  const set = (x, y, v) => {
    if (x >= 0 && y >= 0 && x < W && y < H) px[y * W + x] = v ? 1 : 0;
  };
  return {
    calls: 0,
    fillRect(x, y, w, h, v) {
      this.calls++;
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) set(x + xx, y + yy, v);
    },
    text(x, y, s, v) {
      this.calls++;
      this.texts = [...(this.texts || []), { x, y, s, v }];
    },
    textWidth(s) { return s.length * 6 - 1; },
    on(x, y) { return x >= 0 && y >= 0 && x < W && y < H && px[y * W + x] === 1; },
    count(x, y, w, h) {
      let n = 0;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (this.on(xx, yy)) n++;
      return n;
    },
    rows(x, y, w, h) {
      const out = [];
      for (let yy = y; yy < y + h; yy++) {
        let r = '';
        for (let xx = x; xx < x + w; xx++) r += this.on(xx, yy) ? '#' : '.';
        out.push(r);
      }
      return out;
    },
  };
}

const ITEMS = (practice) => [
  { key: 'path', label: 'Path', icon: 'path' },
  { key: 'practice', label: 'Practice', icon: practice },
  { key: 'quiz', label: 'Quiz', icon: 'quiz' },
  { key: 'progress', label: 'Progress', icon: 'progress' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];
const lit = (rows) => rows.join('').split('').filter((c) => c === '#').length;
const mirrorX = (rows) => rows.map((r) => [...r].reverse().join(''));

/* ---- Compiling ----------------------------------------------------------- */

test('rows compile to rectangles that cover exactly the lit pixels', () => {
  const all = [circleRows(9).outline, circleRows(12).fill];
  for (const set of [...Object.values(ICONS), PRACTICE_DRUMS, PRACTICE_PIANO]) all.push(set.small, set.large);
  for (const rows of all) {
    const c = screen();
    for (const [x, y, w, h] of compile(rows)) c.fillRect(x, y, w, h, 1);
    assert.deepEqual(c.rows(0, 0, rows[0].length, rows.length), rows);
  }
  assert.deepEqual(runsToRects(rowsToRuns(['#.#', '#.#', '###'])), [[0, 0, 1, 2], [2, 0, 1, 2], [0, 2, 3, 1]]);
});

/* ---- Circles ------------------------------------------------------------- */

test('circles are symmetric both ways, 1 px rings round solid discs', () => {
  for (let r = R_SMALL; r <= R_LARGE; r++) {
    const { outline, fill } = circleRows(r);
    assert.equal(outline.length, 2 * r + 1);
    for (const rows of [outline, fill]) {
      assert.deepEqual(mirrorX(rows), rows, `r ${r}: left-right`);
      assert.deepEqual([...rows].reverse(), rows, `r ${r}: top-bottom`);
    }
    assert.equal(outline[0].indexOf('#') > 0, true, 'rounded, not square');
    assert.equal(outline[r], '#' + '.'.repeat(2 * r - 1) + '#', 'touching its radius at the equator');
    /* The disc is the ring filled in: every row one span, edge to edge. */
    fill.forEach((row, y) => {
      assert.match(row, /^\.*#+\.*$/);
      assert.equal(row.indexOf('#'), outline[y].indexOf('#'));
    });
    /* A ring with no gaps: every lit pixel touches two others. */
    outline.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch !== '#') return;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && outline[y + dy]?.[x + dx] === '#') n++;
      }
      assert.ok(n >= 2, `r ${r}: ${x},${y}`);
    }));
  }
});

test('the radii nest: each ring lies inside the next one\'s disc', () => {
  for (let r = R_SMALL; r < R_LARGE; r++) {
    const inner = circleRows(r).outline;
    const outer = circleRows(r + 1).fill;
    inner.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '#') assert.equal(outer[y + 1][x + 1], '#', `r ${r} at ${x},${y}`);
    }));
    assert.ok(lit(circleRows(r + 1).fill) > lit(circleRows(r).fill));
  }
});

test('circles are cached rects: an outline is a few dozen calls, a disc one per row', () => {
  for (let r = R_SMALL; r <= R_LARGE; r++) {
    const c = circleRuns(r);
    assert.equal(circleRuns(r), c, 'cached');
    assert.ok(c.outline.length <= 28, `r ${r} outline: ${c.outline.length}`);
    assert.ok(c.fill.length <= 2 * r + 1, `r ${r} fill: ${c.fill.length}`);
    assert.ok(c.fill.every(([, , , h], i) => i === 0 || h >= 1));
  }
});

/* ---- Layout -------------------------------------------------------------- */

test('five circles, evenly spaced, inside the band even when grown', () => {
  assert.equal(HOME_COUNT, 5);
  assert.deepEqual([...HOME_X], [13, 38, 64, 90, 115]);
  assert.equal(HOME_Y, 30);
  for (const x of HOME_X) {
    assert.ok(x - R_LARGE >= 0 && x + R_LARGE <= W - 1, `x ${x}`);
  }
  assert.ok(HOME_Y - R_LARGE >= BAND_Y && HOME_Y + R_LARGE < LABEL_Y, 'clear of the title and the label');
  assert.ok(LABEL_Y + 7 <= BAND_Y + BAND_H, 'the label inside the band');
  assert.equal(BAND_Y + BAND_H, 55, 'the hint line is the module\'s, from y 56');
  /* A grown circle never touches its neighbours. */
  for (let i = 1; i < HOME_COUNT; i++) assert.ok(HOME_X[i] - HOME_X[i - 1] - R_LARGE - R_SMALL >= 3);
});

/* ---- Grow ---------------------------------------------------------------- */

test('at rest the selected circle is r 12, the rest r 9', () => {
  const g = createGrow(2);
  assert.deepEqual(growAt(g, 0), [9, 9, 12, 9, 9]);
  assert.ok(!growing(g, 0));
  assert.deepEqual(growAt(createGrow(), 5, 3), [12, 9, 9]);
});

test('the grow: 9 to 12 over 160 ms with an ease-out, the old circle shrinking back', () => {
  const g = createGrow(1);
  startGrow(g, 2, 1000);
  assert.deepEqual([g.from, g.to], [1, 2]);
  assert.deepEqual(growAt(g, 1000), [9, 12, 9, 9, 9], 'starts where it was');
  assert.ok(growing(g, 1000) && growing(g, 1000 + GROW_MS - 1) && !growing(g, 1000 + GROW_MS));
  assert.deepEqual(growAt(g, 1000 + GROW_MS), [9, 9, 12, 9, 9]);
  assert.deepEqual(growAt(g, 99999), [9, 9, 12, 9, 9]);
  let lastTo = 9;
  let lastFrom = 12;
  for (let t = 0; t <= GROW_MS; t += 10) {
    const to = radiusAt(g, 2, 1000 + t);
    const from = radiusAt(g, 1, 1000 + t);
    assert.ok(to >= lastTo && from <= lastFrom, `monotone at ${t}`);
    assert.equal(to + from, 21, `they trade size at ${t}`);
    lastTo = to;
    lastFrom = from;
  }
  /* Ease-out: most of the growing happens early. */
  assert.equal(radiusAt(g, 2, 1000 + 55), 11, 'past the icon switch at a third of the way, where linear is at 10');
  assert.equal(Math.round(9 + 3 * (55 / GROW_MS)), 10);
  assert.equal(radiusAt(g, 2, 1000 + 15), 10);
  assert.equal(radiusAt(g, 0, 1000 + 40), 9, 'the others never move');
});

test('a new jog mid-grow shrinks the half-grown circle from its size', () => {
  const g = createGrow(0);
  startGrow(g, 1, 0);
  const half = radiusAt(g, 1, 30);
  assert.ok(half > 9 && half < 12);
  startGrow(g, 2, 30);
  assert.equal(radiusAt(g, 1, 30), half, 'no jump');
  assert.equal(radiusAt(g, 0, 30), 9, 'the first one is back to rest');
  assert.equal(radiusAt(g, 2, 30 + GROW_MS), 12);
  assert.equal(radiusAt(g, 1, 30 + GROW_MS), 9);
  assert.equal(startGrow(g, 2, 50), g, 'choosing the selected circle again changes nothing');
  assert.equal(g.t0, 30);
});

test('pads: one per circle, notes 69..73', () => {
  assert.deepEqual([...HOME_PADS], [69, 70, 71, 72, 73]);
  for (let i = 0; i < 5; i++) assert.equal(itemOfPad(HOME_PADS[i]), i);
  assert.equal(itemOfPad(68), -1);
  assert.equal(itemOfPad(74), -1);
  assert.equal(itemOfPad(99), -1);
});

/* ---- Drawing ------------------------------------------------------------- */

/* The icon drawn at circle i, as rows, from the screen. */
const iconAt = (c, i, size) => c.rows(HOME_X[i] - (size >> 1), HOME_Y - (size >> 1), size, size);

test('selected: a filled r 12 disc with the large icon cut out; the rest: rings with the small icon lit', () => {
  for (const practice of [PRACTICE_PIANO, PRACTICE_DRUMS]) {
    const items = ITEMS(practice);
    for (let sel = 0; sel < 5; sel++) {
      const c = screen();
      drawHome(c, { items, selected: sel });
      for (let i = 0; i < 5; i++) {
        const x = HOME_X[i];
        if (i === sel) {
          const want = iconRows(items[i].icon, true).map((r) => [...r].map((ch) => (ch === '#' ? '.' : '#')).join(''));
          assert.deepEqual(iconAt(c, i, 13), want, `large icon inverted at ${i}`);
          assert.ok(c.on(x - R_LARGE, HOME_Y) && c.on(x + R_LARGE, HOME_Y) && c.on(x, HOME_Y - R_LARGE));
          assert.ok(!c.on(x - R_LARGE - 1, HOME_Y), 'r 12 exactly');
        } else {
          assert.deepEqual(iconAt(c, i, 9), iconRows(items[i].icon, false), `small icon at ${i}`);
          assert.ok(c.on(x - R_SMALL, HOME_Y) && !c.on(x - R_SMALL + 1, HOME_Y), 'a 1 px ring at r 9');
          assert.ok(!c.on(x - R_SMALL - 1, HOME_Y));
        }
      }
      assert.deepEqual(c.texts, [{ x: (128 - c.textWidth(items[sel].label)) >> 1, y: LABEL_Y, s: items[sel].label, v: 1 }]);
    }
  }
});

test('the icon switches to its large size at r 11', () => {
  assert.equal(ICON_SWITCH_R, 11);
  const items = ITEMS(PRACTICE_PIANO);
  const g = createGrow(1);
  startGrow(g, 2, 0);
  let saw = 0;
  for (let t = 0; t <= GROW_MS; t += 5) {
    const c = screen();
    drawHome(c, { items, grow: g, now: t });
    for (const i of [1, 2]) {
      const r = radiusAt(g, i, t);
      const large = r >= ICON_SWITCH_R;
      const want = iconRows(items[i].icon, large);
      const size = large ? 13 : 9;
      const got = iconAt(c, i, size);
      const shown = i === 2 ? want.map((row) => [...row].map((ch) => (ch === '#' ? '.' : '#')).join('')) : want;
      assert.deepEqual(got, shown, `circle ${i}, r ${r}, at ${t} ms`);
      saw |= large ? 1 : 2;
    }
  }
  assert.equal(saw, 3, 'both sizes seen mid-grow');
});

test('drawHome touches nothing outside y 10..54; no grow means at rest', () => {
  const items = ITEMS(PRACTICE_DRUMS);
  for (const [grow, now] of [[null, 0], [startGrow(createGrow(4), 0, 0), 30]]) {
    const c = screen(1);
    drawHome(c, { items, selected: 0, grow, now });
    assert.equal(c.count(0, 0, W, BAND_Y), W * BAND_Y, 'title bar untouched');
    assert.equal(c.count(0, BAND_Y + BAND_H, W, H - BAND_Y - BAND_H), W * (H - BAND_Y - BAND_H), 'hint line untouched');
  }
});

test('fewer items, an unknown icon, no label: drawn as far as they go', () => {
  const c = screen();
  drawHome(c, { items: [{ key: 'a', label: '', icon: 'nope' }, { key: 'b', label: 'B', icon: 'quiz' }], selected: 0 });
  const [x0, x1] = homeLayout(2);
  assert.equal(c.count(x0 - 6, HOME_Y - 6, 13, 13), 13 * 13, 'a plain disc');
  assert.ok(c.on(x1 - R_SMALL, HOME_Y), 'the second circle where a ring of two puts it');
  assert.equal(c.count(0, HOME_Y - R_LARGE, x0 - R_LARGE, 2 * R_LARGE + 1), 0, 'nothing left of the ring of two, where a ring of five starts');
  assert.equal(c.texts, undefined, 'no label');
  assert.equal(iconRows('nope', true), null);
  /* A sixth item and on are not drawn. */
  const six = screen();
  drawHome(six, { items: Array.from({ length: 6 }, (_, i) => ({ key: 'k' + i, label: 'x', icon: 'quiz' })), selected: 0 });
  const five = screen();
  drawHome(five, { items: Array.from({ length: 5 }, (_, i) => ({ key: 'k' + i, label: 'x', icon: 'quiz' })), selected: 0 });
  assert.equal(six.count(0, 0, 128, 64), five.count(0, 0, 128, 64));
});

test('rings of 2 to 5: evenly spaced, symmetric, inside the screen; five is the home screen', () => {
  assert.equal(HOME_MAX, 5);
  assert.deepEqual([...homeLayout(5)], [13, 38, 64, 90, 115]);
  assert.equal(homeLayout(5), HOME_X);
  assert.deepEqual([...homeLayout(4)], [16, 48, 80, 112]);
  assert.deepEqual([...homeLayout(3)], [21, 64, 107]);
  assert.deepEqual([...homeLayout(2)], [32, 96]);
  for (let n = 2; n <= 5; n++) {
    const xs = homeLayout(n);
    assert.equal(xs.length, n);
    xs.forEach((x, i) => {
      assert.ok(Math.abs(x + xs[n - 1 - i] - 128) <= 1, `n=${n}: symmetric about the middle`);
      assert.ok(x - R_LARGE >= 0 && x + R_LARGE <= 127, `n=${n}: a grown circle inside the screen`);
      if (i) assert.ok(x - xs[i - 1] - R_LARGE - R_SMALL >= 3, `n=${n}: a grown circle clear of its neighbours`);
    });
  }
  assert.deepEqual([...homeLayout(9)], [...homeLayout(5)], 'never more than five');
});

test('pads per ring: centred in the bottom row', () => {
  assert.deepEqual([...homePads(5)], [69, 70, 71, 72, 73]);
  assert.equal(homePads(5), HOME_PADS);
  assert.deepEqual([...homePads(4)], [70, 71, 72, 73]);
  assert.deepEqual([...homePads(3)], [70, 71, 72]);
  assert.deepEqual([...homePads(2)], [71, 72]);
  for (let n = 2; n <= 5; n++) homePads(n).forEach((note, i) => assert.equal(itemOfPad(note, n), i));
  assert.equal(itemOfPad(69, 3), -1);
  assert.equal(itemOfPad(73, 4), 3);
  assert.equal(itemOfPad(73), 4, 'five unless told');
});

test('the home screen of five is pixel for pixel what it was before rings of other sizes', () => {
  /* Hashes recorded from the engine before homeLayout: every circle chosen,
   * at rest and through a grow, with both practice icons. */
  const GOLDEN = ['6ef4902d',  '30a0367b',  '19f5f347',  '78dfeb15',  '6ef4902d',  '217b194d',  '43e8d0b3',  '55433c2b',  '4a95be81',  '217b194d',  '59a2afad',  '6b7a45d5',  'e9bab951',  '5d27b341',  '59a2afad',  'ae41fe78',  '9acb65f1',  'eeb34fdd',  '9534cec',  'ae41fe78',  'fe18894b',  'e0aa733e',  '8c63a96a',  '869036cb',  'fe18894b',  'c48741bd',  'a48ad09f',  '9cef165b',  'a8977095',  'c48741bd',  'bd4a5a7d',  '54babc83',  '12a33b13',  '17d1e925',  'bd4a5a7d',  '84930eb9',  '96d2e48d',  '3226aa91',  'ab5f9be5',  '84930eb9',  '9ae3b34',  '944fdb9d',  'f8f1da61',  '1cb68620',  '9ae3b34',  'bf38177f',  'f057f4c6',  '9789d272',  'ecfafa27',  'bf38177f'];
  const got = [];
  for (const pr of [PRACTICE_PIANO, PRACTICE_DRUMS]) {
    const items = ['path', pr, 'quiz', 'progress', 'settings'].map((icon, i) => ({ key: 'k' + i, label: ['Path', 'Practice', 'Quiz', 'Progress', 'Settings'][i], icon }));
    for (let sel = 0; sel < 5; sel++) {
      for (const t of [null, 0, 40, 80, 160]) {
        const px = new Uint8Array(8192);
        const c = {
          fillRect(x, y, w, h, v) {
            for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (xx >= 0 && yy >= 0 && xx < 128 && yy < 64) px[yy * 128 + xx] = v ? 1 : 0;
          },
          text(x, y, str) { for (let i = 0; i < str.length; i++) px[y * 128 + x + i] ^= 1; },
          textWidth: (str) => str.length * 6 - 1,
        };
        const grow = t === null ? null : startGrow(createGrow((sel + 4) % 5), sel, 0);
        drawHome(c, { items, selected: sel, grow, now: t ?? 0 });
        let h = 0x811c9dc5;
        for (const b of px) h = Math.imul(h ^ b, 0x01000193) >>> 0;
        got.push(h.toString(16));
      }
    }
  }
  assert.deepEqual(got, GOLDEN);
});

test('every ring stays under 150 ctx calls, at rest and through every grow', () => {
  const RINGS = [
    ['notes', 'kit', 'sticks', 'dice', 'folder'], ['notes', 'kit', 'sticks', 'dice'],
    ['staff', 'ear', 'padpick', 'metronome', 'loop'],
    ['stairs', 'chord', 'progression', 'dice', 'song'], ['ear', 'staff', 'keyletter'],
    ['note', 'interval', 'stairs', 'chord', 'progression'], ['staff', 'ear', 'keyletter', 'book', 'progress'],
  ];
  for (const keys of RINGS) {
    const items = keys.map((icon) => ({ key: icon, label: 'Hear: subdivision', icon }));
    let worst = 0;
    for (let from = 0; from < keys.length; from++) {
      for (let to = 0; to < keys.length; to++) {
        const g = startGrow(createGrow(from), to, 0);
        for (let t = 0; t <= GROW_MS + 10; t += 5) {
          const c = screen();
          drawHome(c, { items, grow: g, now: t });
          worst = Math.max(worst, c.calls);
        }
      }
    }
    assert.ok(worst < 150, `${keys.join('/')}: worst frame ${worst} calls`);
  }
});

test('a frame is cheap: under 150 ctx calls at rest and through every grow', () => {
  let worst = 0;
  for (const practice of [PRACTICE_PIANO, PRACTICE_DRUMS]) {
    const items = ITEMS(practice);
    for (let from = 0; from < 5; from++) {
      for (let to = 0; to < 5; to++) {
        const g = startGrow(createGrow(from), to, 0);
        for (let t = 0; t <= GROW_MS + 10; t += 5) {
          const c = screen();
          drawHome(c, { items, grow: g, now: t });
          worst = Math.max(worst, c.calls);
        }
      }
    }
  }
  assert.ok(worst < 150, `worst frame: ${worst} calls`);
});
