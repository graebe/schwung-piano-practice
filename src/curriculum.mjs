// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * curriculum.mjs — the learning path as data. Pure.
 *
 * Five phases, each a few weeks of work with one promise; each phase is units
 * of one skill strand; each unit is exercises; each exercise is one step or a
 * few (a course unit heard and then read). A step is only a pointer at a row of
 * the lesson tree, by the id progress.mjs files its results under, so a piece
 * played from Classics counts on the path too.
 *
 * Everything the learner reads about the path lives here as well: a phase's
 * promise and idea, what a unit is for, what an exercise asks and why it is
 * there. The Info pages read it, and tools/docs.mjs writes docs/curriculum.md
 * from it, so the words and the steps cannot drift apart.
 *
 * Written for adults: music they know or respect, chords early, the reason
 * before the drill. Nursery songs stay in Classics and off the path.
 */

import { drillId, drillLabel } from './stats.mjs';
import { exerciseByKey, isNaming } from './ear.mjs';
import { COURSES } from './ear_course.mjs';
import { LEVELS } from './levels.mjs';

/* ---- Steps ---------------------------------------------------------------- */

const SCALES = 'basics/scales/';
const CHORDS = 'basics/chords/';
const PROGS = 'basics/progressions/';
const RANDOM = 'basics/random/';

export const N = 'notes';
export const C = 'chords';
export const EAR = 'ear';

const scale = (mode, drill, title) => ({ id: SCALES + mode + '/' + drill, title });
const chord = (family, lesson, level, title) => ({ id: CHORDS + family + '/' + lesson + '/' + level, title });
const prog = (id, level, title) => ({ id: PROGS + id + '/' + level, title });
const random = (row, title) => ({ id: RANDOM + row, title });
const tune = (song, level, title) => ({ id: 'song:' + song + '/' + level, title });

/*
 * A quiz step pins its options for the round, whatever the settings say, so
 * the step asks the same thing for everyone who reaches it. `read` is how a
 * Play drill shows its prompt: 'name' or 'staff'.
 */
export function quiz(opts) {
  const q = opts.kind === EAR ? {
    kind: EAR, exercise: opts.exercise, level: opts.level, hear: true, pick: true,
  } : {
    kind: opts.kind,
    hear: Boolean(opts.hear),
    pick: Boolean(opts.pick),
    read: opts.read || null,
    halfTones: Boolean(opts.halfTones),
    chordSet: opts.chordSet || 'triads',
  };
  const id = 'quiz:' + drillId(q);
  return { id, label: drillLabel(drillId(q)), quiz: q };
}

const ear = (exercise, level, title) => ({ ...quiz({ kind: EAR, exercise, level }), title });

/*
 * A level of a hearing or reading exercise, as a step. Inside its folder the
 * path already says which drill it is, so the row is the level alone, or the
 * medium and the level: "Hear up", "Read up". The drill label is its title.
 */
export function levelStep(ex, lv, medium) {
  const step = quiz(isNaming(ex) ? { kind: EAR, exercise: ex.key, level: lv.key } : lv.quiz);
  return { ...step, title: step.label, label: medium ? medium + ' ' + lv.name : lv.name };
}

export const levelSteps = (ex, medium) => ex.levels.map((lv) => levelStep(ex, lv, medium));

/*
 * A course unit on the path, trimmed to the levels that teach: an Identify
 * unit heard every way and read once; a Compare unit heard once easy and once
 * in full (comparing on the staff is counting lines, not a skill of its own).
 * Every other level stays in Quiz › Hear and Quiz › Read.
 */
export function courseSteps(key) {
  const ex = exerciseByKey(key);
  const levels = ex.levels;
  if (key.indexOf('cmp-') === 0) {
    const pick = levels.length > 1 ? [levels[0], levels[levels.length - 1]] : levels;
    return pick.map((lv) => levelStep(ex, lv, 'Hear'));
  }
  const read = exerciseByKey('rd-' + key);
  return levels.map((lv) => levelStep(ex, lv, 'Hear')).concat([levelStep(read, read.levels[0], 'Read')]);
}

const courseShort = (key) => COURSES.flatMap((c) => c.exercises).find((e) => e.key === key).short;

/* ---- Exercises and units --------------------------------------------------- */

/* A song's level as its row, the way the song lists name it: "L2 RH chords". */
function rungLabel(id) {
  const lv = LEVELS.find((l) => id.endsWith('/' + l.id));
  return lv ? lv.step + ' ' + lv.label : id;
}

/* One thing the learner does, as one step or a few. A single step takes the
 * exercise's label as its row; several are named by level or medium. */
function ex(label, about, why, steps) {
  const list = Array.isArray(steps) ? steps : [steps];
  return {
    label,
    about,
    why,
    steps: list.map((s) => ({
      ...s,
      label: list.length === 1 ? label : (s.label || rungLabel(s.id)),
      title: s.title || label,
    })),
  };
}

const course = (label, key, about, why) => ex(label, about, why, courseSteps(key));
const unit = (key, name, strand, after, purpose, exercises, summary) => ({ key, name, strand, after, purpose, exercises, summary });

export const STRANDS = {
  grid: 'Grid',
  read: 'Read',
  chords: 'Chords',
  ear: 'Ear',
  pieces: 'Pieces',
  hands: 'Hands',
  scales: 'Scales',
};

/* What the strands train, for the docs and the Info pages. */
export const STRAND_TEXT = {
  grid: 'finding notes on the pads',
  read: 'staff to pads',
  chords: 'chord shapes and progressions',
  ear: 'hearing',
  pieces: 'repertoire',
  hands: 'two hands together',
  scales: 'scales and modes',
};

/* ---- The phases ----------------------------------------------------------- */

