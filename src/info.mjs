/*
 * info.mjs — what every practice is, and the words it uses. Pure.
 *
 * Menu opens an Info page for whatever you are looking at: the highlighted row
 * of the list, the armed exercise, the drill under way. The page says what the
 * practice asks, how to go about it, and defines each term it uses — from one
 * glossary, so a word is explained the same way everywhere and only once.
 *
 * Where the facts already live in the code they are derived, not retyped: a
 * scale's step pattern comes from its intervals, a chord's formula and notes
 * from its quality, a progression's chords from its steps. Hand-written text
 * is for what code cannot know — how a minor chord sounds, what to listen for.
 *
 * infoFor(target, env) -> { key, title, sections: [{ head, text }], terms } | null
 *   target   { id, label, kind }   kind marks rows with no id: 'continue',
 *            'skip', 'progress', 'result'
 *   env      { songs: id -> chart }   for a song's key and tempo
 *
 * `key` names the page for "seen it already": one per kind of practice, not
 * per row, so the first scale drill explains scale drills once.
 */

import { MODES, MODE_LABELS } from './generator.mjs';
import { qualityById } from './chords.mjs';
import { CHORD_FAMILIES, PROGRESSIONS, LESSON_NAMES } from './chord_lessons.mjs';
import { EXERCISES } from './ear.mjs';
import { LEVELS } from './levels.mjs';

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
  stage: ['Stage', 'Stage 1 lights each pad as its note comes. Stage 2 lights nothing: you read.'],
  score: ['Score', 'Notes hit, over the notes in the piece plus wrong presses. 90% passes a stage.'],
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
  return page('scales', label || name, sections, ['scale', 'tone', 'semitone', 'root', 'stage']);
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
  const tonic = prog.minor ? 9 : 0;
  return prog.steps.map(([deg, qid]) => {
    const q = qualityById(qid);
    const root = spellFromC(String(degreeNumberOf(deg, prog.minor) || 1), (tonic + deg) % 12);
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
  const prog = PROGRESSIONS.find((p) => p.id.replace(/\s+/g, '-') === progId);
  const sections = [];
  if (prog) {
    sections.push(sec(prog.id, 'In ' + (prog.minor ? 'A minor' : 'C') + ': ' + progressionInC(prog) +
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
  thirds: ['Two notes a 3rd apart: major or minor?', 'Major is 4 semitones, bright: the start of When the Saints. Minor is 3, darker: Greensleeves.', ['interval', 'majmin']],
  triads: ['A triad: major or minor?', 'Major sounds bright and settled, minor darker. Broken plays the notes one by one, block together, inverted with another note at the bottom.', ['triad', 'majmin', 'broken', 'inversion']],
  perfect: ['A 4th, a 5th or an octave?', 'Octave: the same note, higher (Over the Rainbow). 5th: open and hollow (Twinkle). 4th: Here Comes the Bride.', ['perfect', 'octave', 'interval']],
  'seconds-thirds': ['Minor 2nd, major 2nd, minor 3rd or major 3rd?', 'The small intervals melodies are made of. m2 is Jaws, M2 Happy Birthday.', ['interval', 'majmin', 'step']],
  'intervals-up': ['Two notes, rising. Name the interval.', 'Levels add intervals: 2nds to 5ths and the octave, then 6ths, then all twelve. Tie each to a tune you know.', ['interval', 'majmin', 'perfect', 'tritone']],
  'intervals-down': ['Two notes, falling. Name the interval.', 'Falling intervals sound different from rising ones: learn them separately.', ['interval', 'majmin', 'perfect', 'tritone']],
  'intervals-together': ['Two notes at once. Name the interval.', 'Small intervals rub, 3rds and 6ths are sweet, 4ths, 5ths and octaves hollow.', ['interval', 'majmin', 'perfect', 'tritone']],
  'four-triads': ['Major, minor, diminished or augmented?', 'Diminished is small and tense, augmented stretched and eerie.', ['triad', 'quality', 'broken']],
  'key-quality': ['A scale or a short tune: major key or minor key?', 'Listen to the 3rd note of the scale and to where the tune comes to rest.', ['key', 'majmin', 'tonic']],
  home: ['A chord sets the key, then a short tune. Did it end at home?', 'Ending on the tonic sounds finished; anywhere else leaves it hanging.', ['tonic', 'key']],
  degrees: ['A cadence sets the key, then one note. Which degree is it?', 'Sing down from the note to home and count the steps.', ['degree', 'tonic', 'key']],
  sevenths: ['A seventh chord: which kind?', 'maj7 dreamy, 7 bluesy and restless, m7 soft and mellow, m7b5 dark.', ['seventh', 'quality', 'broken']],
  functions: ['The home chord, then another chord of the key: IV, V or vi?', 'IV lifts, V wants to go home, vi is the minor one.', ['numerals', 'progression', 'tonic']],
  'playback-chords': ['A chord plays. Find it and hold all its notes at once.', 'Find the bass note first, then build up. Part of it down is not yet wrong.', ['chord', 'root']],
};

function earPage(exKey, levelKey) {
  const ex = EXERCISES.find((e) => e.key === exKey);
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

/* The quiz rows: Play and Name, notes or chords; hearing play-back. */
function quizPage(drill, label) {
  const [mode, kind, set] = drill.split(':');
  if (mode === 'ear') return earPage(kind, set);
  if (mode === 'hear') return earPage(kind === 'chords' ? 'playback-chords' : 'playback-notes', set);
  const chords = kind === 'chords';
  const what = chords
    ? (set === 'triads' ? 'the triads of the key' : set === 'advanced' ? 'every chord type, ninths and altered too' : 'chord types: dim, sus, 6ths, 7ths')
    : (set === 'half' ? 'every note, black keys too' : 'the notes of the key');
  const sections = mode === 'pick'
    ? [sec('', 'A pad lights up - several for a chord. Name it: turn the jog to an answer and click.'),
      sec('', 'The wrong answers are near misses, so a rough guess will not do. Asks ' + what + '.')]
    : [sec('', 'A ' + (chords ? 'chord' : 'note') + ' sits on the staff, named. Find it on the pads and play it' +
        (chords ? ', all its notes at once' : '') + '.'),
      sec('', 'On this grid one note sits on several pads: any of them counts. Asks ' + what + '.')];
  sections.push(sec('', 'A round is 20 right answers; the score is answers a minute. Half tones and Chords in settings change what is asked.'));
  return page(mode === 'pick' ? 'quiz:name' : 'quiz:play', label || (mode === 'pick' ? 'Name' : 'Play'), sections,
    chords ? ['chord', 'triad', 'quality', 'hint'] : ['sharp', 'octave', 'hint']);
}

function songPage(songId, level, env, label) {
  const chart = env && env.songs ? env.songs[songId] : null;
  const sections = [];
  if (chart) {
    const ks = chart.keySig || 0;
    const sig = ks === 0 ? 'no sharps or flats' : Math.abs(ks) + (ks > 0 ? ' sharp' : ' flat') + (Math.abs(ks) > 1 ? 's' : '');
    sections.push(sec(chart.name, 'Key signature: ' + sig + '. Tempo ' + chart.bpm + '; knob 8 slows it while it is new.'));
  }
  const lv = levelLine(level);
  if (lv) sections.push(lv);
  sections.push(sec('', 'Every level sits on the same pads, so what you learn at L1 carries to L3. Stage 1 lights the pads, stage 2 is reading alone.'));
  return page('songs', label || (chart ? chart.name : 'Song'), sections, ['level', 'hands', 'stage', 'score']);
}

const FOLDERS = {
  basics: ['Basics', 'Scales, chords, progressions and random drills, all made from your settings: the Key, Scale and Tempo.', ['key', 'scale']],
  'basics/scales': ['Scales', 'One folder per scale, each with five drills: up and down, up, down, in 3rds and in 5ths.', ['scale', 'tone', 'semitone']],
  'basics/chords': ['Chords', 'Thirteen families, one lesson per chord quality, each on all twelve roots.', ['chord', 'quality', 'formula']],
  'basics/progressions': ['Progressions', 'Ten common chord progressions in the Key setting\'s key.', ['progression', 'numerals']],
  'basics/random': ['Random', 'Random notes and chords, a new set every time.', ['key', 'chord']],
  quiz: ['Quiz', 'Short timed rounds. Hear: name a sound. Play: find a shown note on the pads. Name: name a lit pad.', ['hint']],
  'quiz/hear': ['Hear', 'Ear training, easiest first: high and low, steps, intervals, chords, keys.', ['interval', 'chord']],
  'quiz/play': ['Play', 'A note or chord is shown on the staff; find it on the pads.', ['octave']],
  'quiz/name': ['Name', 'A pad lights; name it with the jog.', ['sharp']],
  classics: ['Classics', 'Folk tunes and classics, easy first, each at four levels.', ['level', 'hands']],
  electronic: ['Electronic', 'The chord progressions of famous tracks - never their melodies - and five style pieces.', ['progression', 'level']],
  techno: ['Techno', 'Fourteen chord studies, simple to complex: stabs, pads, parallel shapes.', ['progression', 'level']],
  styles: ['Styles', 'Pop, indie, film, soul and funk pieces, each written to drill a style.', ['level']],
  other: ['Other', 'Exercises you added yourself.', []],
  program: ['Learning Program', 'A path through everything, in four tracks. Continue opens the next step of the track you left longest. Nothing is locked.', ['stage', 'score']],
  'program/reading': ['Reading', 'Scales, intervals and random lines, then the first tunes.', ['scale', 'interval']],
  'program/chords': ['Chords', 'Triads to altered chords, and the progressions they make.', ['chord', 'progression']],
  'program/songs': ['Songs', 'Every bundled piece, rung by rung: L1 RH, L1 LH, L2, L3.', ['level']],
  'program/hearing': ['Hearing', 'The hearing exercises in order, easiest first.', ['interval']],
  'program/repetition': ['Repetition', 'Finished exercises come back: those that slipped under 90%, then those due again after 1, 3, 7, 14 and 30 days. A repeat never lowers a finished score.', ['score']],
};

const KIND_PAGES = {
  continue: ['Continue', 'Opens the next step of the track you have practised least recently, on the stage it needs.', ['stage']],
  skip: ['Skip', 'Passes the next step by; it is marked and you can come back any time. After stage 1 it moves on instead: stage 1 is enough for now.', ['stage']],
  progress: ['Progress', 'Overall and per track: stages passed over time. Then everything you have played, with a chart of each attempt.', ['stage', 'score']],
  result: ['Result', 'Your score, and every recent attempt on a fixed 0-100% scale. Hollow points are stage 1, solid ones stage 2; the dotted line is 90%. REC again, BACK to the start, CLICK for next.', ['score', 'stage']],
};

function slugOf(label) {
  return String(label).toLowerCase().replace(/[^a-z0-9#]+/g, '-').replace(/^-+|-+$/g, '');
}

/* ---- Lookup ------------------------------------------------------------------ */

export function infoFor(target, env = {}) {
  if (!target) return null;
  const label = target.label || '';
  if (target.kind && KIND_PAGES[target.kind]) {
    const [title, text, terms] = KIND_PAGES[target.kind];
    return page(target.kind, title, [sec('', text)], terms);
  }
  const id = String(target.id || '');
  if (!id) return null;

  if (id.indexOf('quiz:') === 0) return quizPage(id.slice(5), label);
  if (id.indexOf('song:') === 0) {
    const [song, level] = id.slice(5).split('/');
    return songPage(song, level, env, label);
  }
  const parts = id.split('/');
  if (parts[0] === 'basics' && parts[1] === 'scales' && parts[2]) return scalePage(parts[2], parts[3], label);
  if (parts[0] === 'basics' && parts[1] === 'chords' && parts[2]) return chordPage(parts[2], parts[3], parts[4], label);
  if (parts[0] === 'basics' && parts[1] === 'progressions' && parts[2]) return progressionPage(parts[2], parts[3], label);
  if (parts[0] === 'basics' && parts[1] === 'random' && parts[2]) return randomPage(parts[2], parts[3], label);
  if (parts[0] === 'quiz' && parts[1] === 'hear' && parts[2]) return earPage(parts[2]);
  if (parts[0] === 'program' && parts.length > 2) return infoFor({ id: parts.slice(0, 2).join('/') }, env);

  const folder = FOLDERS[id];
  if (folder) return page('folder:' + id, folder[0], [sec('', folder[1])], folder[2]);
  return null;
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
    if (!s.text) continue;
    if (out.length) add('');
    if (s.head) add(s.head, true);
    add(s.text);
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
