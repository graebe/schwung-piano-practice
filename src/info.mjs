// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * info.mjs — what every practice is, and the words it uses. Pure.
 *
 * Menu opens a help page for whatever you are looking at: the highlighted row
 * of the list, the armed exercise, the drill under way, the screen itself.
 * The page says what the practice asks, how to go about it, and defines each
 * term it uses — from one glossary, so a word is explained the same way
 * everywhere and only once. The session puts the screen's own help first
 * (withScreen).
 *
 * Where the facts already live in the code they are derived, not retyped: a
 * scale's step pattern comes from its intervals, a chord's formula and notes
 * from its quality, a progression's chords from its steps. Hand-written text
 * is for what code cannot know — how a minor chord sounds, what to listen for.
 *
 * infoFor(target, env) -> { key, title, sections: [{ head, text }], terms } | null
 *   target   { id, label, kind }   kind marks what has no id: 'continue',
 *            'checkpoint', 'progress', 'result', 'sheet', 'welcome', 'tip',
 *            'settings' (with `group`)
 *   env      { songs: id -> chart, phases }   a song's key and tempo; the
 *            path as the session numbered it
 *
 * `key` names the page for "seen it already": one per kind of practice, not
 * per row, so the first scale drill explains scale drills once.
 */

import { MODES, MODE_LABELS } from './generator.mjs';
import { qualityById } from './chords.mjs';
import { CHORD_FAMILIES, LESSON_NAMES } from './chord_lessons.mjs';
import { LESSON_PROGRESSIONS } from './progressions.mjs';
import { exerciseByKey, levelByKey, answersFor } from './ear.mjs';
import { COURSES } from './ear_course.mjs';
import { READ_COURSES } from './read_course.mjs';
import { LEVELS } from './levels.mjs';
import { buildProgram } from './program.mjs';
import { groupByKey } from './settings_def.mjs';
import { PATH_TEXT, STRANDS, STRAND_TEXT } from './curriculum.mjs';

/* ---- Glossary ------------------------------------------------------------- */

export const TERMS = {
  semitone: ['Semitone', 'The smallest step: the next pad to the right.'],
  tone: ['Tone', 'Two semitones. W (whole) in a step pattern; a semitone is H (half).'],
  octave: ['Octave', 'The same note 12 semitones up. On the pads: two rows up, two right.'],
  sharp: ['Sharp, flat', '# raises a note a semitone, b lowers it. C# and Db are one pad.'],
  scale: ['Scale', 'Notes climbing from a root by a fixed pattern of tones and semitones.'],
  key: ['Key', 'The scale a piece is built from, named by its root: G major, A minor.'],
  root: ['Root', 'The note a scale or chord is named after and built on.'],
  tonic: ['Tonic', 'The root of the key: home. A tune ending there sounds finished.'],
  degree: ['Degree', 'A note\'s place in the scale, counted from the root: 1 to 7.'],
  interval: ['Interval', 'The distance between two notes, named by the letters it spans: C-E spans C D E, a 3rd.'],
  majmin: ['Major, minor', 'Interval sizes. A major 3rd is 4 semitones, a minor 3rd 3. Major sounds brighter.'],
  perfect: ['Perfect', '4ths, 5ths and octaves: the most stable intervals, neither major nor minor.'],
  tritone: ['Tritone', '6 semitones, half an octave. Tense, unresolved.'],
  compare: ['Compare', 'Two intervals, one after the other: which is bigger, or are they the same? It counts for the bigger one.'],
  compound: ['Compound interval', 'Wider than an octave: an octave plus a simple interval. A 9th is an octave and a 2nd, a 12th an octave and a 5th.'],
  mode: ['Mode', 'A scale started from another of its notes: D to D on the white keys is Dorian. Each mode has its own pattern of steps.'],
  step: ['Step', 'Two neighbouring notes of the scale, a 2nd apart: C-D.'],
  leap: ['Leap', 'Two scale notes further apart than a step, a 3rd or more: C-E.'],
  contour: ['Contour', 'The shape of a melody: which way each note moves.'],
  chord: ['Chord', 'Three or more notes sounding together.'],
  triad: ['Triad', 'Three notes stacked in 3rds: root, 3rd, 5th. C-E-G is C major.'],
  quality: ['Quality', 'What kind a chord is: major, minor, diminished, seventh...'],
  formula: ['Formula', 'A chord\'s notes as degrees of the root\'s major scale: minor is 1 b3 5.'],
  inversion: ['Inversion', 'A chord with another of its notes at the bottom. C/E is C major over E.'],
  seventh: ['Seventh chord', 'A triad with a 7th on top: four notes.'],
  voicing: ['Voicing', 'Which octave each note of a chord sits in, and in which hand.'],
  broken: ['Broken, block', 'Broken: a chord\'s notes one after another. Block: all at once.'],
  progression: ['Progression', 'A sequence of chords, named by Roman numerals for the degree each starts on: I, IV, V.'],
  numerals: ['Roman numerals', 'I is the chord on degree 1. Upper case is major, lower case minor: vi is minor.'],
  slash: ['Slash chord', 'A chord over a bass note that is not its root: D/F# is D major over F#.'],
  hands: ['RH, LH', 'Right hand plays the melody and chords, left hand the bass.'],
  level: ['Level', 'How much of a song you play: L1 one hand\'s line, L2 the chords, L3 both hands.'],
  stage: ['Stage', 'One of the five stages of the Learning Path, a few weeks of work each, ending with its checkpoint.'],
  guided: ['Guided, Solo', 'Every exercise is played twice. Guided lights the pad you need as its note comes; Solo lights nothing, and you read it from the staff.'],
  score: ['Score', 'Notes hit, over the notes in the piece plus wrong presses. 90% passes Guided or Solo.'],
  hint: ['Hint', 'REC helps, two presses deep. A hinted answer still counts, and is noted.'],
};

