// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * catalog.mjs — the lesson tree, and how the list walks it. Pure.
 *
 * A node is a FOLDER, { label, value: '>', children }, or a LEAF that does
 * something when opened: { label, value, build } arms a chart, and the
 * session gives the quiz and progress leaves their own fields. There is one
 * list on screen and one way through it — a song's ladder is just a folder
 * whose children are its levels, where it used to be a second list with its
 * own state and its own Back rules.
 *
 *   ...lead     what the caller puts first: Continue and the Path
 *   Practice    the free library, generated here: Scales, Chords,
 *               Progressions, Random, then Songs
 *     Songs     one folder per category in index.json, in its order, and
 *               Other: files whose category is missing or unknown
 *   ...after    the Quiz
 *   ...tail     Progress and Settings
 *
 * Practice keeps the key `basics`, which is what its rows' ids start with, so
 * renaming the folder moved nobody's progress. Other exists for the files a
 * user drops in by hand. install.sh keeps them across an update but replaces
 * index.json, so whatever category they had is gone — they must still be
 * somewhere in the list.
 */

import { LEVELS, availableLevels, projectLevel } from './levels.mjs';
import { MODES, MODE_LABELS, scaleDrills, readingDrills, randomInKey, playableRange } from './generator.mjs';
import {
  CHORD_FAMILIES, RANDOM_POOLS,
  qualityLesson, inversionLesson, slashLesson, randomChordSong,
} from './chord_lessons.mjs';
import { LESSON_PROGRESSIONS, progressionLesson } from './progressions.mjs';
import { DEFAULT_TRANSPOSE } from './padmap.mjs';

/* The value column of a row that opens something. */
export const FOLDER = '>';

export function folder(label, children, key) {
  const node = { label, value: FOLDER, children };
  if (key) node.key = key;
  return node;
}

/*
 * A folder whose rows are made the first time it is opened. The chord lessons
 * are forty-odd songs, voiced chord by chord, and the tree is rebuilt every
 * time the key or the transpose changes — building all of them on every turn
 * of the Key knob would be work for folders nobody is looking at.
 */
export function lazyFolder(label, make, key) {
  let rows = null;
  const node = {
    label,
    value: FOLDER,
    /* Rows made after the tree was stamped are stamped as they appear, so an
     * id never depends on whether a folder happened to be opened. */
    get children() {
      if (!rows) {
        rows = make();
        if (this.id !== undefined) stampChildren(rows, this.id);
      }
      return rows;
    },
  };
  if (key) node.key = key;
  return node;
}

/* Asked without opening it: `in` sees the getter without calling it. */
export function isFolder(node) {
  return Boolean(node && typeof node === 'object' && 'children' in node);
}

/*
 * A piece with a ladder is one row, not a folder: it arms straight away, and
 * the ready screen's jog chooses the level (and Guided or Solo). Each level
 * keeps its own entry — `levels`, never shown as rows — with its own id,
 * build and progress, exactly as it had as a row of the ladder folder, and a
 * way back to the piece (`piece`).
 */
export function ladderLeaf(label, key, levels) {
  const node = { label, value: '', key, levels: [] };
  node.levels = levels.map((lv) => ({ ...lv, value: '', piece: node }));
  return node;
}

/* A rung as ladderLeaf takes it: its code leads the name. */
const rung = (lv, build) => ({ label: lv.step + ' ' + lv.label, key: lv.id, step: lv.step, name: lv.label, build });

/*
 * A song: its ladder as one row. A song with only one rung — nothing to
 * split, like a melody with no left hand — is a plain row.
 */
export function songNode(song) {
  const levels = availableLevels(song);
  if (levels.length > 1) {
    return ladderLeaf(song.name, song.id, levels.map((lv) => rung(lv, () => projectLevel(song, lv.id))));
  }
  return {
    label: song.name,
    value: '',
    key: song.id,
    build: () => (levels.length ? projectLevel(song, levels[0].id) : null) || song,
  };
}

/*
 * A Basics lesson is a recipe, not fixed notes: it is built from the key and
 * the transpose. projectLevel stamps every chart 'file', which in ui.js means
 * "keep your own tempo, and never rebuild me" — right for a song, wrong here,
 * where turning the Key knob with a progression armed must re-key it, and a
 * new transpose must move a chord lesson with the pads.
 */
function generated(node) {
  if (isFolder(node)) {
    node.children.forEach(generated);
    return node;
  }
  if (node.levels) {
    node.levels.forEach(generated);
    return node;
  }
  const build = node.build;
  node.build = () => {
    const chart = build();
    if (chart) chart.source = 'generated';
    return chart;
  };
  return node;
}

function leaves(drills) {
  return drills.map((d) => ({ label: d.label, value: '', build: d.build }));
}

/* ---- Ids -------------------------------------------------------------------- */

/*
 * Every node gets a stable id: its parent's id, a slash, and its own key — the
 * slugged label unless something steadier is given. Progress is filed under
 * it, so it must not move when the key, the octave or the folder layout does:
 * a progression's id is its shape, not its tonic, and a bundled song's is its
 * manifest id alone, so moving it to another category keeps what you did.
 */
