// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
// From the neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/test/info.test.mjs).
// Changed: the import paths, to web/src/kit/lib.
/*
 * Info in the hint bar: in at once, out after a beat, and an outcome first.
 *
 * Run with --conditions=browser (npm test does), so Solid's signals update.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoot } from 'solid-js';
import {
  createInfo, bindInfo, hintClauses, infoClause, infoAttrs, INFO_DELAY_MS,
} from '../../src/kit/lib/info.js';

/* A clock the test moves by hand. */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const pending = new Map();
  return {
    setTimeout: (fn, ms) => { pending.set(next, { fn, at: now + ms }); return next++; },
    clearTimeout: (id) => { pending.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...pending]) {
        if (t.at <= now) { pending.delete(id); t.fn(); }
      }
    },
    get pending() { return pending.size; },
  };
}

const withInfo = (fn) => createRoot((dispose) => {
  const timers = fakeTimers();
  const info = createInfo({ timers });
  try { fn(info, timers); } finally { info.dispose(); dispose(); }
});

const RATE = 'Rate — the length of one step, synced to the song tempo.';
const LENGTH = 'Length — 1 to 128 steps.';

test('entering shows the string at once', () => withInfo((info) => {
  assert.equal(info.text(), null);
  info.enter(RATE);
  assert.equal(info.text(), RATE);
}));

test('leaving restores the conventions only after the delay', () => withInfo((info, timers) => {
  info.enter(RATE);
  info.leave();
  timers.advance(INFO_DELAY_MS - 1);
  assert.equal(info.text(), RATE, 'still shown inside the delay');
  timers.advance(1);
  assert.equal(info.text(), null);
}));

test('moving between neighbours goes string to string, never through the conventions', () => withInfo((info, timers) => {
  const shown = [];
  info.enter(RATE);
  shown.push(info.text());
  /* Across the 8px gap between two knobs: left one, then the next. */
  info.leave();
  timers.advance(40);
  shown.push(info.text());
  info.enter(LENGTH);
  shown.push(info.text());
  /* The first leave's timer was cancelled: it does not fire later. */
  timers.advance(INFO_DELAY_MS * 2);
  shown.push(info.text());
  assert.deepEqual(shown, [RATE, RATE, LENGTH, LENGTH]);
  assert.equal(timers.pending, 0);
}));

test('focus shows its string and blur restores after the delay', () => withInfo((info, timers) => {
  info.focus(RATE);
  assert.equal(info.text(), RATE);
  info.blur();
  /* Tab to the next control: focusout, then focusin at once. */
  info.focus(LENGTH);
  timers.advance(INFO_DELAY_MS);
  assert.equal(info.text(), LENGTH);
  info.blur();
  timers.advance(INFO_DELAY_MS);
  assert.equal(info.text(), null);
}));

test('the pointer wins over the focus, and the focus is still there when it leaves', () => withInfo((info, timers) => {
  info.focus(RATE);
  info.enter(LENGTH);
  assert.equal(info.text(), LENGTH);
  info.leave();
  timers.advance(INFO_DELAY_MS);
  assert.equal(info.text(), RATE);
}));

test('a string that changes under the pointer is shown as it is now', () => withInfo((info) => {
  const el = {};
  info.enter(RATE, el);
  info.refresh({}, LENGTH);
  assert.equal(info.text(), RATE, 'another element: ignored');
  info.refresh(el, LENGTH);
  assert.equal(info.text(), LENGTH);
  info.focus(RATE, el);
  info.refresh(el, 'Rate — again.');
  assert.equal(info.text(), 'Rate — again.');
}));

test('an outcome takes precedence over info, and info over the conventions', () => {
  const conventions = [['click', 'a step to toggle'], ['shift-click', 'for a tie'], ['drag', 'up or down']];
  const status = ['Copied', 'slot 1.'];
  const withStatus = [status, conventions[0], conventions[1]];
  assert.deepEqual(hintClauses({ conventions }), { clauses: conventions, info: null });
  assert.deepEqual(hintClauses({ conventions, info: RATE }), {
    clauses: conventions,
    info: ['Rate', '— the length of one step, synced to the song tempo.'],
  });
  assert.deepEqual(hintClauses({ conventions, info: RATE, status }), { clauses: withStatus, info: null });
  assert.deepEqual(hintClauses({ conventions, status }), { clauses: withStatus, info: null });
  assert.deepEqual(hintClauses({}), { clauses: [], info: null });
});

test('a string splits into its name and the rest at the dash', () => {
  assert.deepEqual(infoClause('ORDER — tap the steps.'), ['ORDER', '— tap the steps.']);
  assert.deepEqual(infoClause('Plain words'), ['Plain words', '']);
  assert.deepEqual(infoAttrs('A — b.'), { 'data-info': 'A — b.', 'aria-description': 'A — b.' });
  assert.deepEqual(infoAttrs(undefined), {});
});

/* Just enough of a DOM for the listeners: a root that holds its listeners and
 * elements that know their nearest described ancestor. */
function fakeDom() {
  const listeners = {};
  const inside = new Set();
  const root = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: (type, fn) => { if (listeners[type] === fn) delete listeners[type]; },
    contains: (el) => inside.has(el),
  };
  const node = (info, { visible = true, parent = null } = {}) => {
    const el = {
      dataset: info ? { info } : {},
      closest: () => (info ? el : parent?.closest() ?? null),
      matches: () => visible,
    };
    inside.add(el);
    return el;
  };
  const fire = (type, e) => listeners[type]?.(e);
  return { root, node, fire, listeners };
}

test('the window\'s listeners: over, out, a held button, focus that is or is not visible', () => withInfo((info, timers) => {
  const { root, node, fire, listeners } = fakeDom();
  const unbind = bindInfo(root, info);
  const knob = node(RATE);
  const label = node(null, { parent: knob });
  const bare = node(null);
  const clicked = node(LENGTH, { visible: false });

  fire('pointerover', { target: label, buttons: 0 });
  assert.equal(info.text(), RATE, 'a child finds its described ancestor');
  fire('pointerover', { target: node(LENGTH), buttons: 1 });
  assert.equal(info.text(), RATE, 'a held button keeps what is being dragged');
  fire('pointerup', { target: bare });
  timers.advance(INFO_DELAY_MS);
  assert.equal(info.text(), null, 'released over nothing described');

  fire('pointerover', { target: knob, buttons: 0 });
  fire('pointerout', { target: knob, relatedTarget: bare, buttons: 0 });
  timers.advance(INFO_DELAY_MS);
  assert.equal(info.text(), RATE, 'out to an element inside the window is over\'s to decide');
  fire('pointerout', { target: knob, relatedTarget: null, buttons: 0 });
  timers.advance(INFO_DELAY_MS);
  assert.equal(info.text(), null, 'out of the window');

  fire('focusin', { target: knob });
  assert.equal(info.text(), RATE);
  fire('focusout', { target: knob });
  fire('focusin', { target: clicked });
  timers.advance(INFO_DELAY_MS);
  assert.equal(info.text(), null, 'a focus nobody sees is not shown');

  unbind();
  assert.deepEqual(Object.keys(listeners), []);
}));

test('an element outside the window is not the window\'s to describe', () => withInfo((info) => {
  const { root, fire } = fakeDom();
  const unbind = bindInfo(root, info);
  const stranger = { dataset: { info: RATE }, closest() { return this; } };
  fire('pointerover', { target: stranger, buttons: 0 });
  assert.equal(info.text(), null);
  unbind();
}));