/* ---- Small helpers ---------------------------------------------------------- */

const LETTERS = 'CDEFGAB';
const NATURAL = [0, 2, 4, 5, 7, 9, 11];

/* A degree label (b3, #5, 9) spelled up from C, by letter first: #5 is G#,
 * never Ab, which is what makes the notes agree with the formula. */
function spellFromC(label, semis) {
  const n = parseInt(label.replace(/[^0-9]/g, ''), 10);
  const letter = (n - 1) % 7;
  let diff = (((semis % 12) - NATURAL[letter]) % 12 + 12) % 12;
  if (diff > 6) diff -= 12;
  const acc = diff > 0 ? '#'.repeat(diff) : 'b'.repeat(-diff);
  return LETTERS[letter] + acc;
}

const DEGREE = {
  0: '1', 1: 'b2', 2: '2', 3: 'b3', 4: '3', 5: '4', 6: 'b5', 7: '5', 8: '#5', 9: '6',
  10: 'b7', 11: '7', 12: '8', 13: 'b9', 14: '9', 15: '#9', 17: '11', 18: '#11', 21: '13',
};

/* The formula of a chord quality: its intervals as degrees. */
export function chordFormula(quality) {
  return quality.intervals.map((s) => {
    if (quality.id === 'dim7' && s === 9) return 'bb7';
    if (quality.id === 'm6' && s === 8) return 'b6';
    return DEGREE[s] || String(s);
  });
}

export function chordInC(quality) {
  const f = chordFormula(quality);
  return quality.intervals.map((s, i) => spellFromC(f[i], s)).join(' ');
}

/* W and H between the notes of a scale, round to the octave. */
export function stepPattern(intervals) {
  const out = [];
  for (let i = 0; i < intervals.length; i++) {
    const next = i + 1 < intervals.length ? intervals[i + 1] : 12;
    const d = next - intervals[i];
    out.push(d === 1 ? 'H' : d === 2 ? 'W' : d === 3 ? 'W+H' : d + 'H');
  }
  return out.join(' ');
}

function sec(head, text) {
  return { head, text };
}

function page(key, title, sections, terms = []) {
  return { key, title, sections, terms };
}

/* ---- The practices ------------------------------------------------------- */

const MODE_FEEL = {
  major: 'Bright and settled: the scale most tunes are in, and the one the others are compared to.',
  minor: 'Darker and sadder than major: a lowered 3rd, 6th and 7th.',
  dorian: 'Minor with a raised 6th: soulful, folky, jazzy. Scarborough Fair.',
  mixolydian: 'Major with a lowered 7th: bluesy, rock and funk.',
  lydian: 'Major with a raised 4th: floating, dreamy, film music.',
  phrygian: 'Minor with a lowered 2nd: dark, Spanish, metal.',
  locrian: 'The unstable one: its home chord is diminished.',
  majorPent: 'Five notes and no semitones: hard to play a wrong note. Folk and pop.',
  minorPent: 'Five notes of minor: the scale of rock and blues solos.',
  minorBlues: 'Minor pentatonic plus the b5, the blue note.',
  harmonicMinor: 'Minor with a raised 7th, which pulls hard back home. Classical, Middle Eastern.',
  melodicMinor: 'Minor with a raised 6th and 7th: smooth going up. Jazz minor.',
  wholeTone: 'All whole tones: no home, dreamlike.',
  chromatic: 'All twelve notes, every pad.',
};

const SCALE_DRILLS = {
  'up-down': 'The scale up an octave and back down, one note a beat.',
  up: 'The scale upwards only.',
  down: 'The scale downwards only.',
  thirds: 'Each scale note, then the one a 3rd above it: C-E, D-F, E-G... Reading in leaps.',
  fifths: 'Each scale note, then the one a 5th above it: C-G, D-A... Bigger leaps.',
};

function scalePage(mode, drill, label) {
  const intervals = MODES[mode];
  if (!intervals) return null;
  const name = MODE_LABELS[mode] || mode;
  const sections = [];
  if (drill && SCALE_DRILLS[drill]) sections.push(sec('', SCALE_DRILLS[drill]));
  sections.push(sec(name, (MODE_FEEL[mode] || 'One of Move\'s scales.') +
    ' Steps: ' + stepPattern(intervals) + '. The Key setting picks the root.'));
  return page('scales', label || name, sections, ['scale', 'tone', 'semitone', 'root', 'guided']);
}

const FAMILY_TEXT = {
  triads: 'The four triads every chord grows from. Major and minor differ by one note, the 3rd.',
  'sus-power': 'Sus chords swap the 3rd for a 2nd or 4th: open, neither major nor minor. A power chord is root and 5th only.',
  inversions: 'Major and minor triads with the 3rd or 5th at the bottom. Same chord, other shape.',
  sixths: 'A major or minor triad with the 6th added: sweet, old-fashioned. 6/9 adds the 9th too.',
  sevenths: 'A 7th on top of a triad. maj7 dreamy, 7 bluesy and restless, m7 mellow, m7b5 dark.',
  'added-tones': 'A triad with the 9th or 11th added, without the 7th: shimmering colour.',
  ninths: 'Seventh chords with the 9th on top: rich jazz and soul colour.',
  'suspended-7ths': 'A dominant 7th with the 3rd swapped for a 2nd or 4th: open, modern.',
  elevenths: 'Stacked to the 11th. Played as a chord over its root, like Bb/C.',
  thirteenths: 'Stacked to the 13th: the fullest dominant and major sounds.',
  lydian: 'Major chords with the raised 11th: bright and floating.',
  altered: 'Dominant 7ths with a bent 5th or 9th: tension that wants to resolve.',
  'slash-chords': 'Chords over a bass note that is not their root: smooth bass lines.',
};