function phase1() {
  return {
    key: 'p1',
    name: 'Grid and staff',
    title: 'The grid, the staff, a melody',
    promise: 'You can find any note on the grid, read C major from the staff, and play Ode to Joy from the score.',
    idea: 'On the Move every interval has one shape wherever it starts: a step to the right is a semitone, a row up is a fourth. So the major scale has one pattern, and once your hand knows it, it knows every key. On a piano you would learn twelve. Stage 1 reads in C major with the right hand, because the grid and the staff are both new; Black keys then adds the other five notes, so the chord shapes after it can go round all twelve roots.',
    check: ['basics/scales/major/up-down', 'basics/random/in-key', 'song:ode-to-joy/1r', 'quiz:staff:notes:key'],
    units: [
      unit('find-notes', 'Find the notes', 'grid', [], 'Getting from a note\'s name to its pad without counting.', [
        ex('Notes by alphabet', 'The screen shows a name (E, A ...). You press that note.',
          'Chord charts, tutorials and other musicians say note names, not pad positions. This turns a name into a place under your hand.',
          quiz({ kind: N, read: 'name' })),
        ex('Name notes', 'A pad lights up. You pick its name.',
          'The same link from the other side: you need it when a video or your own ear tells you what you just played.',
          quiz({ kind: N, pick: true })),
      ]),
      unit('hearing-basics', 'Hearing basics', 'ear', [], 'Your ear will check your hands from now on.', [
        ex('High or low: wide', 'Two notes. Was the second higher or lower?',
          'Trivial until notes come fast. Everything else in Ear builds on this one judgement.',
          ear('direction', 'wide', 'High or low, wide')),
        ex('High or low: close', 'The same with notes a step or two apart.',
          'Close notes are where untrained ears flip direction, and where playing goes wrong unnoticed.',
          ear('direction', 'narrow', 'High or low, close')),
        ex('Step or leap', 'Was the move a step (a 2nd) or a leap?',
          'What you read in Steps and leaps, now heard. Reading and hearing a skill together makes it stick.',
          ear('steps', 'key', 'Step or leap')),
        ex('Melody shape', 'Three notes: up-up, up-down, down-up or down-down?',
          'Melodies are remembered as shapes. Hearing the shape is the first step to playing a tune by ear.',
          ear('contour', 'key', 'Melody shape')),
        ex('Play it back', 'A note of the key sounds. Find it on the pads.',
          'The key skill on the Move: from sound to pad. It starts with the seven notes of the key, so the answer is always a pad you know.',
          quiz({ kind: N, hear: true })),
      ]),
      unit('major-scale', 'Major scale', 'scales', [], 'The scale is the alphabet everything else is spelled in.', [
        ex('Major up & down', 'Play C major up one octave and back down, one note per beat.',
          'It is the shape your hand reuses for every key, melody and chord in the weeks ahead. Up and back in one go makes it one movement, not two halves.',
          scale('major', 'up-down', 'Major up & down')),
        ex('Major down', 'The same scale, top to bottom only.',
          'Downwards is where beginners stumble: the notes fall and the pattern runs backwards. Practising it alone fixes the weak half.',
          scale('major', 'down', 'Major down')),
      ]),
      unit('steps-leaps', 'Steps and leaps', 'read', ['major-scale'], 'Reading notes as distances, not as single letters.', [
        ex('Major thirds', 'Read pairs a third apart (line to line, or space to space) and play them.',
          'Fluent readers see "a third up" and move instead of naming every note. A third is also half a chord.',
          scale('major', 'thirds', 'Major thirds')),
        ex('Major fifths', 'The same with fifths.',
          'The fifth is the interval of nearly every bass line and power chord, and on the grid a shape you will see a thousand times.',
          scale('major', 'fifths', 'Major fifths')),
        ex('Random in key', 'A random melody in C, one note per beat.',
          'The first music you cannot have memorised: it tests the reading, not your memory of a tune.',
          random('in-key', 'Random in key')),
      ]),
      unit('read-staff', 'Read the staff', 'read', ['steps-leaps'], 'Reading single notes quickly, in any order.', [
        ex('Notes by staff', 'A note appears on the staff. Press it.',
          'A melody is read in time and in its order. This quiz has neither, so it drills each note alone until it is instant.',
          quiz({ kind: N, read: 'staff' })),
      ]),
      unit('black-keys', 'Black keys', 'grid', ['find-notes'], 'All twelve notes, and your first key signature.', [
        ex('Alphabet, all notes', 'Names now include sharps and flats (F#, Bb). Press them.',
          'Chords on all twelve roots, and most songs, leave C major. This extends Find the notes to all twelve.',
          quiz({ kind: N, read: 'name', halfTones: true })),
        ex('Name all notes', 'A pad lights. Name it, sharps and flats included.',
          'The same in reverse, and you learn that F# and Gb are one pad with two names.',
          quiz({ kind: N, pick: true, halfTones: true })),
        ex('Chromatic', 'Every semitone for an octave.',
          'On the grid it is single steps to the right, and every five steps the row above carries on: how simply the Move lays out the twelve notes.',
          scale('chromatic', 'up-down', 'Chromatic')),
        ex('Auld Lang Syne', 'The tune in A major: three sharps, a third of its notes black keys.',
          'Your first melody with a key signature. The sharps are written once at the start and you have to remember them, as in every real score.',
          tune('auld-lang-syne', '1r', 'Auld Lang Syne melody')),
      ]),
      unit('first-chords', 'First chords', 'chords', ['black-keys'], 'Three notes at once: the sound of every song you know.', [
        ex('Major triad', 'A major chord on all twelve roots, round the circle of fifths, right hand.',
          'Twelve chords, one shape. On a piano you would learn twelve hand positions; this is where the grid pays off most.',
          chord('triads', 'chord-maj', '2r', 'Major triad')),
        ex('Minor triad', 'The same with minor chords.',
          'Major against minor is the first real difference in colour: one note moves and the mood changes.',
          chord('triads', 'chord-min', '2r', 'Minor triad')),
        ex('Hear major or minor', 'A chord, one note at a time. Major or minor?',
          'Hearing the colour you just played. Broken first, because one note at a time is easier to follow.',
          ear('triads', 'broken', 'Maj/min, broken')),
        ex('Hear it as a chord', 'The same, all notes at once.',
          'That is how chords sound on a record, so this is the version that counts.',
          ear('triads', 'block', 'Maj/min, block')),
      ]),
      unit('first-melodies', 'First melodies', 'pieces', ['major-scale'], 'Real music from week one.', [
        ex('Ode to Joy', 'Beethoven\'s theme, right hand, 72 bpm. It moves by step throughout, with one dotted rhythm.',
          'The ideal first piece: you know how it should sound, it uses only the scale you just learned, and it is no children\'s song.',
          tune('ode-to-joy', '1r', 'Ode to Joy melody')),
        ex('When the Saints', '104 bpm, but only 19 notes, with long notes and rests. It leaps up to a fifth.',
          'Your first leaps inside a tune, and your first rests: you learn to count through silence instead of rushing on.',
          tune('when-the-saints', '1r', 'Saints melody')),
        ex('Amazing Grace', '3/4, 76 bpm, 16 notes, all white keys.',
          'A first taste of three beats to the bar, slow enough to feel the lilt. Its leaps are the ones you just read.',
          tune('amazing-grace', '1r', 'Amazing Grace melody')),
      ]),
    ],
  };
}