export function slug(label) {
  return String(label).toLowerCase().replace(/[^a-z0-9#]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

function stampNode(node, parentId) {
  const key = node.key || slug(node.label);
  node.id = node.absolute ? key : (parentId ? parentId + '/' + key : key);
  /* A ladder's levels are filed under it, as the rows of its folder were. */
  if (node.levels) stampChildren(node.levels, node.id);
  if (!('children' in node)) return;
  /* A lazy folder stamps its own rows when they are made; asking for them
   * here would build every lesson in the tree. */
  const desc = Object.getOwnPropertyDescriptor(node, 'children');
  if (desc && desc.get) return;
  stampChildren(node.children, node.id);
}

export function stampChildren(rows, parentId) {
  for (let i = 0; i < rows.length; i++) stampNode(rows[i], parentId);
}

/*
 * Basics › Random: notes and chords drawn fresh each time a row is opened.
 *
 * `gen.newSeed` is the caller's source of new seeds; without one every build
 * uses `gen.seed`, which is what keeps the tests deterministic. A chord set
 * gets the same ladder as a song — the bass, the shapes, both hands — and each
 * rung is a new set: there is nothing to carry from one rung to the next in
 * chords nobody chose.
 */
export function randomFolder(gen = {}) {
  const transpose = gen.transpose == null ? DEFAULT_TRANSPOSE : gen.transpose;
  const seed = () => (gen.newSeed ? gen.newSeed() : gen.seed || 1);
  const { lo, hi } = playableRange(transpose);
  const chordSet = (label, pool) => generated(ladderLeaf(label, slug(label), LEVELS.map((lv) => rung(lv, () => {
    const chart = projectLevel(randomChordSong({ seed: seed(), pool, transpose }), lv.id);
    chart.name = label + ' ' + lv.step;
    return chart;
  }))));
  return folder('Random', [
    {
      label: 'All notes',
      value: '',
      /* Every pitch the pads reach, black keys and all, in a walk wide enough to
       * cover the whole page rather than the eight steps a reading line keeps to. */
      build: () => ({
        ...randomInKey({ ...gen, mode: 'chromatic', bars: 8, span: hi - lo + 1, seed: seed() }),
        name: 'All notes',
      }),
    },
    ...leaves(readingDrills(gen)).map((d, i) => ({
      ...d,
      label: i ? 'In key, fast' : 'In key',
      build: () => readingDrills({ ...gen, seed: seed() })[i].build(),
    })),
    chordSet('All chords', RANDOM_POOLS.all),
    chordSet('Triads', RANDOM_POOLS.triads),
    chordSet('Sevenths', RANDOM_POOLS.sevenths),
  ]);
}

/*
 * A trainer: five circles, the same for every subject (trainer.mjs). Read,
 * Hear and Play open a setup page and a round; Learn is the subject's lessons,
 * as they were; Stats its items, weakest first.
 *
 * `learn` keeps the id its folder always had — `learnId`, stamped absolute —
 * so moving the lessons under the trainer moved nobody's progress: the chord
 * lessons are basics/chords/... whatever folder holds them.
 */
export function trainerFolder(subject, label, learn, learnId) {
  learn.label = 'Learn';
  /* Its list says whose lessons they are: "Learn" alone could be any. */
  learn.title = label + ': learn';
  learn.key = learnId;
  learn.absolute = true;
  const circle = (c, name) => ({ label: name, value: '', key: c, trainer: { subject, circle: c } });
  return folder(label, [
    circle('read', 'Read'),
    circle('hear', 'Hear'),
    circle('play', 'Play'),
    learn,
    { label: 'Stats', value: '', key: 'stats', trainerStats: subject },
  ], subject + '-trainer');
}

/*
 * Practice (the folder was Basics, and keeps its key). What the settings
 * decide — the key, the transpose — is captured when the tree is built, which
 * the session does again whenever one of them changes. `more` is appended:
 * the Songs folder.
 */
export function basics(gen = {}, more = []) {
  const transpose = gen.transpose == null ? DEFAULT_TRANSPOSE : gen.transpose;
  const scales = () => Object.keys(MODES).map((mode) =>
    folder(MODE_LABELS[mode], leaves(scaleDrills({ ...gen, mode })), mode));

  const families = () => CHORD_FAMILIES.map((fam) => lazyFolder(fam.name, () => {
    let songs;
    if (fam.slash) songs = [slashLesson(transpose)];
    else if (fam.inversions) songs = fam.inversions.map((q) => inversionLesson(q, transpose));
    else songs = fam.qualities.map((q) => qualityLesson(q, transpose));
    return songs.map((song) => generated(songNode(song)));
  }));

  const progressions = () => LESSON_PROGRESSIONS.map((p) => {
    const node = generated(songNode(progressionLesson(p, gen.rootPc || 0, transpose)));
    /* The list names the shape, the header names it in a key: "I-V-vi-IV"
     * reads the same in every key, "G I-V-vi-IV" is what you are playing. */
    node.label = p.id;
    /* Case kept: I-IV-V-I and i-iv-v-i are different progressions. */
    node.key = p.id.replace(/\s+/g, '-');
    return node;
  });

  return folder('Practice', [
    trainerFolder('scale', 'Scales', lazyFolder('Scales', scales), 'basics/scales'),
    trainerFolder('chord', 'Chords', lazyFolder('Chords', families), 'basics/chords'),
    lazyFolder('Progressions', progressions),
    randomFolder(gen),
  ].concat(more), 'basics');
}

/* A bundled song's id is its manifest id alone, wherever it is filed. */
export function fileSongNode(chart) {
  const node = songNode(chart);
  node.key = 'song:' + chart.id;
  node.absolute = true;
  return node;
}

/*
 * The whole tree.
 *   songs       [{ chart, category }] — the parsed files, in manifest order
 *   categories  [{ id, name }] — display order
 *   gen         generator options from the settings
 *   lead        nodes before Practice
 *   after       nodes straight after Practice
 *   tail        nodes appended at the end
 */
export function buildCatalog({
  songs = [], categories = [], gen = {}, lead = [], after = [], tail = [],
} = {}) {
  const known = {};
  for (let i = 0; i < categories.length; i++) known[categories[i].id] = [];
  const other = [];
  for (let i = 0; i < songs.length; i++) {
    const s = songs[i];
    (known[s.category] || other).push(fileSongNode(s.chart));
  }
  const shelves = [];
  for (let i = 0; i < categories.length; i++) {
    const rows = known[categories[i].id];
    if (rows.length) shelves.push(folder(categories[i].name, rows, categories[i].id));
  }
  if (other.length) shelves.push(folder('Other', other, 'other'));
  const more = shelves.length ? [folder('Songs', shelves, 'songs')] : [];
  const children = lead.concat([basics(gen, more)], after);
  /* The top of the list, named for the instrument as Drums Practice names its. */
  const root = folder('Piano', children.concat(tail));
  /* Its rows are stamped without a prefix; its own id only names it to a cache. */
  root.id = '~';
  stampChildren(root.children, '');
  return root;
}

/*
 * Every leaf in the tree by id, with a readable title for it. This opens every
 * lazy folder, so it is built only when something has to be found by id — a
 * step of the program, a repetition — and kept until the tree is rebuilt.
 *
 * The title adds the folder a leaf sits in when the leaf's own label is only
 * meaningful there: "L1 RH melody" says nothing without its song, while a song
 * in a category is already its own name.
 */
export function leafIndex(root) {
  const index = new Map();
  const walk = (node, parent, depth) => {
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i];
      if (isFolder(child)) {
        if (!child.untracked) walk(child, child, depth + 1);
        continue;
      }
      /* A program step is a pointer at a row, not the row. */
      if (!child.id || child.step || index.has(child.id)) continue;
      /* A ladder is its levels, each under its old id and title. */
      if (child.levels) {
        for (const lv of child.levels) index.set(lv.id, { node: lv, title: child.label + ' ' + lv.label });
        continue;
      }
      index.set(child.id, { node: child, title: titleOf(child, parent, depth) });
    }
  };
  walk(root, null, 0);
  return index;
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

/* Up one folder. False at the top, where Back means leave. The cursor is
 * clamped: a folder can lose a row while you are inside another (Review goes
 * once nothing is due). */
export function navPop(nav) {
  if (nav.length <= 1) return false;
  nav.pop();
  const top = navTop(nav);
  top.cursor = Math.max(0, Math.min(top.cursor, top.node.children.length - 1));
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

/* A folder whose rows are only made when asked for (lazyFolder). */
export function isLazy(node) {
  const desc = Object.getOwnPropertyDescriptor(node, 'children');
  return Boolean(desc && desc.get);
}

/* A song filed in a category is its own name (its id is absolute); a rung of
 * a ladder or a drill in a scale's folder needs the folder's name with it. */
function titleOf(child, parent, depth) {
  return parent && depth > 1 && !child.absolute ? parent.label + ' ' + child.label : child.label;
}

/*
 * One row by id, as { node, title }, or null. Cheaper than leafIndex: a lazy
 * folder is only opened when the id says it is on the way — turning the Key
 * knob with a chord lesson armed rebuilds the tree, and finding the lesson in
 * it again must not voice the other forty.
 */
export function findById(root, id) {
  const walk = (node, depth) => {
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i];
      if (!isFolder(child)) {
        if (child.levels) {
          const lv = child.levels.find((l) => l.id === id);
          if (lv) return { node: lv, title: child.label + ' ' + lv.label };
          continue;
        }
        if (child.id === id && !child.step) return { node: child, title: titleOf(child, node === root ? null : node, depth) };
        continue;
      }
      if (child.untracked) continue;
      if (isLazy(child) && !(child.id && id.indexOf(child.id + '/') === 0)) continue;
      const hit = walk(child, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return id ? walk(root, 1) : null;
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
