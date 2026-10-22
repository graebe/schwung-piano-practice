// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * tips.mjs — the welcome, and the one-card tips shown the first time a kind
 * of screen appears. Pure: the words, and when they are due.
 *
 * What has been shown is kept in progress.tips (progress.mjs), a list of
 * keys, saved with the rest of the progress. Settings › Help › Show tips
 * again empties it.
 *
 * A card is { key, title, paragraphs, choices? }: paragraphs as the Info page
 * keeps them ({ text }), so the renderer wraps them to its own width. The
 * words are the shared spec's, word for word; a line of it that is wider than
 * the panel's 21 characters is wrapped, never reworded.
 */

export const WELCOME = 'welcome';
export const SHEET = 'sheet';
export const PRACTICE = 'practice';
export const QUIZ = 'quiz';
/* Shown once, after "I already play". */
export const PLACEMENT = 'placement';

export const MAP = 'map';
export const ISLAND = 'island';

export const TIP_KEYS = [WELCOME, SHEET, PRACTICE, QUIZ, MAP, ISLAND];

/* The welcome's choice, page 3. */
export const FROM_START = 0;
export const ALREADY_PLAY = 1;

const para = (text) => ({ text });

/* One paragraph per spec line that is a sentence of its own. */
const TIPS = {
  [SHEET]: { title: 'Tip', paragraphs: [para('Options for this row. JOG choose, CLICK do it, BACK close.')] },
  [PRACTICE]: { title: 'Tip', paragraphs: [para('REC plays and scores it, PLAY lets you listen first. MENU: help.')] },
  [QUIZ]: { title: 'Tip', paragraphs: [para('Answer with the lit pads or the jog. MENU: help.')] },
  [MAP]: { title: 'Tip', paragraphs: [para('Lit pads are places. Press one to walk there, again to go in. PLAY continues.')] },
  [ISLAND]: { title: 'Tip', paragraphs: [para('Each place is part of the stage. The fort is its checkpoint.')] },
  [PLACEMENT]: {
    title: 'Tip',
    paragraphs: [para('Know a stage already? SHIFT+CLICK a stage, then Test out: checkpoint. Pass it and the path moves on.')],
  },
};

export function tipCard(key) {
  const t = TIPS[key];
  return t ? { key, title: t.title, paragraphs: t.paragraphs.slice() } : null;
}

/*
 * The welcome, three pages. `name` is the module's ("Piano Practice"), `what`
 * its instrument ("piano") and `first` what a beginner starts from ("note").
 * Page 2 is a table, so its lines are kept as lines.
 */
export function welcomePages(name = 'Piano Practice', what = 'piano', first = 'note') {
  return [
    {
      key: WELCOME,
      title: 'Welcome',
      paragraphs: [para(name + ' takes you from your first ' + first + ' to pro, one step a day.')],
    },
    /* A page of its own: a welcome page never scrolls, and the two together
     * are six lines. */
    {
      key: WELCOME,
      title: 'Welcome',
      paragraphs: [para('Lit pads can be pressed.')],
    },
    {
      key: WELCOME,
      title: 'Keys',
      /* The keys in a column one space narrower than the shared text: at
       * seven, "MENU   help, anywhere" is wider than a page of text. */
      paragraphs: [
        para('JOG   move'), para('CLICK open'), para('BACK  up one level'),
        para('MENU  help, anywhere'), para('SHIFT+CLICK  options'),
      ],
      lines: true,
    },
    {
      key: WELCOME,
      title: 'New to ' + what + '?',
      paragraphs: [],
      choices: ['From the start', 'I already play'],
    },
  ];
}

/*
 * Whether the welcome is due at start-up:
 *   'show'    never welcomed, and nothing played yet
 *   'silent'  never welcomed, but a learner already: mark it, show nothing
 *   null      welcomed before
 */
export function welcomeDue(seen, hasHistory) {
  if (seen) return null;
  return hasHistory ? 'silent' : 'show';
}