function phase2() {
  return {
    key: 'p2',
    name: 'Four chords',
    title: 'Four chords and both hands',
    promise: 'You can play the four chords behind half of pop music, the chords of a track you know, and a melody with both hands.',
    idea: 'A key has three major chords, on the 1st, 4th and 5th notes of its scale (I, IV, V), and a minor one, its relative, on the 6th (vi). V wants to go home to I; that pull is what makes a song feel finished. Most songs you know use these four chords in some order.',
    check: ['basics/progressions/I-V-vi-IV/3', 'song:ode-to-joy/3', 'basics/scales/minor/up-down', 'quiz:ear:id-3rds:together'],
    units: [
      unit('intervals-1', 'Intervals I', 'ear', ['hearing-basics'], 'Hearing the distance between two notes, the raw material of melody.', [
        course('Name 2nds', 'id-2nds', 'Minor or major second? Heard up, down and together, then read.',
          'The smallest steps of every melody. Half step or whole step is the difference between major and minor scales.'),
        course('Compare 2nds', 'cmp-2nds', 'Two intervals. Which is bigger, or are they the same?',
          'Comparing is easier than naming: it trains the judgement before the label.'),
        course('Name 3rds', 'id-3rds', 'Minor or major third?',
          'The third decides whether a chord is major or minor: First chords, heard.'),
        course('Compare 3rds', 'cmp-3rds', 'Which third is bigger?', 'The same idea, a size up.'),
        course('Name 2nds, 3rds', 'id-2-3', 'All four at once.', 'The real test: no hint which family it is.'),
        course('Compare M2 and m3', 'cmp-M2-m3', 'A major second against a minor third, a semitone apart.',
          'The pair ears confuse most, singled out so the confusion does not travel on.'),
      ]),
      unit('i-iv-v', 'I-IV-V', 'chords', ['first-chords'], 'The three chords that make a key.', [
        ex('Major, both hands', 'Major chords round the circle: the root in the left hand, the chord in the right.',
          'The left hand takes the bass, its job in almost all keyboard music. It starts here, on single notes.',
          chord('triads', 'chord-maj', '3', 'Major, both hands')),
        ex('Minor, both hands', 'The same with minor chords.',
          'Same movement, other colour: the shape is in your hands, not in one chord.',
          chord('triads', 'chord-min', '3', 'Minor, both hands')),
        ex('I-IV-V-I shapes', 'The cadence in C, right hand, two beats per chord.',
          'Your first progression. You feel V pull back to I, and see the IV and V shapes sit right next to I.',
          prog('I-IV-V-I', '2r', 'I-IV-V-I shapes')),
        ex('I-IV-V-I both hands', 'The same, with the bass.',
          'The full cadence the way a pianist plays it: the ending of a thousand songs.',
          prog('I-IV-V-I', '3', 'I-IV-V-I both hands')),
        ex('Chords by name', 'The screen names one of the key\'s seven chords (C, Dm, Em, F, G, Am, B dim). Play it.',
          'Lead sheets are written like this, and the seven chords of a key cover most simple songs. B dim is the odd one; Sus and power explains it.',
          quiz({ kind: C, read: 'name' })),
      ]),
      unit('left-hand', 'Left hand', 'pieces', ['first-melodies'], 'A left hand that can do something on its own.', [
        ex('I-IV-V-I bass', 'The roots of the cadence, left hand only.',
          'A first left-hand line with no melody competing for attention.',
          prog('I-IV-V-I', '1l', 'I-IV-V-I bass')),
        ex('Ode to Joy bass', 'The bass line of your first piece, left hand alone.',
          'You know the tune, so you can hear whether the bass fits under it.',
          tune('ode-to-joy', '1l', 'Ode to Joy bass')),
        ex('Saints bass', 'The same for When the Saints.',
          'More movement than Ode: the left hand starts to go places.',
          tune('when-the-saints', '1l', 'Saints bass')),
        ex('Amazing Grace bass', 'The same for Amazing Grace, in 3/4.',
          'A bass note per bar in three: the left hand learns to wait.',
          tune('amazing-grace', '1l', 'Amazing Grace bass')),
      ]),
      unit('four-chords', 'Four chords', 'chords', ['i-iv-v'], 'The progressions of pop music.', [
        ex('I-V-vi-IV', 'The "four-chord song" progression in C, both hands.',
          'It is behind countless hits; you recognise it the moment you play it.',
          prog('I-V-vi-IV', '3', 'I-V-vi-IV')),
        ex('vi-IV-I-V', 'The same four chords, starting on the minor one.',
          'Same chords, different start, different mood: darker, more anthemic. Order changes meaning.',
          prog('vi-IV-I-V', '3', 'vi-IV-I-V')),
        ex('Name chords', 'One of the key\'s chords lights up. Name it.',
          'The reverse of Chords by name: what you need to write down what you just played or found.',
          quiz({ kind: C, pick: true })),
      ]),
      unit('minor', 'Minor', 'scales', ['major-scale', 'black-keys'], 'The other half of music\'s colour.', [
        ex('Minor up & down', 'C natural minor: Eb, Ab and Bb make it dark.',
          'Darker music, and most electronic music, lives in minor. On the grid it is the major pattern started from its 6th step, so your hand half knows it.',
          scale('minor', 'up-down', 'Minor up & down')),
        ex('Minor thirds', 'Thirds within the minor scale.',
          'The reading skill of Steps and leaps in a new scale, so the scale settles in your hand without a new task.',
          scale('minor', 'thirds', 'Minor thirds')),
        ex('i-iv-V-i', 'The minor cadence with a major V, both hands.',
          'The V borrows one raised note, the leading tone, to pull home. That is why harmonic minor exists, and you hear it before you are told.',
          prog('i-iv-V-i', '3', 'i-iv-V-i')),
        ex('Major or minor key', 'A melody plays. Is it in a major or a minor key?',
          'Telling a key\'s mood from a tune is what you will do with every song you want to learn by ear.',
          ear('key-quality', 'melody', 'Major or minor key')),
        course('Scales: maj or min', 'sc-maj-min', 'A scale plays. Major or natural minor? Heard going up and down, then read.',
          'The same difference as a whole scale; reading it too lets you tell the two apart in a score as quickly as by ear.'),
      ]),
      unit('both-hands', 'Both hands', 'hands', ['left-hand', 'i-iv-v'], 'The moment it starts to sound like piano.', [
        ex('Ode to Joy', 'Melody and bass together.',
          'Both hands already know their part; the only new thing is putting them together, which is how two hands are learned.',
          tune('ode-to-joy', '3', 'Ode to Joy L3')),
        ex('When the Saints', 'The same.',
          'The hands now move at different times: a long note in one, a moving line in the other.',
          tune('when-the-saints', '3', 'Saints L3')),
        ex('Amazing Grace', 'The same, in 3/4.',
          'Both hands in three, ready for the waltzes and 6/8 pieces of Stage 3.',
          tune('amazing-grace', '3', 'Amazing Grace L3')),
      ]),
      unit('first-tracks', 'First tracks', 'pieces', ['four-chords'], 'Sounding like a record, from the chords of real tracks.', [
        ex('Pop Ballad', 'A slow ballad in C (76 bpm) on I-V-vi-IV, voiced with smooth inversions: chords, then both hands.',
          'The progression you just learned in a real arrangement, and the first full arrangement you play.',
          [tune('pop-ballad', '2r', 'Pop Ballad L2'), tune('pop-ballad', '3', 'Pop Ballad L3')]),
        ex('Teardrop', 'Massive Attack, 77 bpm, a chord every two beats, in A: chords, then both hands.',
          'A track you know, slow and even. Its chords keep A on the bottom while the bass moves A, G, D: voicings Stage 3 explains.',
          [tune('track-teardrop', '2r', 'Teardrop L2'), tune('track-teardrop', '3', 'Teardrop L3')]),
        ex('Porcelain', 'Moby, 95 bpm, half-note chords in three flats: chords, then both hands.',
          'The first track in a flat key. The chords are long and calm, so the key is the only new thing.',
          [tune('track-porcelain', '2r', 'Porcelain L2'), tune('track-porcelain', '3', 'Porcelain L3')]),
      ]),
    ],
  };
}

