// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * icons.mjs — the home screen's icons, two sizes each: `small` (9 rows) sits
 * in a ring of r 9, `large` (13 rows) in the selected disc of r 12.
 *
 * Authored as ASCII rows ('#' lit), because that is the only sane way to edit
 * 1-bit art; render.mjs compiles them into rectangles once. An icon is drawn
 * centred on its circle, so an odd width keeps it on the pixel grid.
 *
 * The practice icon differs between the modules, so it is not in ICONS: each
 * module passes its own on the item ({ icon: PRACTICE_PIANO }). Both live
 * here so the folder stays byte-identical in Piano and Drums Practice.
 *
 * Pure: no imports. Vendored byte for byte into Drums Practice.
 */

/* Path: the map's own island -- a dome hill on a beach that tapers into the
 * sea at both ends, a flag on its shoulder; at 13 px the route's dots lead in. */
const PATH = {
  small: [
    '.........',
    '...###...',
    '...###...',
    '...#.....',
    '...###...',
    '..#####..',
    '.#######.',
    '#.......#',
    '.........',
  ],
  large: [
    '....####.....',
    '....####.....',
    '....#........',
    '....#........',
    '....####.....',
    '...#######...',
    '..#########..',
    '..#########..',
    '..#########..',
    '.###########.',
    '#...........#',
    '.............',
    '#.#.#........',
  ],
};

/* Quiz: a question mark. */
const QUIZ = {
  small: [
    '..#####..',
    '.##...##.',
    '.##...##.',
    '.....##..',
    '....##...',
    '....##...',
    '.........',
    '....##...',
    '....##...',
  ],
  large: [
    '....#####....',
    '...##...##...',
    '..##.....##..',
    '..##.....##..',
    '.........##..',
    '........##...',
    '.......##....',
    '......##.....',
    '......##.....',
    '.............',
    '......##.....',
    '......##.....',
    '.............',
  ],
};

/* Progress: three rising bars. */
const PROGRESS = {
  small: [
    '......##.',
    '......##.',
    '......##.',
    '...##.##.',
    '...##.##.',
    '...##.##.',
    '##.##.##.',
    '##.##.##.',
    '##.##.##.',
  ],
  large: [
    '..........###',
    '..........###',
    '..........###',
    '..........###',
    '.....###..###',
    '.....###..###',
    '.....###..###',
    '.....###..###',
    '###..###..###',
    '###..###..###',
    '###..###..###',
    '###..###..###',
    '###..###..###',
  ],
};

/* Settings: a gear. */
const SETTINGS = {
  small: [
    '...###...',
    '.#.###.#.',
    '..#####..',
    '###...###',
    '###...###',
    '###...###',
    '..#####..',
    '.#.###.#.',
    '...###...',
  ],
  large: [
    '.....###.....',
    '.##..###..##.',
    '.###########.',
    '..#########..',
    '.####...####.',
    '####.....####',
    '####.....####',
    '####.....####',
    '.####...####.',
    '..#########..',
    '.###########.',
    '.##..###..##.',
    '.....###.....',
  ],
};

export const ICONS = Object.freeze({ path: PATH, quiz: QUIZ, progress: PROGRESS, settings: SETTINGS });

/* Practice, Drums: two sticks crossed in an X over a snare's head, their tips
 * past the rim on both sides. */
export const PRACTICE_DRUMS = Object.freeze({
  small: [
    '.........',
    '##.....##',
    '..##.##..',
    '....#....',
    '..#####..',
    '##.....##',
    '.#######.',
    '.#.....#.',
    '.#######.',
  ],
  large: [
    '.............',
    '.##.......##.',
    '...##...##...',
    '.....#.#.....',
    '......#......',
    '..#########..',
    '.#.##...##.#.',
    '###.......###',
    '#.#########.#',
    '#...........#',
    '#...........#',
    '.###########.',
    '.............',
  ],
});

/* Practice, Piano: three white keys and the black keys between them. */
export const PRACTICE_PIANO = Object.freeze({
  small: [
    '#########',
    '#.##.##.#',
    '#.##.##.#',
    '#.##.##.#',
    '#.#..#..#',
    '#.#..#..#',
    '#.#..#..#',
    '#.#..#..#',
    '#########',
  ],
  large: [
    '#############',
    '#..###.###..#',
    '#..###.###..#',
    '#..###.###..#',
    '#..###.###..#',
    '#..###.###..#',
    '#..###.###..#',
    '#...#...#...#',
    '#...#...#...#',
    '#...#...#...#',
    '#...#...#...#',
    '#...#...#...#',
    '#############',
  ],
});