const LEVEL_TEXT = {
  '1r': 'L1 RH: the right hand alone, its top line, one note at a time.',
  '1l': 'L1 LH: the left hand alone, the bass line.',
  '2r': 'L2: the right hand as written, with its chords.',
  '3': 'L3: both hands together.',
};

function levelLine(level) {
  return LEVEL_TEXT[level] ? sec('', LEVEL_TEXT[level]) : null;
}

function chordPage(family, lesson, level, label) {
  const fam = CHORD_FAMILIES.find((f) => slugOf(f.name) === family);
  const sections = [];
  const qid = lesson ? lesson.replace(/^chord-/, '').replace(/^inversions-/, '') : null;
  const q = qid ? qualityById(qid) : null;
  if (q) {
    const name = LESSON_NAMES[q.id] || q.id;
    sections.push(sec(name, 'Formula ' + chordFormula(q).join(' ') + '. In C: ' + chordInC(q) + '.'));
    sections.push(sec('', 'Played on all twelve roots round the circle of 5ths: C F Bb Eb...'));
  }
  if (lesson === 'slash-chords') sections.push(sec('', 'Eight slash chords, each over its own bass note.'));
  if (fam) sections.push(sec(fam.name, FAMILY_TEXT[family] || ''));
  const lv = levelLine(level);
  if (lv) sections.push(lv);
  if (!sections.length) return null;
  const terms = ['chord', 'triad', 'formula', 'quality', 'voicing', 'inversion', 'level'];
  if (family === 'slash-chords') terms.push('slash');
  return page('chords', label || (fam ? fam.name : 'Chords'), sections, terms);
}

/* The progression's chords in C (or A minor), from its steps. */
function progressionInC(prog) {
  const tonic = (prog.mode === 'minor') ? 9 : 0;
  return prog.steps.map(([deg, qid]) => {
    const q = qualityById(qid);
    const root = spellFromC(String(degreeNumberOf(deg, (prog.mode === 'minor')) || 1), (tonic + deg) % 12);
    return root + (q ? q.suffix : '');
  }).join(' ');
}

/* Which letter step a semitone offset from the tonic sits on, in major or
 * natural minor — enough to spell a progression's roots from A or C. */
function degreeNumberOf(semis, minor) {
  const scale = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const at = scale.indexOf(semis % 12);
  if (at < 0) return 1;
  /* Spelled from C, so the number is counted from C: A minor's i is the 6th. */
  return ((at + (minor ? 5 : 0)) % 7) + 1;
}

function progressionPage(progId, level, label) {
  const prog = LESSON_PROGRESSIONS.find((p) => p.id.replace(/\s+/g, '-') === progId);
  const sections = [];
  if (prog) {
    sections.push(sec(prog.id, 'In ' + ((prog.mode === 'minor') ? 'A minor' : 'C') + ': ' + progressionInC(prog) +
      '. Here it is in the Key setting\'s key.'));
  }
  sections.push(sec('', 'Voiced as a pianist would: the left hand plays roots, the right hand moves to the nearest shape of the next chord.'));
  const lv = levelLine(level);
  if (lv) sections.push(lv);
  return page('progressions', label || (prog ? prog.id : 'Progressions'), sections,
    ['progression', 'numerals', 'voicing', 'hands', 'level']);
}

const RANDOM_TEXT = {
  'all-notes': 'A random line over every note the pads reach, black keys included.',
  'in-key': 'A random line in the Key and Scale settings, in quarter notes.',
  'in-key-fast': 'The same in eighth notes: twice as many notes a beat.',
  'all-chords': 'Sixteen random chords, any root, any quality the module knows.',
  triads: 'Sixteen random major, minor, diminished and augmented triads.',
  sevenths: 'Sixteen random seventh chords.',
};

function randomPage(row, level, label) {
  const sections = [sec('', (RANDOM_TEXT[row] || 'Random material, new each time you open it.') +
    ' Each opening draws a new set; restarting replays the one you just played.')];
  const lv = levelLine(level);
  if (lv) sections.push(lv);
  return page('random', label || 'Random', sections, ['key', 'scale', 'chord', 'level']);
}

/* What each hearing exercise asks, and what to listen for. */
const EAR_TEXT = {
  direction: ['Two notes. Is the second higher, lower or the same?', 'Hum both: did your voice go up? Wide is far apart, close is a semitone or two.', ['semitone']],
  'playback-notes': ['A note plays. Find it on the pads and play it back.', 'Hum it, then search: one pad right is a semitone higher, one row up a 4th. In key uses the Key setting; chromatic any note.', ['semitone', 'key']],
  steps: ['Two notes from a major scale. Neighbours, or further apart?', 'Afterwards A-B means A, then B.', ['step', 'leap', 'scale']],
  contour: ['Three notes. Which way did each move: up then up, up then down...?', 'Follow the melody with your hand as it plays.', ['contour']],
  triads: ['A triad: major or minor?', 'Major sounds bright and settled, minor darker. Broken plays the notes one by one, block together, inverted with another note at the bottom.', ['triad', 'majmin', 'broken', 'inversion']],
  'four-triads': ['Major, minor, diminished or augmented?', 'Diminished is small and tense, augmented stretched and eerie.', ['triad', 'quality', 'broken']],
  'key-quality': ['A short tune: major key or minor key?', 'Listen to its 3rd note and to where the tune comes to rest. Major or minor as a scale is Identify scales › 1.', ['key', 'majmin', 'tonic']],
  home: ['A chord sets the key, then a short tune. Did it end at home?', 'Ending on the tonic sounds finished; anywhere else leaves it hanging.', ['tonic', 'key']],
  degrees: ['A cadence sets the key, then one note. Which degree is it?', 'Sing down from the note to home and count the steps.', ['degree', 'tonic', 'key']],
  sevenths: ['A seventh chord: which kind?', 'maj7 dreamy, 7 bluesy and restless, m7 soft and mellow, m7b5 dark.', ['seventh', 'quality', 'broken']],
  functions: ['The home chord, then another chord of the key: IV, V or vi?', 'IV lifts, V wants to go home, vi is the minor one.', ['numerals', 'progression', 'tonic']],
  'playback-chords': ['A chord plays. Find it and hold all its notes at once.', 'Find the bass note first, then build up. Part of it down is not yet wrong.', ['chord', 'root']],
};