function phase3() {
  return {
    key: 'p3',
    name: 'Shapes and time',
    title: 'Shapes, three-four, and the sound of a key',
    promise: 'You can voice chords smoothly, play in 3/4 and 6/8, and hear where a tune is going.',
    idea: 'A chord\'s notes can be stacked in any order. Inversions let each chord move to the next by the smallest step: that is how records voice chords, and why Teardrop\'s chords looked different. Meanwhile the ear moves from single notes to whole keys: where is home, and how far away is the tune?',
    check: ['basics/chords/inversions/inversions-maj/2r', 'song:greensleeves/3', 'basics/random/in-key-fast', 'quiz:ear:id-to-5:together'],
    units: [
      unit('intervals-2', 'Intervals II', 'ear', ['intervals-1'], 'The bigger intervals that frame melodies and bass lines.', [
        course('Name 4th 5th 8ve', 'id-4-5-8', 'Name the interval.', 'The perfect intervals: the frame of every bass line and power chord.'),
        course('Compare 5th and 4th', 'cmp-4-5', 'Which is bigger?', 'The classic confusion: a 4th up lands where a 5th down does.'),
        course('Compare 4th, TT', 'cmp-4-TT', 'Which is bigger?', 'The tritone sits a semitone off each: the most unstable sound in music.'),
        course('Compare 5th, TT', 'cmp-5-TT', 'Which is bigger?', 'The other side of the tritone.'),
        course('Compare 4th TT 5th', 'cmp-4-TT-5', 'Any two of the three.', 'All three together, with no hint.'),
        course('Name to the 5th', 'id-to-5', 'Any interval from a minor 2nd to a 5th.', 'Intervals I and II together: the range of most melodies.'),
        course('Compare to the 5th', 'cmp-to-5', 'Which is bigger, from the whole range?', 'The judgement at full width.'),
      ]),
      unit('inversions', 'Inversions', 'chords', ['i-iv-v'], 'Smooth chord changes.', [
        ex('Major inversions', 'Each major chord in root position, first and second inversion, round the circle.',
          'Three shapes per chord, the same three in every key. After this the track studies\' chords stop being mysterious.',
          chord('inversions', 'inversions-maj', '2r', 'Major inversions')),
        ex('Minor inversions', 'The same for minor.', 'It completes the set every pop progression needs.',
          chord('inversions', 'inversions-min', '2r', 'Minor inversions')),
      ]),
      unit('harmony-ear', 'Harmony by ear', 'ear', ['first-chords', 'hearing-basics'], 'Hearing what the chords are doing.', [
        ex('Maj/min, inverted', 'A major or minor chord in any inversion.', 'The colour stays when the order changes; your ear learns to hear through the voicing.',
          ear('triads', 'inversions', 'Maj/min, inverted')),
        ex('Four triads, broken', 'Major, minor, diminished or augmented, one note at a time.', 'All the triads of Sus and power, now heard.',
          ear('four-triads', 'broken', 'Four triads, broken')),
        ex('Four triads, block', 'The same, all notes at once.', 'The version that sounds like music.',
          ear('four-triads', 'block', 'Four triads, block')),
        ex('Home or away', 'A phrase ends. Does it sound finished or unfinished?', 'The pull from V to I, now as a judgement: how you will find a song\'s key by ear.',
          ear('home', 'major', 'Home or away')),
        ex('Degrees 1 3 5', 'A note sounds in a key. Root, third or fifth?', 'The chord tones of I against the key: the start of hearing melody as degrees, which transpose to any key.',
          ear('degrees', '135', 'Scale degrees 1 3 5')),
      ]),
      unit('sus-power', 'Sus and power', 'chords', ['inversions'], 'The colours between major and minor.', [
        ex('Sus2', 'The third replaced by the 2nd.', 'Neither major nor minor: open and floating, everywhere in pads.',
          chord('sus-power', 'chord-sus2', '2r', 'Sus2')),
        ex('Sus4', 'The third replaced by the 4th.', 'Tension that wants to resolve to the major chord: a classic cadence colour.',
          chord('sus-power', 'chord-sus4', '2r', 'Sus4')),
        ex('Power chords', 'Root and fifth only, both hands.', 'The sound of rock and of many techno basses: no third, so no mood, just weight.',
          chord('sus-power', 'chord-5', '3', 'Power chords')),
        ex('Diminished triad', 'Two minor thirds stacked.', 'The chord on the 7th note of major (vii) and the 2nd of minor (ii): it completes the key\'s chords.',
          chord('triads', 'chord-dim', '2r', 'Diminished triad')),
        ex('Augmented triad', 'Two major thirds stacked.', 'Rare, but it completes the four triad types; hear it once and you will find it in film scores.',
          chord('triads', 'chord-aug', '2r', 'Augmented triad')),
        ex('Random triads', 'Random major, minor, diminished and augmented chords, right hand.',
          'A loop can be memorised; random chords cannot. This checks that you build all four triads.',
          random('triads/2r', 'Random triads')),
      ]),
      unit('modes-1', 'Modes I', 'scales', ['minor'], 'The scales of folk, funk, blues and most dance music.', [
        ex('Dorian', 'Minor with a raised 6th.', 'The minor of funk, soul and many house tracks, brighter than natural minor.', scale('dorian', 'up-down', 'Dorian up & down')),
        ex('Mixolydian', 'Major with a lowered 7th.', 'The major of rock and many house hooks: less finished than major.', scale('mixolydian', 'up-down', 'Mixolydian up & down')),
        ex('Lydian', 'Major with a raised 4th.', 'The dreamy film-score major, played before you hear it in the quiz.', scale('lydian', 'up-down', 'Lydian up & down')),
        ex('Major pentatonic', 'Five notes, no half steps.', 'No wrong note over a major chord: the basis of improvising.', scale('majorPent', 'up-down', 'Maj pentatonic')),
        ex('Minor pentatonic', 'Its minor twin.', 'The scale of nearly every guitar solo and most synth leads.', scale('minorPent', 'up-down', 'Min pentatonic')),
        ex('Minor blues', 'Minor pentatonic plus the blue note.', 'One added note that gives the blues its sound.', scale('minorBlues', 'up-down', 'Minor blues')),
        ex('i-iv-v-i modal', 'The minor cadence with a minor v, both hands.', 'The softer modal ending of folk and electronic music, against Stage 2\'s i-iv-V-i.',
          prog('i-iv-v-i-modal', '3', 'i-iv-v-i modal')),
        course('Scales: 3 majors', 'sc-maj-lyd-mix', 'Major, Lydian or Mixolydian? Heard up and down, then read.', 'The three majors differ by one note each; hearing that note is the skill.'),
        course('Scales: pentatonic', 'sc-pent', 'Major or minor pentatonic? Heard up and down, then read.', 'The same five-note shape seen from two homes.'),
      ]),
      unit('progressions', 'Progressions', 'chords', ['four-chords'], 'The progressions of the next few hundred songs.', [
        ex('I-vi-IV-V', 'The fifties progression, both hands.', 'The four chords in another order. Now that you know them, a new order costs minutes, not weeks.',
          prog('I-vi-IV-V', '3', 'I-vi-IV-V')),
        ex('i-VI-III-VII', 'The minor four-chord loop, both hands.', 'The same four chords as I-V-vi-IV seen from the minor side: the most common loop in electronic music.',
          prog('i-VI-III-VII', '3', 'i-VI-III-VII')),
        ex('Synthwave', '100 bpm, A minor: Am F C G under a running eighth-note melody.', 'The minor loop in a style piece, with a melody that keeps moving while the chords stay.',
          tune('synthwave', '3', 'Synthwave L3')),
        ex('Minor Trap', '80 bpm, D minor: the same loop with syncopated chords.', 'The same progression in a new key and rhythm: the loop\'s shape does not depend on the key.',
          tune('minor-trap', '3', 'Minor Trap L3')),
        ex('Lofi Sunday', '72 bpm, F major, I-iii-vi-IV with mixed rhythms.', 'Slow, so the rhythm is the challenge: dotted values, chords held for a whole bar.',
          tune('lofi-sunday', '3', 'Lofi Sunday L3')),
        ex('Indie Anthem', '92 bpm, G major: I-V-vi-IV under a melody in eighth notes.', 'The four chords of Stage 2 in a new key, as a band arrangement: melody and harmony in one hand.',
          tune('indie-anthem', '3', 'Indie Anthem L3')),
      ]),
      unit('faster-reading', 'Faster reading', 'read', ['read-staff', 'black-keys'], 'Reading at the speed music moves.', [
        ex('Random in key, fast', 'A random melody in eighth notes.', 'Twice the notes in the same time: note-by-note reading breaks down and reading in groups takes over.',
          random('in-key-fast', 'Random in key, fast')),
        ex('Notes by staff, all', 'Staff notes now include sharps and flats.', 'The tracks and Auld Lang Syne had you read accidentals in context; this drills them one by one.',
          quiz({ kind: N, read: 'staff', halfTones: true })),
        ex('Chords by staff', 'A chord is written on the staff. Play it.', 'Reading three notes as one shape, the way a pianist reads a chord.',
          quiz({ kind: C, read: 'staff' })),
      ]),
      unit('three-six', 'Three and six', 'pieces', ['both-hands'], 'Music that does not march in four.', [
        ex('Scarborough Fair', '3/4, A minor, all white keys: melody, then both hands.', 'The old English ballad, and your first minor piece: the scale of Minor as a melody.',
          [tune('scarborough-fair', '1r', 'Scarborough melody'), tune('scarborough-fair', '3', 'Scarborough L3')]),
        ex('Brahms\' Lullaby', '3/4, G major, 16 bars, leaps of up to an octave: melody, then both hands.', 'Your longest melody and widest leaps; on the grid an octave is two rows up and two pads right.',
          [tune('brahms-lullaby', '1r', 'Brahms melody'), tune('brahms-lullaby', '3', 'Brahms L3')]),
        ex('Greensleeves', '6/8, A minor with the raised G#: melody, then both hands.', '6/8 is felt in two big beats, each split in three: a new pulse, not just a new number.',
          [tune('greensleeves', '1r', 'Greensleeves melody'), tune('greensleeves', '3', 'Greensleeves L3')]),
      ]),
    ],
  };
}

