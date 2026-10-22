// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * words.js — the session's announcements, in the page's words. Pure.
 *
 * The session speaks for the Move, where "jog", "click" and "the pads" are
 * the controls under your hands. The page has buttons, keys and a keyboard,
 * so the few phrases that name a Move control are said its way instead.
 * web/test/app_logic.test.mjs fails if the session gains a phrase naming a
 * Move control that is not covered here.
 */
export const PHRASES = [
  [' Listen, then jog to the answer and click.', ' Listen, then choose the answer.'],
  [' Read it, then jog to the answer and click.', ' Read it, then choose the answer.'],
  ['Name the lit pad. Jog to choose, click to answer.', 'Name the lit key. Choose an answer.'],
  [' Press play to start.', ' Listen or Practice to start.'],
  ['The pads stay dark.', 'Nothing lights: read it.'],
  ['The pads light up.', 'The next notes light up.'],
];

export function inPageWords(text) {
  let out = String(text || '');
  for (const [move, page] of PHRASES) out = out.split(move).join(page);
  return out;
}