/* One page per course, whichever unit opened it, so the first-time Info shows
 * once a course rather than once a unit. */
const COURSE_TEXT = {
  intervals: ['One interval. Name it from the answers below.',
    'Units add intervals a few at a time, a contrasting pair first. Up, down and together (tog) are learned apart: they sound different. Past the octave, hear the octave first and then what is left.',
    ['interval', 'majmin', 'perfect', 'tritone', 'compound']],
  compare: ['Two intervals, one after the other. Is the first bigger, the second, or are they the same?',
    'Fixed (fix) levels start both on the same note: listen to where the second note lands. Random levels start each on its own note, so only the sizes tell.',
    ['interval', 'majmin', 'compound']],
  scales: ['A scale from a random note, up or down. Which scale is it?',
    'Listen for where the semitones fall, and for the 3rd, 6th and 7th: they tell the scales apart. The root changes every time, so name the pattern, not the notes.',
    ['scale', 'mode', 'tone', 'semitone']],
  'read-intervals': ['One interval on the staff. Name it from the answers below.',
    'Count the letters from the lower note to the upper, both included: C to E is C D E, a 3rd. Then the accidentals tell major from minor. PLAY sounds it, and counts as help.',
    ['interval', 'majmin', 'perfect', 'compound']],
  'read-compare': ['Two intervals on the staff, a bar line between them. Is the first bigger, the second, or are they the same?',
    'Count each by letters, then by accidentals. Fixed (fix) levels start both on the same note. PLAY sounds them, and counts as help.',
    ['interval', 'majmin', 'compound']],
  'read-scales': ['A scale on the staff, up or down. Which scale is it?',
    'Find the semitones: two notes a letter apart with no step between them, like E-F or C#-D. Where they fall names the scale. PLAY sounds it, and counts as help.',
    ['scale', 'mode', 'tone', 'semitone']],
};

const ALL_COURSES = COURSES.concat(READ_COURSES);
const courseOf = (ex) => ALL_COURSES.find((c) => c.exercises.indexOf(ex) >= 0) || null;

/*
 * A tune that starts with the interval, rising and falling — the anchor a
 * beginner hears the interval against until it is known by itself. Titles
 * only. Past the octave there are none worth the name: hear the octave, then
 * what is left over.
 */
export const INTERVAL_TUNES = {
  m2: ['Jaws', 'Fur Elise'],
  M2: ['Happy Birthday', 'Mary Had a Little Lamb'],
  m3: ['Greensleeves', 'Hey Jude'],
  M3: ['Oh When the Saints', 'Swing Low, Sweet Chariot'],
  P4: ['Here Comes the Bride', 'O Come, All Ye Faithful'],
  TT: ['The Simpsons', 'Black Sabbath'],
  P5: ['Twinkle Twinkle Little Star', 'The Flintstones'],
  m6: ['The Entertainer', 'Love Story'],
  M6: ['My Bonnie', 'Nobody Knows the Trouble'],
  m7: ['Somewhere (West Side Story)', 'Watermelon Man'],
  M7: ['Take On Me', 'I Love You (Cole Porter)'],
  P8: ['Somewhere Over the Rainbow', 'Willow Weep for Me'],
};

function tunesFor(keys) {
  const lines = keys.filter((k) => INTERVAL_TUNES[k])
    .map((k) => k + ' up: ' + INTERVAL_TUNES[k][0] + '; down: ' + INTERVAL_TUNES[k][1] + '.');
  return lines.length ? sec('Tunes', lines.join(' ')) : null;
}

function coursePage(course, ex, levelKey) {
  const text = COURSE_TEXT[course.key];
  const sections = [sec('', text[0]), sec('Listen', text[1])];
  if (ex) {
    const level = levelByKey(ex, levelKey);
    const answers = answersFor(ex, level).map((a) => a.label);
    sections.push(sec(ex.name, (ex.set ? 'From: ' + ex.set.join(', ') : 'Answers: ' + answers.join(', ')) + '.'));
    /* Intervals, heard or read or compared: a tune for each to hear it by. */
    if (/intervals|compare/.test(course.key)) {
      const tunes = tunesFor(ex.set || answersFor(ex, level).map((a) => a.key));
      if (tunes) sections.push(tunes);
    }
  }
  sections.push(sec('', 'Answer on the coloured pads at the bottom, or with the jog. PLAY repeats it; REC helps.'));
  return page('course:' + course.key, course.name, sections, text[2].concat(['hint']));
}