function phase4() {
  return {
    key: 'p4',
    name: 'Sevenths',
    title: 'Sevenths and real pieces',
    promise: 'You can play ii-V-I, read a classical minuet with both hands, and hear what a chord is doing in its key.',
    idea: 'Add one more third on top of a triad and you get a seventh chord. That fourth note is what makes jazz, soul and house sound grown-up, and ii-V-I is the cadence of jazz the way I-IV-V is the cadence of pop.',
    check: ['basics/progressions/ii-V-I/3', 'song:minuet-in-g/3', 'quiz:ear:id-to-8:together', 'quiz:ear:sevenths:four'],
    units: [
      unit('intervals-3', 'Intervals III', 'ear', ['intervals-2'], 'The wide intervals of expressive melody and of chord colours.', [
        course('Name 6ths', 'id-6ths', 'Minor or major 6th?', 'Big, singing leaps: the opening of many love themes.'),
        course('Compare 6ths', 'cmp-6ths', 'Which is bigger? The easy level keeps the first interval fixed.', 'Judgement before label, as before.'),
        course('Name 7ths', 'id-7ths', 'Minor or major 7th?', 'The intervals that name seventh chords: Sevenths, heard.'),
        course('Compare 7ths', 'cmp-7ths', 'Which is bigger?', 'The same, a size up.'),
        course('Compare M6 and m7', 'cmp-M6-m7', 'A semitone apart.', 'The pair ears confuse in this range.'),
        course('Name 6ths 7ths 8ve', 'id-6-7-8', 'Any of the five.', 'The upper half of the octave, no hints.'),
        course('Compare 6ths, 7ths', 'cmp-6-7', 'Which is bigger?', 'The whole upper range compared.'),
        course('Name to the 8ve', 'id-to-8', 'Any interval in the octave.', 'The complete set: an interval becomes a sound you know, not a calculation.'),
        course('Compare to the 8ve', 'cmp-to-8', 'Which is bigger, across the octave?', 'The final judgement at full width.'),
      ]),
      unit('sevenths', 'Sevenths', 'chords', ['progressions'], 'The richer chords of jazz, soul and house.', [
        ex('Major 7th', 'Major triad plus a major 7th.', 'Soft and glowing: the chord of neo-soul and deep house.', chord('sevenths', 'chord-maj7', '2r', 'Major 7th')),
        ex('Dominant 7th', 'Major triad plus a minor 7th.', 'V with an extra push home, and the blues\' basic chord.', chord('sevenths', 'chord-7', '2r', 'Dominant 7th')),
        ex('Minor 7th', 'Minor triad plus a minor 7th.', 'The warm minor chord of almost every groove.', chord('sevenths', 'chord-m7', '2r', 'Minor 7th')),
        ex('Half-dim 7th', 'Diminished triad plus a minor 7th.', 'The ii of minor keys, needed for the minor ii-V-i.', chord('sevenths', 'chord-m7b5', '2r', 'Half-dim 7th')),
        ex('Dim 7th', 'Three minor thirds stacked.', 'Fully symmetrical, it repeats every three semitones: the pivot chord for changing key.', chord('sevenths', 'chord-dim7', '2r', 'Dim 7th')),
        ex('ii-V-I', 'Dm7 G7 Cmaj7, both hands.', 'The cadence of jazz and of every standard, round the circle of fifths.', prog('ii-V-I', '3', 'ii-V-I')),
        ex('Random sevenths', 'Random seventh chords of every type.', 'It checks that you build the chords rather than remember them.', random('sevenths/2r', 'Random sevenths')),
      ]),
      unit('function-ear', 'Function by ear', 'ear', ['harmony-ear'], 'What a chord does in its key: the skill behind playing by ear.', [
        ex('Chords: IV or V', 'After the tonic, is the chord IV or V?', 'The two chords that make up most songs; telling them apart is how you start to figure one out.', ear('functions', 'iv-v', 'Chords: IV V')),
        ex('Chords: IV V or vi', 'The same with vi added.', 'The whole four-chord vocabulary of Stage 2, by ear.', ear('functions', 'iv-v-vi', 'Chords: IV V vi')),
        ex('Scale degrees, all', 'Which degree of the key is this note?', 'All seven: with them you can write down any melody you can sing.', ear('degrees', 'all', 'Scale degrees, all')),
        ex('7ths: three types', 'Major 7, dominant 7 or minor 7?', 'Sevenths, heard.', ear('sevenths', 'three', '7ths: three types')),
        ex('7ths: four types', 'With half-diminished added.', 'The complete set of the common sevenths.', ear('sevenths', 'four', '7ths: four types')),
        ex('Play the chord', 'One of the key\'s chords sounds. Play it on the pads.', 'Hearing and playing in one move: what you do when you jam along to a track.', quiz({ kind: C, hear: true })),
      ]),
      unit('scales-2', 'Scales II', 'scales', ['modes-1'], 'The rest of the minor family and the darker modes.', [
        ex('Harmonic minor', 'Minor with a raised 7th.', 'The scale behind Stage 2\'s i-iv-V-i: the leading tone as a scale.', scale('harmonicMinor', 'up-down', 'Harmonic minor')),
        ex('Melodic minor', 'Minor with raised 6th and 7th.', 'The jazz minor, and parent of the advanced scales in Stage 5.', scale('melodicMinor', 'up-down', 'Melodic minor')),
        ex('Phrygian', 'Minor with a lowered 2nd.', 'The dark, Spanish-sounding mode, and a staple of techno.', scale('phrygian', 'up-down', 'Phrygian up & down')),
        ex('Locrian', 'The mode on the 7th degree.', 'Rarely home, but it completes the seven modes; you will hear why it is unstable.', scale('locrian', 'up-down', 'Locrian up & down')),
        course('Scales: minors', 'sc-minors', 'Natural, harmonic or melodic minor? Heard up and down, then read.', 'Three minors, a note or two apart.'),
        course('Scales: dark modes', 'sc-phr-loc', 'Phrygian or Locrian? Heard up and down, then read.', 'The two dark modes.'),
        course('Scales: 7 modes', 'sc-modes', 'Any mode of the major scale. Heard up and down, then read.', 'The exam of modal hearing: every mode becomes a colour you can name.'),
      ]),
      unit('pieces', 'Pieces', 'pieces', ['three-six'], 'Real repertoire with independent hands.', [
        ex('Korobeiniki', 'The Tetris theme: eighth notes at 104 bpm over a busy left hand.', 'Your first piece where both hands always move; fun and instantly recognisable.', tune('korobeiniki', '3', 'Korobeiniki L3')),
        ex('Canon in D', 'Pachelbel, 60 bpm, D major, a walking bass under the melody.', 'The most famous bass line in history; slow, so it trains evenness rather than speed.', tune('pachelbel-canon', '3', 'Canon in D L3')),
        ex('Minuet in G', '3/4, 96 bpm, octave leaps in the melody.', 'A real classical piece read from the score, as this stage promised.', tune('minuet-in-g', '3', 'Minuet in G L3')),
        ex('Rising Sun', '6/8, an arpeggiated left hand: 43 notes against 23.', 'The first piece where the left hand is busier than the right: a role reversal hands need to learn.', tune('rising-sun', '3', 'Rising Sun L3')),
        ex('Cinematic', '66 bpm, 3/4, C minor with three flats, a moving left hand.', 'Dark film-score writing: the key and the independence are the challenge, not the tempo.', tune('cinematic', '3', 'Cinematic L3')),
      ]),
      unit('tracks', 'Track studies', 'chords', ['progressions'], 'Dance tracks at their real tempo.', [
        ex('Wake Me Up', 'Avicii, 124 bpm, vi-IV-I-V in driving eighth notes: chords, then both hands.', 'The progression of Stage 2 at club tempo: your chords are fast enough now.',
          [tune('track-wake-me-up', '2r', 'Wake Me Up L2'), tune('track-wake-me-up', '3', 'Wake Me Up L3')]),
        ex('Get Lucky', 'Daft Punk, 116 bpm, Bm D F#m E, syncopated: chords, then both hands.', 'The best-known chord loop of recent decades, and syncopation that has to feel loose.',
          [tune('track-get-lucky', '2r', 'Get Lucky L2'), tune('track-get-lucky', '3', 'Get Lucky L3')]),
        ex('Midnight City', 'M83, 105 bpm, a riff over four chords: chords, then both hands.', 'Riff and chords in one hand, the way synth players work.',
          [tune('track-midnight-city', '2r', 'Midnight City L2'), tune('track-midnight-city', '3', 'Midnight City L3')]),
        ex('Digital Love', 'Daft Punk, 125 bpm, voicings with added and suspended notes: chords, then both hands.', 'Chords beyond the plain triad in a real track: the bridge to Stage 5\'s colours.',
          [tune('track-digital-love', '2r', 'Digital Love L2'), tune('track-digital-love', '3', 'Digital Love L3')]),
        ex('Blue Monday', 'New Order, 130 bpm, 64 eighth notes in the left hand.', 'The left hand as a sequencer: endurance at tempo, and a classic.', tune('track-blue-monday', '3', 'Blue Monday L3')),
      ]),
    ],
  };
}

