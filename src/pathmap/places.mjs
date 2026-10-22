// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * places.mjs — the buildings that stand on an island map.
 *
 * On the world map a place is an island; inside a stage it is a building on
 * that one island. Each module's adapter picks a kind per place (drums by
 * track, piano by the unit's strand); this file only draws them.
 *
 * Authored as ASCII rows in the same 15x11 box as every other place glyph
 * (render.mjs pads them), as one set: a 45 degree roof pitch, 1 px strokes,
 * the base on row 8, the body inside columns 0..8 so the avatar stands clear
 * of it beside the door (columns 10..14), and the flag pole in column 2
 * landing on the roof.
 *
 * Legend, as for the islands: '#' wall, always drawn; 'o' wall that fills from
 * the bottom with the place's percentage (walls only: roofs stay open, so a
 * finished building keeps its roof line); 'x' a detail drawn as the inverse of
 * the fill behind it (the bell, the clock's hands, the text on the sign...),
 * so it reads on an empty building and a full one alike; '.' never drawn.
 *
 * Pure: no imports. Vendored byte for byte into Drums Practice.
 */

export const BUILDINGS = Object.freeze({
  /* A signpost: a board with lines of text and an arrow tip, on a post. */
  sign: [
    '..........',
    '..........',
    '..........',
    '#######...',
    '#xxxxo##..',
    '#ooooooo#.',
    '#xxxoo##..',
    '#######...',
    '...#......',
  ],
  /* A bell tower: a bell hanging under a peaked roof. */
  bell: [
    '..........',
    '.....#....',
    '....#.#...',
    '...#...#..',
    '..#######.',
    '..#ooxoo#.',
    '..#oxxxo#.',
    '..#oxxxo#.',
    '..#######.',
  ],
  /* A clock: a round face with its hands. */
  clock: [
    '..........',
    '..........',
    '....###...',
    '...#ooo#..',
    '..#oxooo#.',
    '..#oxxxo#.',
    '..#ooooo#.',
    '...#ooo#..',
    '....###...',
  ],
  /* A workshop: a house with a chimney and a hammer over the door. */
  workshop: [
    '..........',
    '.....#....',
    '....#.#.#.',
    '...#...##.',
    '..#######.',
    '..#xxxoo#.',
    '..#oxo..#.',
    '..#oxo..#.',
    '..####..#.',
  ],
  /* A festival stage: a gable on two posts, bunting under its eave, a
   * platform; the back wall and the platform light up. */
  stage: [
    '..........',
    '.....#....',
    '....#.#...',
    '...#...#..',
    '..#######.',
    '..#.#.#.#.',
    '..#ooooo#.',
    '..#######.',
    '..#ooooo#.',
  ],
  /* A library: a house with an open book over its columns and door. */
  library: [
    '..........',
    '.....#....',
    '....#.#...',
    '...#...#..',
    '..#######.',
    '..#xxoxx#.',
    '..#o#.#o#.',
    '..#o#.#o#.',
    '.########.',
  ],
  /* A temple: three columns under a triangle -- a triad -- on a base that
   * lights up. */
  temple: [
    '..........',
    '.....#....',
    '....#.#...',
    '...#...#..',
    '..#######.',
    '...#.#.#..',
    '...#.#.#..',
    '..#ooooo#.',
    '..#ooooo#.',
  ],
  /* Stairs: a tower whose steps climb up its side. */
  stairs: [
    '..........',
    '......###.',
    '......#o#.',
    '....###o#.',
    '....#ooo#.',
    '..###ooo#.',
    '..#ooooo#.',
    '###ooooo#.',
    '#########.',
  ],
  /* A market stall: a striped awning over a counter, on a grid floor. */
  market: [
    '..........',
    '..........',
    '..........',
    '..#######.',
    '.##.##.##.',
    '##.##.##..',
    '.#ooooo#..',
    '.#ooooo#..',
    '#.#.#.#.#.',
  ],
});

/*
 * The fort and the chest on an island: the world's glyphs (render.mjs), their
 * base lifted to row 8 like every building, so they stand on the land rather
 * than on a spit running into the sea.
 */
export const ISLAND_VARIANTS = Object.freeze({
  fort: [
    '..........',
    '..........',
    '..........',
    '#.#.#.#.#.',
    '#ooooooo#.',
    '#ooooooo#.',
    '#ooooooo#.',
    '#ooo.ooo#.',
    '####.####.',
  ],
  cove: [
    '..........',
    '..........',
    '..........',
    '..#####...',
    '.#ooooo#..',
    '###xxx###.',
    '#oooxooo#.',
    '#ooooooo#.',
    '#########.',
  ],
});

/* Kinds that draw as another: the drums Lessons hut is now a signpost. */
export const ALIASES = Object.freeze({ hut: 'sign' });