function earPage(exKey, levelKey) {
  const course = ALL_COURSES.find((c) => c.key === exKey);
  if (course) return coursePage(course, null);
  const ex = exerciseByKey(exKey);
  if (ex && courseOf(ex)) return coursePage(courseOf(ex), ex, levelKey);
  const text = EAR_TEXT[exKey];
  if (!ex || !text) return null;
  const sections = [sec('', text[0]), sec('Listen', text[1])];
  if (levelKey) {
    const lv = ex.levels.find((l) => l.key === levelKey);
    if (lv && ex.levels.length > 1) sections.push(sec('', 'This level: ' + lv.name + '.'));
  }
  sections.push(sec('', 'Answer on the coloured pads at the bottom, or with the jog. PLAY repeats it; REC helps.'));
  return page('ear:' + exKey, ex.name, sections, text[2].concat(['hint']));
}

/* The quiz rows: Keys and Reading, notes or chords; hearing play-back. */
/* ---- The trainers ---------------------------------------------------------- */

/*
 * A trainer's pages: the ring, each circle, and a round of it. The words
 * are the subject's; the five circles say the same thing in every trainer,
 * which is the point of them.
 */
const TRAINER_TEXT = {
  note: {
    ring: 'Notes, as a trainer. Read a note off the staff, hear one, or find one from its name; Learn holds the reading lines; Stats shows which notes you know.',
    read: 'A note on the staff. Play it, in the octave it is written, or name it from a short list.',
    hear: 'A note sounds. Play it back, in any octave, or say whether the second of two is higher, the same, or lower.',
    play: 'A note\'s name, like F#. Play it: any octave counts.',
    stats: 'Every note you have been asked, weakest first: how much of it was right read, heard and played.',
    ladder: 'Level 1 is C to G round middle C; each level adds: A and B; two octaves with ledger lines; the sharps and flats; the enharmonic white keys, E#, Fb, B#, Cb. Custom picks your own.',
    terms: ['sharp', 'octave', 'level'],
  },
  int: {
    ring: 'Intervals, as a trainer. Read one off the staff, hear one, or play one from its name; Learn holds the melodic drills; Stats shows which intervals you know.',
    read: 'An interval on the staff. Name it, compare two of them, or play both notes as written.',
    hear: 'An interval sounds, up, down or together. Name it, compare two, or play it back: any octave, at the right distance.',
    play: 'An interval\'s name, like M3 above D. Play both notes: any D, and the note a major 3rd above that D.',
    stats: 'Every interval you have been asked, weakest first: how much of it was right read, heard and played. A comparison counts for the bigger one.',
    ladder: 'Each level is a set of its own, as the course runs: 2nds; 3rds; the two together; 4th, 5th, octave; everything to the 5th; 6ths and 7ths; everything to the octave; the compound intervals. Custom picks your own.',
    terms: ['interval', 'compare', 'compound', 'level'],
  },
  prog: {
    ring: 'Progressions, as a trainer. Read one off the staff, hear one after its home chord, or play one from its numerals; Learn holds the eleven charts; Stats shows which progressions you know.',
    read: 'A progression on the staff. Play it as written, voiced and in a rhythm of your choice, or name which progression it is.',
    hear: 'The home chord, then a progression. Play its chords back, each in any voicing, or name it from a short list.',
    play: 'A progression in numerals, like I-V-vi-IV, and its key. Play its chords in turn, each in any voicing. Key all 12 walks it round the circle of fifths, a key a time.',
    stats: 'Every progression you have been asked, weakest first: how much of it was right read, heard and played. Right means the whole progression.',
    ladder: 'Level 1 is the four cadences, how a phrase ends; each level adds: the foundations; pop; minor; jazz basics; the blues; borrowed and modal chords; secondary dominants and jazz substitutes. Custom picks your own.',
    terms: ['progression', 'numerals', 'voicing', 'level'],
  },
  scale: {
    ring: 'Scales, as a trainer. Read a scale off the staff, hear one, or play one from its name; Learn holds the scale drills, one folder a scale; Stats shows which scales you know and which you do not yet.',
    read: 'A scale on the staff. Play it as it is written, a chart with its pattern, or name it from a short list.',
    hear: 'A scale sounds, from its root. Play it back, note by note in any octave, or name it from a short list.',
    play: 'A scale\'s name, like D Dorian. Play it note by note from its root, up, down or both; any octave counts. A wrong note starts it again.',
    stats: 'Every scale you have been asked, weakest first: how much of it was right read, heard and played.',
    ladder: 'Level 1 is major and minor; each level adds: Dorian, Lydian, Mixolydian; harmonic and melodic minor; Phrygian and Locrian; the pentatonics and the blues; whole tone and its kin; the diminished scales; the modes of melodic minor; of harmonic minor; and six scales from India, Hungary and Japan. Custom picks your own.',
    terms: ['scale', 'mode', 'tonic', 'level'],
  },
  chord: {
    ring: 'Chords, as a trainer. Read a chord off the staff, hear one, or play one from its name; Learn holds the lessons by family; Stats shows which chords you know and which you do not yet.',
    read: 'A chord on the staff. Play exactly what is written, every note in its octave, or name it from a short list.',
    hear: 'A chord sounds. Play it back, any voicing of it counts, or name it from a short list.',
    play: 'A chord\'s name, like Am7. Play it: any octave and any inversion counts, nothing else held with it.',
    stats: 'Every chord you have been asked, weakest first: how much of it was right read, heard and played.',
    ladder: 'Level 1 is the major chord; each level adds: minor; diminished and augmented; sus and power chords; the three common 7ths; half-diminished, dim7 and the 6ths; ninths and add9; the altered dominants. Custom picks your own.',
    terms: ['chord', 'quality', 'inversion', 'level'],
  },
};