function phase5(songs) {
  const techno = songs.filter((s) => s.category === 'techno')
    .map((s) => ex(s.chart.name, '', '', tune(s.chart.id, '3', s.chart.name + ' L3')));
  const club = [
    ['track-good-life', 'Good Life'], ['track-one-more-time', 'One More Time'], ['track-the-model', 'The Model'],
    ['track-levels', 'Levels'], ['track-better-off-alone', 'Better Off Alone'], ['track-sounds-better', 'Sounds Better'],
    ['house-stabs', 'House Stabs'], ['ambient', 'Ambient'],
  ].map(([id, name]) => ex(name, '', '', tune(id, '3', name + ' L3')));
  const compound = [
    'id-8-M9-M10', 'id-8-m9-M10-11-12', 'cmp-9ths', 'id-8-m9-m10', 'cmp-10ths', 'cmp-M9-m10',
    'id-8-m9-m10-11-12', 'cmp-11-12', 'id-11-d12-12', 'id-8-12', 'id-M13-M14-15', 'id-m13-m14-15', 'id-13-15',
  ].map((key) => course((key.indexOf('cmp-') === 0 ? 'Compare ' : 'Name ') + courseShort(key), key, '', ''));
  return {
    key: 'p5',
    name: 'Colour',
    title: 'Colour and fluency',
    promise: 'Extended harmony, compound intervals, the colours of every scale, and sight-reading at speed.',
    idea: 'Past the seventh, every added note is colour: 9ths, 11ths and 13ths are the scale stacked further up. This is where experienced players live. There is no checkpoint, because nothing comes after it; take any unit in any order.',
    check: [],
    units: [
      unit('compound', 'Past the octave', 'ear', ['intervals-3'], 'Intervals beyond the octave.', compound,
        'Intervals beyond the octave, run like the other interval units: octave with 9ths and 10ths, then 11ths and 12ths, then 13ths and 14ths up to two octaves, each pair named before it is compared. Chord extensions (9, 11, 13) are compound intervals: hearing a 9th above the bass is hearing the colour of a minor 9th chord.'),
      unit('colours', 'Colours', 'chords', ['sevenths'], 'The everyday chord vocabulary, complete.', [
        ex('Major 6th', 'Major triad plus the 6th.', 'The sweet ending chord of swing and bossa.', chord('sixths', 'chord-6', '2r', 'Major 6th')),
        ex('Add 9', 'Major triad plus the 9th.', 'The modern pop pad, shimmering without a 7th.', chord('added-tones', 'chord-add9', '2r', 'Add 9')),
        ex('Minor 9th', 'Minor 7th plus the 9th.', 'The chord of neo-soul and deep house.', chord('ninths', 'chord-m9', '2r', 'Minor 9th')),
        ex('vi-ii-V-I', 'Am7 Dm7 G7 Cmaj7, both hands.', 'The ii-V-I one more step round the circle: the turnaround of jazz.', prog('vi-ii-V-I', '3', 'vi-ii-V-I')),
        ex('12-bar blues', 'Twelve bars of I, IV and V7, both hands.', 'The form behind blues, rock\'n\'roll and much of jazz.', prog('12-bar-blues', '3', '12-bar blues')),
        ex('Slash chords', 'Chords over a bass note other than their root.', 'How a moving bass is written under steady chords. You have played them since Pop Ballad; now they get their name.', chord('slash-chords', 'slash-chords', '3', 'Slash chords')),
        ex('Common: by name', 'A chord name from the everyday set (triads, sus, 6ths, 7ths, add9) on any note of the key. Play it.', 'Everything a pop, soul or jazz chart asks for, now that you know every chord in it.', quiz({ kind: C, read: 'name', chordSet: 'types' })),
        ex('Common: name it', 'One of those chords lights up. Name it.', 'The reverse, so you can write down what you find.', quiz({ kind: C, pick: true, chordSet: 'types' })),
        ex('Common: play it', 'One of those chords sounds. Play it.', 'Jamming along to a record with the full everyday vocabulary.', quiz({ kind: C, hear: true, chordSet: 'types' })),
      ]),
      unit('advanced-chords', 'Advanced chords', 'chords', ['colours'], 'Extensions and alterations: jazz harmony.', [
        ex('7sus4', 'A dominant 7th with a sus4.', 'The open, modal dominant of fusion and modern R&B.', chord('suspended-7ths', 'chord-7sus4', '2r', '7sus4')),
        ex('Minor 11th', 'A minor 9th plus the 11th.', 'The stacked-fourths sound of modal jazz and many techno pads.', chord('elevenths', 'chord-m11', '2r', 'Minor 11th')),
        ex('Thirteenth', 'A dominant 7th with 9th and 13th.', 'The full dominant of big band and gospel.', chord('thirteenths', 'chord-13', '2r', 'Thirteenth')),
        ex('Lydian maj7', 'maj7 with a raised 11th.', 'The floating film-score major: the Lydian mode as a chord.', chord('lydian', 'chord-maj7#11', '2r', 'Lydian maj7')),
        ex('Altered 7th', 'A dominant with every tension altered.', 'Maximum tension before resolving: jazz\'s strongest pull home.', chord('altered', 'chord-7alt', '2r', 'Altered 7th')),
        ex('ii-V-i minor', 'm7b5, 7b9, m7, both hands.', 'The minor cadence of jazz and of much dark electronic harmony.', prog('ii-V-i-minor', '3', 'ii-V-i minor')),
        ex('Random chords', 'Any chord type, both hands.', 'The complete vocabulary, unrehearsed.', random('all-chords/3', 'Random chords')),
        ex('All chords: by name', 'An extended chord name. Play it.', 'Real jazz and soul charts look like this.', quiz({ kind: C, read: 'name', chordSet: 'advanced' })),
        ex('All chords: name it', 'An extended chord lights up. Name it.', 'The reverse.', quiz({ kind: C, pick: true, chordSet: 'advanced' })),
        ex('All chords: play', 'An extended chord sounds. Play it.', 'Ear and hands at full vocabulary.', quiz({ kind: C, hear: true, chordSet: 'advanced' })),
      ]),
      unit('scales-3', 'Scales III', 'scales', ['scales-2'], 'Every common scale as a colour you can name.', [
        ex('Whole tone', 'Six whole steps.', 'Dreamlike and without a home; on the grid every second pad.', scale('wholeTone', 'up-down', 'Whole tone')),
        ex('Super Locrian', 'The altered scale.', 'The scale of the Altered 7th.', scale('superLocrian', 'up-down', 'Super Locrian')),
        ex('Phrygian dominant', 'Phrygian with a major 3rd.', 'The flamenco and Middle Eastern sound, the 5th mode of harmonic minor.', scale('phrygianDominant', 'up-down', 'Phrygian dominant')),
        ex('Hungarian minor', 'Harmonic minor with a raised 4th.', 'Dramatic, with two augmented seconds.', scale('hungarianMinor', 'up-down', 'Hungarian minor')),
        ex('Bhairav', 'The Indian raga scale.', 'Two augmented seconds, another tradition\'s colour.', scale('bhairav', 'up-down', 'Bhairav')),
        ex('Hirajoshi', 'A Japanese pentatonic.', 'Five notes with half steps: a pentatonic unlike the ones you know.', scale('hirajoshi', 'up-down', 'Hirajoshi')),
        ex('In-Sen', 'A Japanese pentatonic.', 'The same family, a different colour.', scale('inSen', 'up-down', 'In-Sen')),
        ex('Iwato', 'A Japanese pentatonic.', 'The darkest of the four.', scale('iwato', 'up-down', 'Iwato')),
        ex('Kumoi', 'A Japanese pentatonic.', 'The gentlest of the four.', scale('kumoi', 'up-down', 'Kumoi')),
        course('Scales: whole tone', 'sc-wt', 'Whole tone and its Lydian kin. Heard up and down, then read.', 'The symmetrical and Lydian-family scales.'),
        course('Scales: diminished', 'sc-dim', 'Whole-half or half-whole? Heard up and down, then read.', 'The two symmetrical eight-note scales.'),
        course('Scales: melodic', 'sc-mel-modes', 'The modes of melodic minor. Heard up and down, then read.', 'The jazz scales, all seven.'),
        course('Scales: harmonic', 'sc-harm-modes', 'The modes of harmonic minor. Heard up and down, then read.', 'The last family: every common scale is now a colour you can name.'),
      ]),
      unit('techno', 'Techno harmony', 'pieces', ['modes-1', 'sevenths'], 'Modal harmony the way producers use it.', techno,
        'The techno studies, both hands. Each is built on one harmonic idea: the Phrygian vamp, a pedal point, parallel chords, chord memory, quartal voicings, the Andalusian cadence, a cycle of thirds, Detroit minor 9ths. Each is eight bars, so it works as a vocabulary card you can take straight into your own tracks.'),
      unit('sight-reading', 'Sight-reading', 'read', ['faster-reading'], 'Reading anything, at speed.', [
        ex('Random, all notes', 'A random walk over every pitch the pads reach, black keys included.', 'The hardest reading drill: any note, any accidental, the full range.', random('all-notes', 'Random, all notes')),
        ex('Common: by staff', 'A written chord from the everyday set. Play it.', 'Four-note chords read as one shape.', quiz({ kind: C, read: 'staff', chordSet: 'types' })),
      ]),
      unit('club-tracks', 'Club tracks', 'pieces', ['tracks'], 'The rest of the electronic library at its real tempos.', club,
        'The rest of the electronic library at real tempo, both hands: off-beat chords (Better Off Alone, 137 bpm, five sharps), a 128-note left-hand sequence (The Model), and more. Pick the tracks you like.'),
      unit('advanced-pieces', 'Advanced pieces', 'pieces', ['pieces'], 'The hardest repertoire on the path.', [
        ex('Bach Prelude', '97 eighth notes of broken chords in the right hand, 16 bars.', 'The endurance study of the repertoire; each bar is a chord, so your harmony helps your reading.', tune('bach-prelude', '3', 'Bach Prelude L3')),
        ex('Fur Elise', 'Beethoven, with its famous chromatic turn.', 'Everyone wants to play it; its chromatic turn, its leaps and its 6/8 are all skills you have now.', tune('fur-elise', '3', 'Fur Elise L3')),
        ex('Neo-Soul', '84 bpm, extended chords in two sharps.', 'Your colour chords in a groove.', tune('neo-soul', '3', 'Neo-Soul L3')),
        ex('Funk Clav', '96 bpm, both hands busy and syncopated.', 'The hardest rhythm on the path: two independent, syncopated hands.', tune('funk-clav', '3', 'Funk Clav L3')),
      ]),
    ],
  };
}

