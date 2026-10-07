import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  FOLDER, folder, lazyFolder, isFolder, songNode, basics, buildCatalog,
  navStart, navTop, navRows, navCurrent, navPush, navPop, navPath, navRestore, nodeAt,
} from '../src/catalog.mjs';
import { parseManifest, parseCategories, parseExercise, validateExercise } from '../src/exercise_io.mjs';
import { MODES } from '../src/generator.mjs';
import { chartTotalBeats, beatsPerBar } from '../src/chart.mjs';
import { SCREEN_W } from '../src/layout.mjs';
import { CHORD_FAMILIES, PROGRESSIONS } from '../src/chord_lessons.mjs';

const twoHands = {
  id: 'song', name: 'Song', bpm: 90, timeSig: [4, 4], keySig: 0, source: 'file',
  events: [
    { beat: 0, durBeats: 1, hand: 'l', pitches: [57] },
    { beat: 0, durBeats: 1, hand: 'r', pitches: [69, 72] },
    { beat: 1, durBeats: 1, hand: 'r', pitches: [74] },
  ],
};
const oneNote = {
  id: 'drill', name: 'Drill', bpm: 90, timeSig: [4, 4], keySig: 0, source: 'file',
  events: [{ beat: 0, durBeats: 1, hand: 'r', pitches: [60] }],
};

const labels = (node) => node.children.map((c) => c.label);

/* Every leaf under `node`, with the path that reaches it. */
function leavesOf(node, path = [], out = []) {
  node.children.forEach((child, i) => {
    if (isFolder(child)) leavesOf(child, path.concat(i), out);
    else out.push({ node: child, path: path.concat(i) });
  });
  return out;
}

/* ---- Nodes --------------------------------------------------------------- */

test('a song with a ladder is a folder of its levels', () => {
  const node = songNode(twoHands);
  assert.equal(node.value, FOLDER);
  assert.deepEqual(labels(node), ['RH melody', 'LH bass', 'RH chords', 'Both hands']);
  assert.equal(node.children[3].build().name, 'Song L3');
});

test('a song with one rung arms straight away', () => {
  const node = songNode(oneNote);
  assert.equal(isFolder(node), false);
  assert.equal(node.value, 'f');
  assert.deepEqual(node.build().events[0].pitches, [60]);
});

test('a lazy folder is made once, on first look, and is a folder before that', () => {
  let made = 0;
  const node = lazyFolder('Lazy', () => { made++; return [{ label: 'x' }]; });
  assert.equal(isFolder(node), true);
  assert.equal(made, 0, 'asking whether it is a folder must not build it');
  assert.deepEqual(labels(node), ['x']);
  assert.deepEqual(labels(node), ['x']);
  assert.equal(made, 1);
});

test('isFolder is false for leaves and for nothing', () => {
  assert.equal(isFolder({ label: 'a', build() {} }), false);
  assert.equal(isFolder(null), false);
  assert.equal(isFolder(undefined), false);
});

/* ---- The tree ------------------------------------------------------------ */

test('Basics holds scales, chords, progressions and reading', () => {
  const b = basics({});
  assert.deepEqual(labels(b), ['Scales', 'Chords', 'Progressions', 'Reading']);
  assert.equal(b.children[0].children.length, Object.keys(MODES).length, 'one folder per Move scale');
  assert.deepEqual(labels(b.children[1]), CHORD_FAMILIES.map((f) => f.name));
  assert.deepEqual(labels(b.children[2]), PROGRESSIONS.map((p) => p.id));
});

test('every leaf of Basics builds a valid chart', () => {
  for (const { node, path } of leavesOf(basics({ rootPc: 7 }))) {
    const chart = node.build();
    const { ok, errors } = validateExercise(chart);
    assert.ok(ok, `${path.join('/')} ${node.label}: ${errors.join('; ')}`);
  }
});

test('categories come in manifest order, empty ones are left out, tail goes last', () => {
  const root = buildCatalog({
    songs: [{ chart: twoHands, category: 'b' }, { chart: oneNote, category: 'a' }],
    categories: [{ id: 'a', name: 'Ay' }, { id: 'empty', name: 'Empty' }, { id: 'b', name: 'Bee' }],
    tail: [{ label: 'Tail' }],
  });
  assert.deepEqual(labels(root), ['Basics', 'Ay', 'Bee', 'Tail']);
});

test('a file with no category, or an unknown one, lands in Other', () => {
  const root = buildCatalog({
    songs: [{ chart: twoHands, category: null }, { chart: oneNote, category: 'nope' }],
    categories: [{ id: 'a', name: 'Ay' }],
  });
  assert.deepEqual(labels(root), ['Basics', 'Other']);
  assert.deepEqual(labels(root.children[1]), ['Song', 'Drill']);
});