const CIRCLE_TEXT = {
  setup: 'The setup: what a round asks and how. Answer is play or name; Level what it asks; Key the key it is in, or random; the rest how it is asked; Round how many right answers make a round.',
  common: 'The same five circles in every trainer: Read, Hear, Play, Learn, Stats.',
};

export function trainerPage(subject, circle, label) {
  const t = TRAINER_TEXT[subject];
  if (!t) return null;
  const sections = [sec('', t[circle] || t.ring)];
  if (circle === 'read' || circle === 'hear' || circle === 'play') {
    sections.push(sec('', CIRCLE_TEXT.setup), sec('', t.ladder));
  } else {
    sections.push(sec('', CIRCLE_TEXT.common));
  }
  const name = { note: 'Notes', int: 'Intervals', scale: 'Scales', chord: 'Chords', prog: 'Progressions' }[subject];
  return page('trainer:' + subject + (circle ? ':' + circle : ''), label || name, sections, t.terms);
}

function quizPage(drill, label) {
  const trained = /^([a-z]+):(read|hear|play):[a-z]+:(L\d+|C-[0-9a-z]{6})$/.exec(drill);
  if (trained) return trainerPage(trained[1], trained[2], label);
  const [mode, kind, set] = drill.split(':');
  if (mode === 'ear') return earPage(kind, set);
  if (mode === 'hear') return earPage(kind === 'chords' ? 'playback-chords' : 'playback-notes', set);
  const chords = kind === 'chords';
  const what = chords
    ? (set === 'triads' ? 'the triads of the key' : set === 'advanced' ? 'every chord type, ninths and altered too' : 'chord types: dim, sus, 6ths, 7ths')
    : (set === 'half' ? 'every note, black keys too' : 'the notes of the key');
  const one = chords ? 'chord' : 'note';
  const all = chords ? ', all its notes at once' : '';
  let sections;
  if (mode === 'pick') {
    sections = [sec('', 'A pad lights up - several for a chord. Name it: turn the jog to an answer and click.'),
      sec('', 'The wrong answers are near misses, so a rough guess will not do. Asks ' + what + '.')];
  } else if (mode === 'staff') {
    sections = [sec('', 'A row of ' + one + 's on the staff, no names: read the first, on the line, and play it' + all + '.'),
      sec('', 'Play it right and the row moves on; the next ones are already in view. Only the written octave counts. REC once names it. Asks ' + what + '.')];
  } else {
    sections = [sec('', 'A row of ' + (chords ? 'chord names' : 'note names') + ': play the boxed one' + all + '.'),
      sec('', 'A name has no octave, so any octave counts' + (chords ? ', and any inversion' : '') +
        '. Play it right and the row moves on to the next. Asks ' + what + '.')];
  }
  sections.push(sec('', 'A round is a set number of right answers (Round, in settings); the score is answers a minute, and how many were right. Half tones and Chords in settings change what is asked.'));
  const key = mode === 'pick' ? 'quiz:name' : mode === 'staff' ? 'quiz:staff' : 'quiz:play';
  return page(key, label || (mode === 'pick' ? 'Name it' : 'Play it'), sections,
    chords ? ['chord', 'triad', 'quality', 'hint'] : ['sharp', 'octave', 'hint']);
}

function songPage(songId, level, env, label) {
  const chart = env && env.songs ? env.songs[songId] : null;
  const sections = [];
  if (chart) {
    const ks = chart.keySig || 0;
    const sig = ks === 0 ? 'no sharps or flats' : Math.abs(ks) + (ks > 0 ? ' sharp' : ' flat') + (Math.abs(ks) > 1 ? 's' : '');
    sections.push(sec(chart.name, 'Key signature: ' + sig + '. Tempo ' + chart.bpm + '. Listen first; then play it with the pads lit, then reading alone.'));
  }
  const lv = levelLine(level);
  if (lv) sections.push(lv);
  sections.push(sec('', 'Every level sits on the same pads, so what you learn at L1 carries to L3. Guided lights the pads, Solo is reading alone.'));
  return page('songs', label || (chart ? chart.name : 'Song'), sections, ['level', 'hands', 'guided', 'score']);
}

const FOLDERS = {
  basics: ['Practice', 'Five trainers, from the smallest unit to the largest: notes, intervals, scales, chords, progressions. Each has the same five circles: Read, Hear, Play, Learn and Stats. Nothing here is in an order; practise what you like.', ['interval', 'scale', 'chord', 'progression']],
  'basics/scales': ['Scales', 'One folder per scale, each with five drills: up and down, up, down, in 3rds and in 5ths. Then two drills that hear a key: major or minor, and the degrees of the scale.', ['scale', 'tone', 'semitone', 'degree']],
  'basics/chords': ['Chords', 'Thirteen families, one lesson per chord quality, each on all twelve roots; then random chords, a new set every time.', ['chord', 'quality', 'formula']],
  'basics/chords/random-chords': ['Random chords', 'Sixteen chords, a new set every time: of every quality, the triads, or the sevenths.', ['chord', 'triad', 'seventh']],
  'basics/progressions': ['Progressions', 'Eleven common chord progressions in the Key setting\'s key. Then two drills that hear the chords of a key: does a line end at home, and which chord follows I.', ['progression', 'numerals', 'tonic']],
  'basics/note-trainer/learn': ['Notes', 'Reading lines on a scrolling staff: random notes in the key, in quarters or eighths, or every note the pads reach.', ['key', 'sharp']],
  'basics/int-trainer/learn': ['Intervals', 'Melodic hearing: does a line step or leap, and which way does it go.', ['step', 'leap', 'contour']],
  songs: ['Songs', 'Pieces by style: Classics, Electronic, Techno, Styles, and Other for files you added.', ['level']],
  'songs/classics': ['Classics', 'Folk tunes and classics, easy first, each at four levels.', ['level', 'hands']],
  'songs/electronic': ['Electronic', 'The chord progressions of famous tracks - never their melodies - and five style pieces.', ['progression', 'level']],
  'songs/techno': ['Techno', 'Fourteen chord studies, simple to complex: stabs, pads, parallel shapes.', ['progression', 'level']],
  'songs/styles': ['Styles', 'Pop, indie, film, soul and funk pieces, each written to drill a style.', ['level']],
  'songs/other': ['Other', 'Exercises you added yourself.', []],
  'program/repetition': ['Review', 'Finished exercises come back: those that slipped under 90%, then those due again after 1, 3, 7, 14 and 30 days. A repeat never lowers a finished score. Continue offers them too, one review and then one new step.', ['score']],
  settings: ['Settings', 'One short page: Octave, Click, Key, Scale and where the Learning Path starts, changed right there. Advanced holds the rest, in groups: Practice, Sound, MIDI and Help.', []],
};

