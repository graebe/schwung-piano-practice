// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * hints.mjs — what the keys do on every screen, as one table. Pure.
 *
 * The footer of every screen says which keys work there, in the Move's own
 * names: a key in capitals, then its verb, two spaces between pairs —
 * "CLICK open  BACK up". The same table feeds the Keys section of MENU's help
 * page, so the line and the help can never disagree.
 *
 *   keysFor(screen, state)  -> { keys: ['CLICK open', ...], shift: ['CLICK options', ...] }
 *   hintFor(screen, state)  -> the footer as parts of at most 21 characters;
 *                              with state.shift, the Shift layer instead
 *   hintPart(parts, now)    -> the part to show now: they take turns, 3 s each
 *
 * `screen` is the session's view (session.mjs, VIEWS); `state` says what the
 * view alone cannot: whether the list is the top one, the stage armed, what
 * kind of quiz is open, and so on. Each field is optional.
 */

/* One row of the panel: 21 characters of the 6 px font. */
export const HINT_CHARS = 21;
/* How long each part of a hint that does not fit is shown. */
export const ROTATE_MS = 3000;

/* The session's view names (session.mjs). Mirrored rather than imported:
 * session.mjs imports this file. */
const MENU = 'menu';
const READY = 'ready';
const RUNNING = 'running';
const SETTINGS = 'settings';
const GUESS = 'guess';
const SUMMARY = 'summary';
const PROGRESS = 'progress';
const PROGRESS_DETAIL = 'progress-detail';
const INFO = 'info';
const SHEET = 'sheet';
const CARD = 'card';
/* A folder of the Path drawn as its map: the session's MENU, on a map. */
const MAP = 'map';
/* The top of the list drawn as five circles (src/home/). */
const HOME = 'home';
/* A scene of the Learning Path (pathmap/scenes.mjs): any key skips it. */
const ANIM = 'anim';

/* Shift+Back leaves the module from anywhere (ui.js). */
const QUIT = 'BACK quit';

function table(screen, s) {
  switch (screen) {
    case MENU:
      return {
        keys: s.top ? ['CLICK open', 'MENU help'] : ['CLICK open', 'BACK up'],
        shift: ['CLICK options', QUIT],
      };
    case MAP:
      return { keys: ['PAD go', 'CLICK enter', 'PLAY continue', 'MENU help'], shift: ['CLICK options', QUIT] };
    case HOME:
      return { keys: ['JOG choose', 'CLICK open', 'PAD open', 'MENU help'], shift: ['CLICK options', QUIT] };
    case SHEET:
      return { keys: ['CLICK do it', 'BACK close'], shift: [QUIT] };
    case ANIM:
      return { keys: ['ANY KEY skip'], shift: [QUIT] };
    case INFO:
      return { keys: s.scrolls ? ['JOG scroll', 'BACK close'] : ['BACK close'], shift: [QUIT] };
    case CARD:
      if (s.choice) return { keys: ['JOG choose', 'CLICK ok'], shift: [QUIT] };
      if (s.pages > 1) return { keys: ['JOG page', 'CLICK go on'], shift: [QUIT] };
      return { keys: s.scrolls ? ['JOG scroll', 'CLICK go on'] : ['CLICK go on', 'BACK close'], shift: [QUIT] };
    case READY: {
      /* The level and the way it is played are named on the bottom line's
       * left (session.levelInfo); the keys take turns on its right. */
      const keys = [];
      if (s.stages) keys.push(s.levels > 1 ? 'JOG level' : s.stage === 2 ? 'JOG Guided' : 'JOG Solo');
      keys.push('REC start', 'PLAY listen');
      return { keys, shift: ['CLICK settings', QUIT] };
    }
    case RUNNING: {
      const own = s.listening ? 'PLAY' : 'REC';
      /* The footer is the only place that says the music is paused. */
      if (s.paused) return { keys: ['PAUSED', own + ' go on', 'BACK stop'], shift: ['CLICK settings', QUIT] };
      return { keys: [own + ' pause', 'BACK stop'], shift: ['CLICK settings', QUIT] };
    }
    case SUMMARY: {
      const keys = [s.twoNext ? 'CLICK Solo' : 'CLICK next', 'REC again'];
      if (s.quiz) keys.push('JOG page');
      return { keys, shift: ['CLICK skip', QUIT] };
    }
    case GUESS: {
      const keys = [];
      if (s.ear) keys.push(s.hintsLeft ? 'PAD answer' : 'PAD or JOG', s.hintsLeft ? 'REC help' : 'CLICK ok');
      else if (s.pick) keys.push('JOG pick', s.hintsLeft ? 'REC help' : 'CLICK ok');
      else keys.push('PAD play', s.hintsLeft ? 'REC help' : 'PLAY hear');
      if (s.streak !== undefined && !s.pick && !s.ear) keys.push('streak ' + s.streak);
      return { keys, shift: [QUIT] };
    }
    case SETTINGS:
      if (s.editing) return { keys: ['JOG change', 'CLICK ok'], shift: [QUIT] };
      return { keys: [s.open ? 'CLICK open' : s.action ? 'CLICK do it' : 'CLICK edit', 'BACK up'],
        shift: ['CLICK close', QUIT] };
    case PROGRESS:
      return { keys: ['CLICK chart', 'BACK up'], shift: [QUIT] };
    case PROGRESS_DETAIL:
      return { keys: ['JOG next', 'BACK list'], shift: [QUIT] };
    default:
      return null;
  }
}