test('a manifest from before categories still lists every file', () => {
  const text = JSON.stringify({ exercises: [{ file: 'song.json' }] });
  const root = buildCatalog({
    songs: parseManifest(text).map((r) => ({ chart: twoHands, category: r.category })),
    categories: parseCategories(text),
  });
  assert.deepEqual(labels(root), ['Basics', 'Other']);
});

test('the bundled manifest files every exercise in a category, and none in Other', () => {
  const dir = new URL('../src/exercises/', import.meta.url);
  const text = readFileSync(new URL('index.json', dir), 'utf8');
  const categories = parseCategories(text);
  const songs = parseManifest(text).map((row) => ({
    chart: parseExercise(readFileSync(new URL(row.file, dir), 'utf8'), row.id).chart,
    category: row.category,
  }));
  const root = buildCatalog({ songs, categories });
  assert.equal(labels(root).indexOf('Other'), -1);
  const filed = root.children.slice(1).reduce((n, c) => n + c.children.length, 0);
  assert.equal(filed, songs.length);
});

/*
 * Every name fits the reading header beside the widest bar.beat the chart
 * reaches. The header truncates rather than overflowing, so a name that does
 * not fit loses its END — which for a projected chart is the " L3" that says
 * which level you are on. Measured with the 6px-per-character fallback the
 * stubbed host uses (view.mjs: the left cell is SCREEN_W - right - 6).
 */
test('every chart name fits the reading header, level and all', () => {
  const dir = new URL('../src/exercises/', import.meta.url);
  const text = readFileSync(new URL('index.json', dir), 'utf8');
  const songs = parseManifest(text).map((row) => ({
    chart: parseExercise(readFileSync(new URL(row.file, dir), 'utf8'), row.id).chart,
    category: row.category,
  }));
  /* C# for the key: a two-character root is the widest a generated name gets. */
  const root = buildCatalog({ songs, categories: parseCategories(text), gen: { rootPc: 1 } });
  const px = (str) => str.length * 6 - 1;
  for (const { node, path } of leavesOf(root)) {
    const chart = node.build();
    const bars = Math.ceil(chartTotalBeats(chart) / beatsPerBar(chart));
    const right = bars + '.' + beatsPerBar(chart);
    assert.ok(px(chart.name) <= SCREEN_W - px(right) - 6,
      `"${chart.name}" (${path.join('/')}) is cut off beside ${right}`);
  }
});

/* ---- Walking it ---------------------------------------------------------- */

const tree = () => folder('Root', [
  folder('A', [{ label: 'a1', build: () => 'a1' }, folder('A2', [{ label: 'deep' }])]),
  { label: 'leaf', build: () => 'leaf' },
]);

test('push opens the highlighted folder, and refuses a leaf', () => {
  const nav = navStart(tree());
  assert.equal(navPush(nav), true);
  assert.equal(navTop(nav).node.label, 'A');
  assert.deepEqual(navRows(nav).map((r) => r.label), ['a1', 'A2']);
  assert.equal(navPush(nav), false, 'a1 is a leaf');
  assert.equal(nav.length, 2);
});

test('pop goes up one, and not past the top', () => {
  const nav = navStart(tree());
  navPush(nav);
  assert.equal(navPop(nav), true);
  assert.equal(navPop(nav), false);
  assert.equal(nav.length, 1);
});

test('the cursor at each depth survives going down and back up', () => {
  const nav = navStart(tree());
  navPush(nav);
  navTop(nav).cursor = 1;
  navPush(nav);
  navPop(nav);
  assert.equal(navCurrent(nav).label, 'A2');
});

test('a rebuilt tree is walked back to the same place', () => {
  const nav = navStart(tree());
  navPush(nav);
  navTop(nav).cursor = 1;
  navPush(nav);
  const back = navRestore(tree(), navPath(nav));
  assert.deepEqual(back.map((f) => f.node.label), ['Root', 'A', 'A2']);
  assert.equal(navCurrent(back).label, 'deep');
});

test('a path into a tree that shrank lands somewhere valid', () => {
  const nav = navRestore(tree(), [7, 3, 9]);
  assert.equal(navTop(nav).cursor, 1, 'clamped to the last row');
  assert.equal(nav.length, 1, 'and the walk stopped at a leaf');
});

test('nodeAt finds a leaf by path, and null off the end', () => {
  assert.equal(nodeAt(tree(), [0, 0]).build(), 'a1');
  assert.equal(nodeAt(tree(), [1]).label, 'leaf');
  assert.equal(nodeAt(tree(), [1, 0]), null);
  assert.equal(nodeAt(tree(), [5]), null);
});
