/*
 * catalog.mjs — the lesson tree, and how the list walks it. Pure.
 *
 * A node is a FOLDER, { label, value: '>', children }, or a LEAF that does
 * something when opened: { label, value, build } arms a chart, and ui.js gives
 * the quiz and progress leaves their own fields. There is one list on screen
 * and one way through it — a song's ladder is just a folder whose children are
 * its levels, where it used to be a second list with its own state and its own
 * Back rules.
 *
 *   Basics      generated here: scales, chords, progressions, reading
 *   ...         one folder per category in index.json, in its order
 *   Other       files whose category is missing or unknown, if there are any
 *   ...tail     what the caller appends: Quiz and Progress
 *
 * Other exists for the files a user drops in by hand. install.sh keeps them
 * across an update but replaces index.json, so whatever category they had is
 * gone — they must still be somewhere in the list.
 */

import { availableLevels, projectLevel } from './levels.mjs';
import { MODES, MODE_LABELS, scaleDrills, readingDrills } from './generator.mjs';
import {
  CHORD_FAMILIES, PROGRESSIONS,
  qualityLesson, inversionLesson, slashLesson, progressionLesson,
} from './chord_lessons.mjs';
import { DEFAULT_TRANSPOSE } from './padmap.mjs';

/* The value column of a row that opens something. */
export const FOLDER = '>';

export function folder(label, children) {
  return { label, value: FOLDER, children };
}

/*
 * A folder whose rows are made the first time it is opened. The chord lessons
 * are forty-odd songs, voiced chord by chord, and the tree is rebuilt every
 * time the key or the transpose changes — building all of them on every turn
 * of the Key knob would be work for folders nobody is looking at.
 */
export function lazyFolder(label, make) {
  let rows = null;
  return {
    label,
    value: FOLDER,
    get children() {
      if (!rows) rows = make();
      return rows;
    },
  };
}

/* Asked without opening it: `in` sees the getter without calling it. */
export function isFolder(node) {
  return Boolean(node && typeof node === 'object' && 'children' in node);
}

/*
 * A song opens its ladder. A song with only one rung — nothing to split, like a
 * melody with no left hand — arms straight away, marked 'f' for "file".
 */
export function songNode(song) {
  const levels = availableLevels(song);
  if (levels.length > 1) {
    return folder(song.name, levels.map((lv) => ({
      label: lv.label,
      value: lv.step,
      build: () => projectLevel(song, lv.id),
    })));
  }
  return {
    label: song.name,
    value: 'f',
    build: () => (levels.length ? projectLevel(song, levels[0].id) : null) || song,
  };
}

function leaves(drills) {
  return drills.map((d) => ({ label: d.label, value: '', build: d.build }));
}

/*
 * Basics. What the settings decide — the key, the transpose — is captured when
 * the tree is built, which ui.js does again whenever one of them changes.
 */
export function basics(gen = {}) {
  const transpose = gen.transpose == null ? DEFAULT_TRANSPOSE : gen.transpose;
  const scales = () => Object.keys(MODES).map((mode) =>
    folder(MODE_LABELS[mode], leaves(scaleDrills({ ...gen, mode }))));

  const families = () => CHORD_FAMILIES.map((fam) => lazyFolder(fam.name, () => {
    let songs;
    if (fam.slash) songs = [slashLesson(transpose)];
    else if (fam.inversions) songs = fam.inversions.map((q) => inversionLesson(q, transpose));
    else songs = fam.qualities.map((q) => qualityLesson(q, transpose));
    return songs.map(songNode);
  }));

  const progressions = () => PROGRESSIONS.map((p) => {
    const node = songNode(progressionLesson(p, gen.rootPc || 0, transpose));
    /* The list names the shape, the header names it in a key: "I-V-vi-IV"
     * reads the same in every key, "G I-V-vi-IV" is what you are playing. */
    node.label = p.id;
    return node;
  });

  return folder('Basics', [
    lazyFolder('Scales', scales),
    lazyFolder('Chords', families),
    lazyFolder('Progressions', progressions),
    folder('Reading', leaves(readingDrills(gen))),
  ]);
}

/*
 * The whole tree.
 *   songs       [{ chart, category }] — the parsed files, in manifest order
 *   categories  [{ id, name }] — display order
 *   gen         generator options from the settings
 *   tail        nodes appended at the end
 */
export function buildCatalog({ songs = [], categories = [], gen = {}, tail = [] } = {}) {
  const known = {};
  for (let i = 0; i < categories.length; i++) known[categories[i].id] = [];
  const other = [];
  for (let i = 0; i < songs.length; i++) {
    const s = songs[i];
    (known[s.category] || other).push(songNode(s.chart));
  }
  const children = [basics(gen)];
  for (let i = 0; i < categories.length; i++) {
    const rows = known[categories[i].id];
    if (rows.length) children.push(folder(categories[i].name, rows));
  }
  if (other.length) children.push(folder('Other', other));
  return folder('Exercise', children.concat(tail));
}

/* ---- Walking the tree --------------------------------------------------- */

/*
 * The walk is a stack of { node, cursor }: the folders you are inside, and
 * where the highlight sits in each. Back pops; it never has to remember where
 * you came from because the stack already is that.
 */
export function navStart(root) {
  return [{ node: root, cursor: 0 }];
}

export function navTop(nav) {
  return nav[nav.length - 1];
}

export function navRows(nav) {
  return navTop(nav).node.children;
}

export function navCurrent(nav) {
  const top = navTop(nav);
  return top.node.children[top.cursor] || null;
}

/* Into the highlighted folder. False when the highlight is not a folder. */
export function navPush(nav) {
  const node = navCurrent(nav);
  if (!isFolder(node)) return false;
  nav.push({ node, cursor: 0 });
  return true;
}

/* Up one folder. False at the top, where Back means leave. */
export function navPop(nav) {
  if (nav.length <= 1) return false;
  nav.pop();
  return true;
}

/* The cursor at every depth — enough to find the same place in a new tree. */
export function navPath(nav) {
  return nav.map((f) => f.cursor);
}

/*
 * The same walk through a REBUILT tree. Changing the key rebuilds every
 * generated lesson, and the open folders would otherwise still be the old
 * tree's. Cursors are clamped, and the walk stops early if a folder is gone,
 * so a tree that changed shape lands somewhere valid rather than nowhere.
 */
export function navRestore(root, path) {
  const nav = navStart(root);
  for (let i = 0; i < path.length; i++) {
    const top = navTop(nav);
    top.cursor = Math.max(0, Math.min(top.node.children.length - 1, path[i]));
    if (i === path.length - 1) break;
    if (!navPush(nav)) break;
  }
  return nav;
}

/* The node a path ends on, or null. */
export function nodeAt(root, path) {
  let node = root;
  for (let i = 0; i < path.length; i++) {
    if (!isFolder(node)) return null;
    node = node.children[path[i]];
    if (!node) return null;
  }
  return node;
}