const KIND_PAGES = {
  continue: ['Continue', 'Names and opens your next step: the next step of the ready unit whose skill you practised longest ago, in your stage. When a review is due it reads Review, and Continue alternates: one review, then one new step.', ['stage']],
  checkpoint: ['Checkpoint', 'The stage\'s exam: its check steps, played Solo; steps already passed there count. Pass them all and Continue starts at the next stage. The steps you skipped stay open, marked as assumed.', ['stage']],
  progress: ['Progress', 'Overall and per stage: steps passed over time. Then everything you have played, with a chart of each attempt.', ['stage', 'guided', 'score']],
  result: ['Result', 'Your score, and every recent attempt on a fixed 0-100% scale. Hollow points are Guided, solid ones Solo; the dotted line is 90%. REC again, BACK to the start, CLICK for next.', ['score', 'guided']],
  sheet: ['Options', 'What you can do with this row besides opening it: skip what you know, undo a skip, start the path at a stage, test out of a stage at its checkpoint, or go to the settings. Only what applies to the row is offered.', []],
  welcome: ['Welcome', 'The first pages of Piano Practice. BACK skips them; Settings > Advanced > Help > Welcome again shows them again.', []],
  tip: ['Tip', 'A tip shown the first time this kind of screen appears. Settings > Advanced > Help > Show tips again shows them all again.', []],
};

/* What each settings group holds, for its help page. */
const GROUP_TEXT = {
  main: 'Octave: which octave the pads start from. Click: the metronome. Key and Scale: what the free library is made in (the Learning Path keeps its own). Start at: the stage Continue starts from; the stages before it count as assumed, nothing is locked. Advanced: everything else.',
  practice: 'Tempo, read-ahead, how the scroll waits and judges, the names under the notes, and the quizzes\' half tones, chords and round length.',
  sound: 'The reference line that plays what you are reading, its volume, and the quiz sounds.',
  midi: 'Where the notes go: the module\'s own piano, a Move track, USB, or both, and the channel.',
  help: 'Auto info shows a practice\'s help the first time you open it. Show tips again brings the first-visit tips back; Welcome again shows the welcome.',
};