/* The path. `songs` is [{ chart, category }], for the units made from a
 * whole category. Unit numbers ("2.3") follow the order here. */
export function buildPhases({ songs = [] } = {}) {
  return [phase1(), phase2(), phase3(), phase4(), phase5(songs)];
}

/* Songs a grown-up learner is not sent to, though they stay in Classics. */
export const OFF_PATH = ['mary-had-a-lamb', 'twinkle', 'frere-jacques', 'london-bridge', 'jingle-bells'];

/* The opening of the curriculum, for the docs and the Path's own Info page. */
export const PATH_TEXT = {
  intro: 'Piano Practice teaches the piano on the Ableton Move along a path of five stages. Each stage takes a few weeks, promises one thing you will be able to do at its end, and mixes every skill, so a ten-minute session still touches the grid, reading, harmony, your ear and a piece.',
  adults: 'The path is written for adults. You understand a concept in a minute, but your hands need weeks to follow, so the ideas come quickly and the playing moves at its own pace. The music is music you know or respect: folk and classical melodies, and the chords of tracks you listen to.',
  order: 'Inside a stage the units run in the order a lesson does: find your way, hear it, learn the pattern, use it, then show it in a piece. The piece comes last, just before the checkpoint.',
  free: 'Nothing is locked. Each stage ends with its Checkpoint. SHIFT+CLICK on a stage offers Test out: checkpoint, to show you know it already, and Start the path here, to begin anywhere.',
  stages: 'Every playing exercise runs twice: at S1 the pads you need are lit, at S2 you read the staff alone. A quiz has the same two steps: with hints, then without. An exercise is finished when you pass both at 90% or more, and comes back for review after 1, 3, 7, 14 and 30 days.',
  continue: 'Continue, at the top of the list, names and opens the next step of the unit whose skill you practised longest ago, among the units that are ready in your stage. Your stage is the earliest one you have neither finished nor passed the checkpoint of; units left over from an earlier stage stay in the mix. When a review is due, Continue alternates: one review, then one new step.',
  check: 'Test out: checkpoint plays the stage\'s checkpoint steps at S2. Pass them all and Continue starts at the next stage; the steps you skipped stay open, marked as assumed. Passing the same steps in ordinary practice moves you on too, but keeps the rest of the stage in the mix.',
  offPath: 'Five nursery songs (Mary Had a Little Lamb, Twinkle, Frere Jacques, London Bridge, Jingle Bells) stay in Practice > Songs > Classics, playable as before, with your progress kept; the path does not send an adult there. Every level of every song also stays in the song lists, even where the path uses only some of them.',
};
