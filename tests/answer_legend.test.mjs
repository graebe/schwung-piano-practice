// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * Wherever pads answer, the screen says which pad is which.
 *
 * The owner, on Intervals › Read: "I don't see the options with the colour
 * coding, so I don't know which pad to press." The read screen showed the
 * jog's choice alone ("< Major >"), and the answer pads were a guess. The
 * rule since: every answer is tied to its pad on screen — its colour named in
 * the list (four answers or fewer, heard), or its cell drawn over its pad's
 * column (the Hear map, and the strip under every staff).
 *
 * This walks every screen where pads answer — each trainer's Read and Hear
 * with every answer that names, and every row of the catalog that opens a
 * hearing or reading course (the Learn rows, the Path's drills, the tonality
 * drills) — draws it as the Move does, and fails on any answer the screen
 * does not tie to its pad.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { fakeHost, openPath } from './support/fake_host.mjs';
import { createScreen } from '../tools/screen_buffer.mjs';
import * as V from '../src/view.mjs';
import * as AP from '../src/answer_pads.mjs';
import * as CAT from '../src/catalog.mjs';
import * as TRAIN from '../src/trainer.mjs';
import { GUESS_VIEW } from '../src/session.mjs';

/* A screen that remembers where each text went. */
function probe() {
  const c = createScreen();
  const texts = [];
  const text = c.text.bind(c);
  c.text = (x, y, s, v) => {
    if (s) texts.push({ x, y, w: c.textWidth(String(s)), s: String(s) });
    return text(x, y, s, v);
  };
  c.texts = texts;
  return c;
}

/*
 * The complaints for the pick screen now open: none when every answer is
 * tied to its pad. A list row names its colour beside its answer; a cell
 * holds the answer's short name inside its pad's column, and no two cells
 * share a name.
 */
function legendFaults(S) {
  const pick = S.pickScreen();
  if (!pick) return ['no pick screen'];
  const c = probe();
  if (pick.read) V.drawReadPick(c, pick.state);
  else V.drawPick(c, pick.state);
  const { options, short } = pick.state;
  const n = options.length;
  const bad = [];
  if (!pick.read && n <= AP.LIST_MAX) {
    for (let i = 0; i < n; i++) {
      const colour = AP.answerColour(i).name;
      const row = c.texts.find((t) => t.s === colour);
      const label = row && c.texts.find((t) => t.y === row.y && t !== row);
      if (!row || !label) bad.push(`"${options[i]}": its colour (${colour}) is not named beside it`);
    }
    return bad;
  }
  if (new Set(short).size !== n) bad.push(`two cells share a name: ${short.join(' ')}`);
  for (let i = 0; i < n; i++) {
    const { col } = AP.answerCell(n, i);
    const x0 = col * V.CELL_W;
    /* Below the title; on a staff screen, inside the strip under the staff. */
    const inBand = (t) => (pick.read ? t.y > V.STRIP_Y && t.y + 7 < V.STRIP_Y + V.CELL_H : t.y > 8);
    const cell = c.texts.find((t) => t.s === short[i] && inBand(t) && t.x >= x0 && t.x + t.w <= x0 + V.CELL_W);
    if (!cell) bad.push(`"${options[i]}" (${short[i]}): no cell over pad column ${col}`);
  }
  return bad;
}

/* Every row of the catalog that opens a round, by id, once. */
function quizIds(root) {
  const ids = new Map();
  const walk = (node, path) => {
    for (const c of node.children || []) {
      if (CAT.isFolder(c)) walk(c, path + ' / ' + c.label);
      else if (c.levels) for (const lv of c.levels) ids.set(lv.id, path + ' / ' + c.label + ' ' + lv.label);
      else if (c.id && !ids.has(c.id)) ids.set(c.id, path + ' / ' + c.label);
    }
  };
  walk(root, '');
  return [...ids].filter(([id]) => id.indexOf('quiz:') === 0);
}

test('every catalog row whose pads answer ties each answer to its pad', () => {
  const host = fakeHost();
  host.session.init();
  const ids = quizIds(host.session.catalog);
  const faults = [];
  let seen = 0;
  let strips = 0;
  for (const [id, where] of ids) {
    const h = fakeHost();
    h.session.init();
    h.session.openItem(id);
    if (h.session.view !== GUESS_VIEW || !h.session.answerBarActive()) continue;
    seen++;
    if (h.session.pickScreen().read) strips++;
    for (const f of legendFaults(h.session)) faults.push(`${where} (${id}): ${f}`);
  }
  assert.deepEqual(faults, []);
  assert.ok(seen > 100, `pad-answer screens walked: ${seen}`);
  assert.ok(strips > 5, `read strips walked: ${strips}`);
});

test('every trainer\'s Read and Hear, with every answer that names, ties each answer to its pad', () => {
  const faults = [];
  let seen = 0;
  for (const subject of Object.keys(TRAIN.SUBJECTS)) {
    const name = TRAIN.subjectOf(subject).name;
    for (const circle of ['read', 'hear']) {
      const answers = TRAIN.knobValues(subject, circle, TRAIN.coerceSetup(subject, circle, {}), 'answer');
      for (let a = 0; a < answers.length; a++) {
        if (answers[a].value === 'play') continue;
        for (const level of [1, 'top']) {
          const h = fakeHost();
          h.session.init();
          openPath(h.session, ['Practice', name, TRAIN.CIRCLE_LABEL[circle]]);
          /* Knob 1 is Level, knob 2 Answer, in every trainer. */
          for (let i = 0; i < answers.length; i++) h.session.knobStep(2, -1);
          for (let i = 0; i < a; i++) h.session.knobStep(2, 1);
          if (level === 'top') for (let i = 0; i < 20; i++) h.session.knobStep(1, 1);
          h.session.knobStep(1, -1);
          if (level === 1) for (let i = 0; i < 20; i++) h.session.knobStep(1, -1);
          h.session.playButton();
          const where = `${name} ${circle} ${answers[a].value} level ${level}`;
          if (h.session.view !== GUESS_VIEW) { faults.push(`${where}: no round`); continue; }
          if (!h.session.answerBarActive()) { faults.push(`${where}: pads do not answer`); continue; }
          seen++;
          for (const f of legendFaults(h.session)) faults.push(`${where}: ${f}`);
        }
      }
    }
  }
  assert.deepEqual(faults, []);
  assert.ok(seen >= 20, `trainer screens walked: ${seen}`);
});