function slugOf(label) {
  return String(label).toLowerCase().replace(/[^a-z0-9#]+/g, '-').replace(/^-+|-+$/g, '');
}

/* ---- The Path ---------------------------------------------------------------- */

/* The path the session built, with its unit numbers (env.phases); without
 * one, the path as it is with no songs installed. */
let PATH = null;
const path = (env) => (env && env.phases) || PATH || (PATH = buildProgram());

const unitLine = (u) => u.num + ' ' + u.name + ': ' + u.purpose.replace(/\.$/, '') + '.';

function programPage(parts, env) {
  if (parts.length === 1) {
    return page('folder:program', 'Learning Path',
      [sec('', PATH_TEXT.intro), sec('', PATH_TEXT.order), sec('', PATH_TEXT.free),
        sec('Continue', PATH_TEXT.continue), sec('Guided and Solo', PATH_TEXT.stages)],
      ['stage', 'guided', 'score']);
  }
  const phase = path(env).find((p) => p.key === parts[1]);
  if (!phase) return null;
  if (parts.length === 2) {
    const sections = [sec('', phase.promise), sec('The idea', phase.idea),
      sec('Units', phase.units.map(unitLine).join(' '))];
    if (phase.check.length) sections.push(sec('Checkpoint', PATH_TEXT.check));
    return page('program:' + phase.key, 'Stage ' + phase.n + ': ' + phase.title, sections, []);
  }
  const unit = phase.units.find((u) => u.key === parts[2]);
  if (!unit) return null;
  const exPage = parts.length > 3 ? unit.exercises.find((e) => e.steps.length > 1 && slugOf(e.label) === parts[3]) : null;
  if (exPage) return page('program:' + unit.key + ':' + parts[3], exPage.label, exerciseSections(exPage.about, exPage.why), []);
  const after = unit.after.map((k) => path(env).flatMap((p) => p.units).find((u) => u.key === k))
    .filter(Boolean).map((u) => u.num + ' ' + u.name);
  const sections = [sec('', unit.purpose), sec('Strand', STRANDS[unit.strand] + ': ' + STRAND_TEXT[unit.strand] + '.')];
  if (after.length) sections.push(sec('Comes after', after.join(', ') + '.'));
  if (unit.summary) sections.push(sec('', unit.summary));
  return page('program:' + unit.key, unit.num + ' ' + unit.name, sections, []);
}

const exerciseSections = (about, why) => [about ? sec('What you do', about) : null, why ? sec('Why', why) : null].filter(Boolean);

/* ---- Lookup ------------------------------------------------------------------ */

export function infoFor(target, env = {}) {
  if (!target) return null;
  const label = target.label || '';
  if (target.kind === 'settings' && target.group) {
    const g = groupByKey(target.group);
    return g ? page('settings:' + g.key, g.label, [sec('', GROUP_TEXT[g.key] || '')], []) : null;
  }
  if (target.kind === 'settings') return infoFor({ id: 'settings' }, env);
  if (target.kind && KIND_PAGES[target.kind]) {
    const [title, text, terms] = KIND_PAGES[target.kind];
    return page(target.kind, title, [sec('', text)], terms);
  }
  const id = String(target.id || '');
  if (!id) return null;
  /* A step of the path: what the curriculum says about it, then the page of
   * the exercise it points at. */
  if (target.about || target.why) {
    const own = infoFor({ id, label }, env);
    const head = exerciseSections(target.about, target.why);
    return own ? { ...own, title: target.exercise || own.title, sections: head.concat(own.sections) }
      : page('step:' + id, target.exercise || label, head, []);
  }

  if (id.indexOf('quiz:') === 0) return quizPage(id.slice(5), label);
  if (id.indexOf('song:') === 0) {
    const [song, level] = id.slice(5).split('/');
    return songPage(song, level, env, label);
  }
  /* A folder with words of its own first: a Learn list, Random chords. */
  const folder = FOLDERS[id];
  if (folder) return page('folder:' + id, folder[0], [sec('', folder[1])], folder[2]);
  const parts = id.split('/');
  const ring = parts[0] === 'basics' && /^([a-z]+)-trainer$/.exec(parts[1] || '');
  if (ring) return trainerPage(ring[1], parts[2] || null, label);
  if (parts[0] === 'basics' && parts[1] === 'scales' && parts[2]) return scalePage(parts[2], parts[3], label);
  if (parts[0] === 'basics' && parts[1] === 'chords' && parts[2]) return chordPage(parts[2], parts[3], parts[4], label);
  if (parts[0] === 'basics' && parts[1] === 'progressions' && parts[2]) return progressionPage(parts[2], parts[3], label);
  if (parts[0] === 'basics' && parts[1] === 'random' && parts[2]) return randomPage(parts[2], parts[3], label);
  if (parts[0] === 'quiz' && (parts[1] === 'hear' || parts[1] === 'read') && parts[2]) {
    /* The deepest exercise or course on the path: quiz/hear/intervals/compare/cmp-6ths. */
    for (let i = parts.length - 1; i >= 2; i--) {
      const found = earPage(parts[i]);
      if (found) return found;
    }
  }
  if (parts[0] === 'program' && parts[1] !== 'repetition') return programPage(parts, env);
  return null;
}

/* A page for a screen with none of its own: its keys say what it does. */
export function screenPage(title) {
  return page(null, title || 'Help', [], []);
}

/*
 * A help page as MENU opens it: first what the screen is and its keys, one to
 * a line, the Shift layer among them; then, under "More help", what the page
 * has to say about the row or piece in front of you, and its terms.
 */
export function withScreen(info, { about = '', keys = [] } = {}) {
  const head = [];
  if (about) head.push(sec('', about));
  if (keys.length) head.push({ head: 'Keys', lines: keys });
  const more = info.sections.some((x) => x.text || (x.lines && x.lines.length)) || info.terms.some((t) => TERMS[t]);
  if (!more) return { ...info, sections: head };
  return { ...info, sections: head.concat([{ head: 'More help', divider: true }], info.sections) };
}

/*
 * The page as paragraphs, ready to wrap: each section's heading and text, a
 * blank line between sections, and the terms last, each "Name: definition".
 * Headings keep their case — ii-V-I is not II-V-I — and are marked instead.
 */
export function infoParagraphs(info) {
  const out = [];
  const add = (text, head = false) => out.push({ text, head });
  for (let i = 0; i < info.sections.length; i++) {
    const s = info.sections[i];
    if (!s.text && !(s.lines && s.lines.length) && !s.divider) continue;
    if (out.length) add('');
    if (s.head) add(s.head, true);
    if (s.lines) s.lines.forEach((l) => add(l));
    else if (s.text) add(s.text);
  }
  const terms = info.terms.filter((k) => TERMS[k]);
  if (terms.length) {
    add('');
    add('Terms', true);
    for (let i = 0; i < terms.length; i++) {
      const [name, text] = TERMS[terms[i]];
      add(name + ': ' + text);
    }
  }
  return out;
}

/* Word-wrap paragraphs to a pixel width, keeping each line's heading mark. A
 * word longer than a whole line is cut rather than run off the screen. */
export function wrapLines(paragraphs, maxPx, widthOf) {
  const lines = [];
  for (let p = 0; p < paragraphs.length; p++) {
    const { text, head } = paragraphs[p];
    const words = text.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push({ text: '', head: false });
      continue;
    }
    let line = '';
    const push = (t) => lines.push({ text: t, head });
    for (let w = 0; w < words.length; w++) {
      let word = words[w];
      while (widthOf(word) > maxPx) {
        let cut = word.length - 1;
        while (cut > 1 && widthOf(word.slice(0, cut)) > maxPx) cut--;
        if (line) { push(line); line = ''; }
        push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const next = line ? line + ' ' + word : word;
      if (widthOf(next) > maxPx && line) {
        push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) push(line);
  }
  return lines;
}