/*
 * What a screen is, in a sentence or two: how MENU's help opens, before its
 * keys and before anything about the row or piece in front of you.
 */
function about(screen, s) {
  switch (screen) {
    case MENU:
      return s.top
        ? 'Home, as a list: the Learning Path, the free library to practise, the quiz, your progress and the settings. BACK shows the circles again.'
        : 'A folder of the list. A row with > opens another folder; any other row opens what it holds.';
    case HOME:
      if (s.ring === 'basics') {
        return 'Practice: the free library, as circles: scales, chords, progressions, random drills and songs. The jog chooses, CLICK opens; so does the circle\'s lit pad. BACK goes home.';
      }
      if (s.ring === 'quiz') {
        return 'Quiz: short rounds, as circles: Ear, name what you hear; Reading, off the staff; Keys, names and pads. The jog chooses, CLICK opens; so does the circle\'s lit pad. BACK goes home.';
      }
      return 'Home: the Learning Path, the free library to practise, the quiz, your progress and the settings, as five circles. The jog chooses, CLICK opens; so does the circle\'s lit pad.';
    case MAP:
      return 'The map: a lit pad is a place. Press one to walk there, again to go in; the jog walks too, CLICK goes in, PLAY continues. SHIFT+CLICK shows it as a list.';
    case SHEET:
      return 'The options of a row: what you can do with it besides opening it. Only what applies is offered.';
    case ANIM:
      return 'A moment on the Learning Path: a place done, the walk to the next one, a stage, a level learned. Any key or pad skips it.';
    case INFO:
      return 'Help for the screen you came from.';
    case CARD:
      return s.choice
        ? 'A question: pick the answer that fits you. You can change your mind in the settings.'
        : 'A card, shown once. Settings > Advanced > Help shows the tips and the welcome again.';
    case READY:
      return 'A piece, armed and waiting. REC plays it and scores you; PLAY lets you listen first. The jog picks Guided, with the pads lit, or Solo, reading alone.';
    case RUNNING:
      return 'The piece is running. Play each note as it reaches the line.';
    case SUMMARY:
      return 'Your result: the score, and how it compares with the times before.';
    case GUESS:
      return s.ear ? 'A listening round: name what you hear.'
        : s.pick ? 'A round of naming: name what the lit pads play.'
          : 'A round: play what is asked, on the pads.';
    case SETTINGS:
      return 'Settings: the few that are yours, the octave, the click, the key and scale, where the path starts; Advanced holds the rest. The jog picks a row; CLICK edits it, the jog changes it, CLICK again when done.';
    case PROGRESS:
      return 'Your progress: overall, each stage, then everything you have played.';
    case PROGRESS_DETAIL:
      return 'A chart of one row of Progress. The jog shows the next.';
    default:
      return '';
  }
}

/* The start of a help page: what the screen is, and its keys, the Shift
 * layer among them. */
export function screenHelp(screen, state = {}) {
  return { about: about(screen, state || {}), keys: keyLines(screen, state) };
}

/* Every screen also answers MENU with its help, and the help page says so. */
export function keysFor(screen, state = {}) {
  const t = table(screen, state || {});
  if (!t) return null;
  return { keys: t.keys.slice(), shift: t.shift.slice() };
}

/*
 * Pairs into parts, greedily, two spaces between pairs: as many as fit in one
 * row, then a new part. A single pair longer than a row is cut, which no
 * entry of the table is (a test holds it to that).
 */
export function pack(units, max = HINT_CHARS) {
  const parts = [];
  let line = '';
  for (let i = 0; i < units.length; i++) {
    const u = units[i].slice(0, max);
    const next = line ? line + '  ' + u : u;
    if (next.length > max && line) {
      parts.push(line);
      line = u;
    } else {
      line = next;
    }
  }
  if (line) parts.push(line);
  return parts;
}

/* The footer's parts. While Shift is held, what Shift does here, each part
 * saying so: "SHIFT: CLICK options". */
export function hintFor(screen, state = {}) {
  const k = keysFor(screen, state);
  if (!k) return [];
  if (state && state.shift) return pack(k.shift.map((u) => 'SHIFT: ' + u));
  return pack(k.keys);
}

/* The part showing at `now` (ms): one part stays put, more take turns. */
export function hintPart(parts, now) {
  if (!parts || !parts.length) return '';
  if (parts.length === 1) return parts[0];
  return parts[Math.floor(Math.max(0, now) / ROTATE_MS) % parts.length];
}

/* The keys as the help page lists them, MENU and the Shift layer included. */
export function keyLines(screen, state = {}) {
  const k = keysFor(screen, state);
  if (!k) return [];
  const own = k.keys.filter((u) => /^[A-Z]+ /.test(u));
  const menu = screen === INFO ? 'MENU close' : 'MENU help';
  const lines = own.indexOf(menu) < 0 ? own.concat([menu]) : own;
  return lines.concat(k.shift.map((u) => 'SHIFT+' + u));
}
