# Piano Practice

A scrolling sight-reading trainer for [Schwung](https://github.com/charlesvestal/schwung) on the Ableton Move.

A treble clef and five staff lines sit still on the left of the 128×64 screen. Notes and bar lines
scroll in from the right, cross the hit line, and vanish just before the clef. Play the right pad at
the right moment and the notehead opens into a **ring**. Miss it, or play it late, and it turns into an
**✗**. A second ring marks where you actually played, so the gap between the two is your timing error.
Under each note its name scrolls along — `F#` for a single note, `F# C E` for a chord.

Piano Practice is an independent module for Schwung. It is not made or supported by Ableton.

```
 PIANO PRACTICE                                         2.3
 ────────────────────────────────────────────────────────────
                                    ─ ─ ─
        ╭─╮   │  ──────────────────────────────────────────
        │ │   │  ─────────────────●────────────────────────
        ╰─┼─  │  ──────■─────────────────────│─────────────
          │   │  ──✗────────────────────────────●──────────
         ╭┼╮  │  ──────────────────────────────────────────
         ╰─╯  │        ─ ─ ─
 ─────────────┼──────────────────────────────────────────────
              │  G4    B4        D5          F#5
 ────────────────────────────────────────────────────────────
 ▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░    14/2
              ↑ hit line        ←── notes scroll this way
```

## What it does

- **Reads like sheet music.** Real treble-clef notation: staff lines, ledger lines, accidentals,
  bar lines. Two ledger steps either side give a working range of A3–C6.
- **Scores like a rhythm game.** A hit inside ±60 ms is *perfect*, ±120 ms is *good*, and past
  180 ms the note is gone. Chords are judged per note — nail two of three and the two you got turn
  into circles while the one you missed turns into an ✗ in the same stack.
- **Waits for you.** Past the grace, the scroll stops at a note until you play it, then resumes in
  tempo. Inside the grace it never stops, so a slightly late note does not break the rhythm.
- **Shows your timing.** Every press leaves a circle at the exact moment it happened. Play in time
  and it lands on the notehead as one mark; play late and the gap between the two circles is your
  error, read straight off the staff.
- **Generates its own material.** Scales in all of Move's 22 scales, every chord quality on all twelve
  roots, progressions in your key, and random notes and chords — seeded, so a restart replays the
  exact drill you just fluffed.
- **Teaches a piece in four steps.** Classics, electronic track studies, techno progressions and
  style pieces, each arranged for two hands on one page of pads and playable at four levels: right
  hand alone, left hand alone, right hand with its chords, then both together. Pick the song, then
  pick the level.
- **Takes hand-written exercises** as JSON, interchangeable with the generated ones.
- **Sounds like a piano, with no setup** — the module renders its own polyphonic piano and mixes it
  into Move's audio. No track, no instrument, no MIDI channel to match. MIDI out to a track or a
  computer is there if you want it.
- **Rescues you when you are stuck.** Miss a note and the scroll stops, names it large on screen,
  and — at stage 1 — pulses the pad you need. The missed note itself stays pinned by the hit line
  whatever your read-ahead, so you can always see what you are being asked for.
- **Teaches in two stages.** Every exercise is played first with the pads lighting the way, then
  read from the staff alone. You can go straight to the second whenever you like.
- **Remembers how far you got.** Every exercise keeps its own score, a ◐ for stage 1 and a ✓ for
  stage 2, and a chart of every attempt. Folders add up what is inside them.
- **Tells you what to do next.** The Learning Program runs four tracks — reading, chords, songs and
  ear — and Continue always knows the next step. Nothing is locked: follow it, or don't.

## The lesson list

The list is a tree. **Click** opens a folder, **Back** goes up one, and Back at the top leaves.

```
Learning Program  Continue      the next step, one click away
                  Skip next     pass it by
                  Reading       scales, lines and first tunes
                  Chords        triads to altered dominants, and progressions
                  Songs         every bundled piece, rung by rung
                  Ear           the quiz drills
                  Repetition    finished exercises that are due again
Basics            Scales        one folder per Move scale: Up & down, Up, Down, Thirds, Fifths
                  Chords        thirteen families, one lesson per chord quality
                  Progressions  ten progressions in the Key setting's key
                  Random        random notes, and random chords from the whole vocabulary
Quiz              Hear    name what you hear, or play it back
                  Play    notes by alphabet or staff, chords by name or staff, in a moving row
                  Name    name the pad that is lit
Classics          folk tunes and the classics, easy first
Electronic        the chord loops of famous tracks, and five electronic style pieces
Techno            fourteen progression studies, simple to complex
Styles            pop, indie, film, soul, funk
Progress          how far you have got, and how you got there
```

Everything with a left and a right hand — every song, every chord lesson — opens its four levels.

Every row says how far you have got with it. An exercise shows its score — `87%` — with a **◐** once
you have passed stage 1 and a **✓** once you have passed stage 2. A folder shows the average of
everything inside it, so `Classics 25%` is a quarter of the way through the classics.

## Levels

Every bundled tune is one file with both hands written into it, and the four levels are cut out of
that one file. Click a song and you get its ladder:

| | | |
| --- | --- | --- |
| **L1** | RH melody | the right hand alone, one note at a time |
| **L1** | LH bass | the left hand alone — the bass line |
| **L2** | RH chords | the melody with its chords under it |
| **L3** | Both hands | the two together |

**All four sit in the same register.** Nothing is transposed between levels, so the pads you learn
playing the right hand at L1 are the pads you play at L3 — what you learn transfers literally rather
than by analogy. **Back** from a song returns to its ladder rather than all the way out, because
having just played the right hand the next thing you want is the left hand of the same piece.

Every bundled song has all four, and `npm test` holds them to it. A file you write yourself with
nothing to split shows only the levels it actually has, and arms straight away if that is one.

## Stages

Levels decide *what* you play. Stages decide *how much help* you get playing it, and every exercise
has two:

| | |
| --- | --- |
| **Stage 1** | the pad you need lights up as its note comes, brightening as it nears — and pulses when the scroll stops on a missed note. You learn the shape |
| **Stage 2** | nothing lights. You read it off the staff |

**Passing a stage takes 90% or better**, at any tempo — slow a song down with knob 8 while it is
new, it still counts. Passing stage 1 earns a **◐**, passing stage 2 a **✓**. Passing stage 2 also
counts as stage 1: if you can read it unaided, you can read it with help.

An exercise opens on the **first stage you have not yet passed**, and the ready screen says which:
`S1 pads lit  JOG: S2`. Turn the jog to change it — right for stage 2, left for stage 1. Nothing
forces you through stage 1 first.

**How a run is scored:** the notes you hit, over the notes in the piece **plus any wrong presses**,
so sweeping the pads under every note cannot score full marks. A row shows your **latest** run,
because that is where you are now — but once a stage is passed its score **never drops** again.
Practising something you have finished should never feel like losing it.

**Only a whole run counts.** A run you start from the top is recorded; one started from a scrubbed
bar is passage practice and is not, and neither is Listen.

### A first session

1. Open **Basics › Scales › Major › Up & down**. The ready screen says `S1 pads lit`.
2. Press **Record**. The pads show you each note as it arrives; play along.
3. At the end you see your score and a chart. 93%: stage 1 is passed, the row will show ◐.
4. **Click** for stage 2. The pads stay dark now; read it from the staff.
5. Press **Back** after a result to try the same thing again from the top. Back once more for the
   list, where the row now reads `97% ✓`.

## The Learning Program

The lesson list holds everything; the **Learning Program** is a path through it. Seven tracks run
side by side, because reading, harmony, repertoire and ear are different skills and a session that
mixes them beats one that grinds a single list:

| Track | What it walks you through |
| --- | --- |
| **Reading** | major scales up, down, in thirds and fifths; random lines in key; the first tunes' melodies; minor and the modes; pentatonics and blues; then every note |
| **Chords** | major and minor triads, alone then over their roots; diminished and augmented; inversions and sus chords; four progressions; sevenths and ii–V–I; sixths, add9 and ninths; the 12-bar blues; then the advanced chords |
| **Songs** | every bundled piece in turn — classics, then styles, electronic and techno — each rung by rung: L1 RH, L1 LH, L2, L3 |
| **Ear** | the quiz: notes in key, then every note, triads, chord types and advanced chords — each guessed, picked and heard |
| **Intervals** | the Identify intervals course: 2nds up to two octaves |
| **Compare** | the Compare intervals course: which of two intervals is bigger |
| **Scales** | the Identify scales course: major and minor, then the modes |

Each track is in units, and each unit is a few steps. A step is simply a row of the lesson list, so
**it counts however you get there**: play Ode to Joy from Classics and its step in the program is
done too.

**Continue** opens the next step of the track you have left longest, on the stage it needs. A
track's next step is its first one that is neither finished nor skipped. Finished means stage 2
passed — or stage 1 passed and then *moved on* from (below). So clicking Continue session after
session walks all the tracks in turn, and you always know what to do next.

**Nothing is locked.** Open any track and any step in it, play anything in the list, go straight to
stage 2 — the program only ever recommends. The step Continue will open is marked **▸**.

**Skip next** passes the step Continue would open. It is marked `»` and stays where it was — open
it any time and play it, and the skip is forgotten. If you have already passed its stage 1, Skip
reads **Move on** instead: stage 1 is enough for now, and the step counts as finished at ◐.

In a quiz there are no pads to light, so the stages are the hints: **stage 1 is a round at 90% or
better with hints, stage 2 one without any**.

### Repetition

What you have finished comes back. **Repetition** lists today's session, at most five exercises:

1. first, any finished exercise whose last run **slipped under 90%**;
2. then those **due again** — one day after you finished, then 3, 7, 14 and 30 days, the gap growing
   each time a repeat goes well and starting over when one does not.

A repeat is recorded and shows on the exercise's chart, but **never lowers its finished score**. The
row says `due`, and `today ✓` once you have done it.

## Info and terms

**Menu** explains whatever is in front of you. Press it on a row of the list, on the ready screen,
during a quiz or on a result, and an **Info** page says what the practice asks, how to go about it,
and what each word it uses means. The jog scrolls; **Back** or **Menu** closes it and puts you back
exactly where you were.

| Pressed on | Info explains |
| --- | --- |
| a row of the list | that folder or exercise — read before you choose |
| the ready screen | the armed exercise: what it drills, its levels and stages |
| a quiz or hearing round | the drill and what to listen for. **The round's clock stops** while you read |
| a running exercise | the same — the music pauses first |
| a result | what the score and the chart mean |

Some pages are written from the music itself rather than by hand: a chord lesson shows the chord's
formula and its notes in C (`Minor 7th: 1 b3 5 b7 — C Eb G Bb`), a scale its pattern of tones and
semitones (`W W H W W W H`), a progression its chords in C or A minor.

**The first time** you open a kind of practice — the first scale drill, the first song, each hearing
exercise — its Info page shows by itself, once. **Auto info** in settings turns that off; Menu always
brings the page back.

Every term an Info page uses is defined from one glossary, the same one Schwung's **Help** viewer
shows under Piano Practice › Terms:

<!-- glossary:start (generated by npm run docs) -->
| Term | Meaning |
| --- | --- |
| **Semitone** | The smallest step: the next pad to the right. |
| **Tone** | Two semitones. W (whole) in a step pattern; a semitone is H (half). |
| **Octave** | The same note 12 semitones up. On the pads: two rows up, two right. |
| **Sharp, flat** | # raises a note a semitone, b lowers it. C# and Db are one pad. |
| **Scale** | Notes climbing from a root by a fixed pattern of tones and semitones. |
| **Key** | The scale a piece is built from, named by its root: G major, A minor. |
| **Root** | The note a scale or chord is named after and built on. |
| **Tonic** | The root of the key: home. A tune ending there sounds finished. |
| **Degree** | A note's place in the scale, counted from the root: 1 to 7. |
| **Interval** | The distance between two notes, named by the letters it spans: C-E spans C D E, a 3rd. |
| **Major, minor** | Interval sizes. A major 3rd is 4 semitones, a minor 3rd 3. Major sounds brighter. |
| **Perfect** | 4ths, 5ths and octaves: the most stable intervals, neither major nor minor. |
| **Tritone** | 6 semitones, half an octave. Tense, unresolved. |
| **Compound interval** | Wider than an octave: an octave plus a simple interval. A 9th is an octave and a 2nd, a 12th an octave and a 5th. |
| **Mode** | A scale started from another of its notes: D to D on the white keys is Dorian. Each mode has its own pattern of steps. |
| **Step** | Two neighbouring notes of the scale, a 2nd apart: C-D. |
| **Leap** | Two scale notes further apart than a step, a 3rd or more: C-E. |
| **Contour** | The shape of a melody: which way each note moves. |
| **Chord** | Three or more notes sounding together. |
| **Triad** | Three notes stacked in 3rds: root, 3rd, 5th. C-E-G is C major. |
| **Quality** | What kind a chord is: major, minor, diminished, seventh... |
| **Formula** | A chord's notes as degrees of the root's major scale: minor is 1 b3 5. |
| **Inversion** | A chord with another of its notes at the bottom. C/E is C major over E. |
| **Seventh chord** | A triad with a 7th on top: four notes. |
| **Voicing** | Which octave each note of a chord sits in, and in which hand. |
| **Broken, block** | Broken: a chord's notes one after another. Block: all at once. |
| **Progression** | A sequence of chords, named by Roman numerals for the degree each starts on: I, IV, V. |
| **Roman numerals** | I is the chord on degree 1. Upper case is major, lower case minor: vi is minor. |
| **Slash chord** | A chord over a bass note that is not its root: D/F# is D major over F#. |
| **RH, LH** | Right hand plays the melody and chords, left hand the bass. |
| **Level** | How much of a song you play: L1 one hand's line, L2 the chords, L3 both hands. |
| **Stage** | Stage 1 lights each pad as its note comes. Stage 2 lights nothing: you read. |
| **Score** | Notes hit, over the notes in the piece plus wrong presses. 90% passes a stage. |
| **Hint** | REC helps, two presses deep. A hinted answer still counts, and is noted. |
<!-- glossary:end -->

## Sounds in a quiz

A right answer plays a short **chime** — the key's major chord rising, high and soft, above the pads
so it never sounds like a note of the question — and a wrong one an **uh-oh**: the key's 5th falling
to its 3rd, sol-mi, in the middle of the range where the Move's speaker carries it. Both are played
on the module's own piano. **Quiz sounds** in settings turns them off.

### Why the arrangements are in the keys they are

The pads reach **23 semitones**, MIDI 57–79. That is the whole budget, and at L3 both hands have to
live inside it — there is no second octave to put a bass line in. So the bass is not really a bass:
it is a tenor line sitting an octave under the tune, which is what 32 pads allow.

It also decides the keys. Twinkle in C puts its top A at MIDI 81, two semitones off the end of the
grid, so it is in A major here, where it is 78 and the bass gets A3–D4–E4 down at the bottom of the
grid. Frère Jacques spans a ninth and is in B flat for the same reason. Für Elise is re-barred:
Beethoven writes sixteenths, a note more than 180 ms late is gone, so every sixteenth is written as
an eighth and two of his bars make one of these.

The bundled songs, and what their left hand does at L3:

| Song | Key | L3 left hand |
| --- | --- | --- |
| Ode to Joy | C | the descending C–B–A–B line; four notes, a step apart |
| Twinkle | A | root per bar |
| Marys Lamb | C | one whole note a bar, only ever C4 or G4 — the gentlest L3 here |
| Frere Jacques | B♭ | a tonic pedal for four bars before it moves at all |
| Jingle Bells | A | oom-pah, root then fifth |
| Greensleeves | Am | broken chord, one note per dotted beat |
| Fur Elise | Am | his A–E–A figure, thinned to two notes a bar |
| Minuet in G | G | Petzold's walking line, every G taken over B |
| Amazing Grace | C | root per bar, I–IV–V |
| Scarborough | A dorian | a walking line rather than a set of anchors |
| Rising Sun | Am | six eighths a bar, arpeggiated — the riff *is* the song |
| The Saints | C | oom-pah, I–IV–V |
| Auld Lang Syne | A | root and fifth, a half-bar each |
| Korobeiniki | Am | a driving crotchet root, four to the bar |
| London Bridge | A | root and fifth, a bar each |
| Lullaby (Brahms) | G | a tenor line: B under G, the seventh C under D7, resolving down |
| Canon in D (Pachelbel) | D | the ground bass, its G an octave up; the second violin gives way where it meets it |
| Bach Prelude (BWV 846) | B♭ | bars 1–8, his two-note bass, a whole tone down so bar 3 reaches A3 |

Classics lists them easy to hard. Marys Lamb, London Bridge and Frere Jacques are the easy end of
L3; the Minuet, the Bach Prelude and Fur Elise the hard end. Bach's sixteenths are written as eighths,
as Für Elise's are.

## Basics

Everything in Basics is generated from the settings rather than stored: it plays at the **Tempo**
setting, follows the **Transpose**, and an armed lesson is rebuilt when the **Key** changes.

### Scales

A folder for each of Move's 22 scales, each with **Up & down**, **Up**, **Down**, **Thirds** and
**Fifths**. The **Key** setting picks the root. The folder picks the scale, so Dorian is Dorian
whatever the Scale setting says.

### Chords

Every chord quality the module can name, each a lesson of its own. A lesson plays its chord on all
twelve roots in falling fifths, C F B♭ E♭ A♭ D♭ G♭ B E A D G — the order the cycle is practised in.

| Family | Lessons |
| --- | --- |
| Triads | major, minor, diminished, augmented |
| Sus & power | sus2, sus4, power chord (5) |
| Inversions | major and minor triads in root position, first and second inversion — right hand only |
| Sixths | 6, m6, 6/9 |
| Sevenths | maj7, 7, m7, m7b5, dim7, mMaj7, 7#5, maj7#5 |
| Added tones | add9, madd9, add11, madd11 |
| Ninths | 9, maj9, m9 |
| Suspended 7ths | 7sus2, 7sus4, 9sus4 |
| Elevenths | 11, m11 |
| Thirteenths | 13, maj13, m13 |
| Lydian | maj7#11, 7#11 |
| Altered | 7b5, 7b9, 7#9, 7alt |
| Slash chords | C/E, C/G, D/F#, G/B, Am/G, F/C, B♭/C, D/C |

**How a chord is voiced.** The left hand plays the root, in the bottom octave of the pads. The right
hand plays the chord in whichever close position sits above it and moves least from the chord
before. That is voice leading, which is how a keyboard player actually changes chords, and it is also
what fits twelve roots into 23 semitones. So the right hand meets inversions as it goes, and the
Inversions family drills them on purpose.

- Up to four notes, the right hand keeps the root too, so it learns the whole shape.
- From five notes the root is left to the left hand.
- The six-note chords use the voicings pianists use: **C11** is B♭/C, and **C13** is E A B♭ D over C.
- Where even the closest voicing will not fit — A♭maj7 over A♭3 has eleven semitones to live in —
  the right hand lets go of the root, then the fifth.

The ladder means something particular here. **L1 RH** is the top voice, the line voice leading
draws. **L1 LH** is the roots round the cycle. **L2** is the shapes. **L3** is both. When the scroll
stops on a chord, it names the chord — `C13`, `D/F#` — whatever the right hand holds on its own.

### Progressions

I–IV–V–I, I–V–vi–IV, vi–IV–I–V, I–vi–IV–V, ii–V–I, vi–ii–V–I, i–iv–v–i, i–VI–III–VII, ii–V–i in minor,
and the 12-bar blues, voiced the same way, in the key the **Key** setting names. The list names the
shape; the header names it in your key.

### Random

| | |
| --- | --- |
| All notes | a walk over every pitch the pads reach, black keys included |
| In key / In key, fast | random lines in the Key and Scale settings, in quarters and in eighths |
| All chords | sixteen chords, any root, any quality the module knows |
| Triads / Sevenths | the same, from the four triads or the eight sevenths |

The chord sets open the usual ladder. Each opening draws a new set, and a restart replays the one
you just played.

## Electronic

Track studies. Each is named after the track it studies and takes what is not anyone's property: the
chord progression, the chord by chord harmonic rhythm, the tempo, the key, and the generic feel of
the keyboard part — offbeat stabs, a held pad, a bouncing bass. It never takes the melody, the hook
or riff, the lyrics or a sound. The right hand plays the chords with a top line of chord tones that
is not the hook; the left hand plays the track's bass motion as roots and fifths.

| Study | Track | Key, tempo | The chords | The figure |
| --- | --- | --- | --- | --- |
| The Model | Kraftwerk, *The Model* (1978) | Am, 124 | Am – Em; bridge C – Bm – G – C – Bm – E | held chords over an eighth-note bass |
| Teardrop | Massive Attack, *Teardrop* (1998) | A, 77 | A – Gsus2 – D – A; Fmaj7 – G6 – A | held chords, two a bar |
| Porcelain | Moby, *Porcelain* (1999) | B♭ mixolydian, 95 | Gm7 – B♭ – Fm – A♭, half a bar each | sustained strings |
| Blue Monday | New Order, *Blue Monday* (1983) | Dm, 130 | F C – Dm – G C – Dm | pads over an eighth-note bass |
| Midnight City | M83, *Midnight City* (2011) | Bm, 105 | G – Bm – A – Em(7) | an arpeggio, then pads |
| Good Life | Inner City, *Good Life* (1988) | Bm, 121 | Bm – F♯m – Am – Em, all minor, two beats each | three stabs a chord |
| Get Lucky | Daft Punk, *Get Lucky* (2013) | B dorian, 116 | Bm7 – D – F♯m7 – E | funk comping over roots on the beat |
| Wake Me Up | Avicii, *Wake Me Up* (2013) | Bm, 124 | Bm G – D; chorus Bm G – D A | offbeat, then eighth-note stabs |
| Levels | Avicii, *Levels* (2011) | C♯m, 126 | C♯m E – B A, the A pushed in on the and of 2; C♯sus4 and Asus2 every second pass | pumping offbeat chords |
| Better Off | Alice Deejay, *Better Off Alone* (1999) | G♯m, 137 | E(add9) – D♯m – G♯m – D♯m/F♯ | offbeat chords over an offbeat bass |
| One More Time | Daft Punk, *One More Time* (2000) | D / Bm, 123 | Gmaj7 for six and a half beats, A on the and of 3; breakdown G – D/F♯ – Em7 – A7sus4 | a held chord and a push |
| Sounds Better | Stardust, *Music Sounds Better With You* (1998) | Am, 124 | Em7, two hits, Fmaj7 on the and of 2, three times; Em7/G – Am | short hits and a held chord |
| Digital Love | Daft Punk, *Digital Love* (2001) | A, 125 | D – C♯m – F♯m – E7sus4, each pushed in an eighth early | anticipated chords |

Every progression was checked against two independent sources before it was written: Hooktheory's
TheoryTab data, which gives each chord's beat and length, and a second chord chart. A track whose
sources disagreed was left out rather than guessed — Children, Born Slippy, Can You Feel It, Strobe,
Opus, Insomnia, Show Me Love and Strings of Life among them — and where two charts disagree on a
single chord, the study leaves that chord out (Wake Me Up's chorus ends before its F♯ or F♯m). The
keys are the records' own; every study fits the pads in its original key.

The five electronic style pieces sit after them: Ambient, Lofi Sunday, House Stabs, Synthwave and
Minor Trap. They are original pieces written to drill a style.

## Techno

Fourteen original studies, simple to complex, each built on one technique. From Deep Vamp on, the
left hand keeps a four-to-the-floor root on every beat against offbeat stabs in the right, so the
hands alternate — which is the coordination techno keys ask for.

| Study | What it drills | Where it comes from |
| --- | --- | --- |
| Dub Stab | one Cm7 stab, two a bar, then four | Basic Channel's dub techno |
| Colour Shift | one root, the colour on top moving: m7, m9, m11 | minimal techno's "chord on a filter", by hand |
| Deep Vamp | i7–iv7, Am7–Dm7, the common tone held | deep house and techno |
| Phrygian | i–♭II, Am–B♭, a semitone up and back | dark and industrial techno |
| Pedal Point | Am, G/A, F/A, Em/A over a bass that never moves | a techno staple |
| Parallels | one minor shape moved whole: i–v–vii–iv | Inner City's *Good Life* |
| Chord Memory | one rootless m7 stab transposed with the bass | Underground Resistance, *Timeline* |
| Sus Pads | sus2 chords in parallel, arpeggiated then held | melodic techno |
| i-VI-III-VII | Am–F–C–G | melodic techno and trance |
| i-VII-VI-VII | Am–G–F–G | anthem techno |
| Andalusian | Am–G–F–E | hypnotic and hard techno |
| Detroit m9 | rootless m9 pads moved in parallel | Detroit's second wave |
| Quartal | stacked fourths in parallel over a held A | Detroit, UR |
| Thirds Cycle | m11 chords a minor third apart: C, E♭, F♯, A | symmetric harmony |

The written tempos are the genre's, 118–130. Knob 8 slows any of them while a study is new.

## Styles

Pop Ballad, Indie Anthem, Cinematic, Neo Soul and Funk Clav — original pieces, each written to
drill a style.

## Note guesser and ear training

The **Quiz** folder asks in three ways, one folder each:

| Folder | You are given | You answer by |
| --- | --- | --- |
| **Hear** | a sound | naming it, or playing it back — the Hearing exercises below |
| **Play** | a row of notes or chords, by name or on the staff | playing each on the pads |
| **Name** | a lit pad | choosing its name with the jog |

**Play** holds four drills, two ways of reading for notes and for chords:

| Drill | The screen shows | What counts |
| --- | --- | --- |
| **Notes by alphabet** | the letter only: `F`, `C#`, `Bb` | that note in any octave |
| **Notes by staff** | the note on the staff, no name | the written note, in its octave |
| **Chords by name** | the chord symbol only: `Am`, `G7`, `F#m7b5` | its notes in any octave or inversion |
| **Chords by staff** | the chord on the staff, no name | the written notes |

Each is a row, like the notes of a song: the one to play is first — boxed when it is a name, on the
hit line when it is on the staff — and the next ones are already in view to the right. Play it right
and the row glides on by one. Nothing moves until you do: there is no tempo, so the score is how
many right answers a minute, as in every quiz.

By example, in **Notes by alphabet** with the row `F  C#  A  E`: any F on the grid answers the
first, the row moves on, and `C#` is next. In **Chords by name**, `Am` is answered by A, C and E held
together in any order and octave; in **Chords by staff** only the notes as written count.

The name drills are about finding a pitch on the grid, which is its own skill: the Move's grid is
isomorphic — one semitone right, five up — so the same pitch appears on several pads and nothing
resembles a keyboard. The staff drills are about reading, so they show no names. Help (REC) names
the first one, and a second press lights its pads.

Play and Name follow the **Half tones** and **Chords** settings. The name drills keep the history
the old **Notes** and **Chords** rows had; the staff drills have their own.

A chord has to be **held all at once**. Part of it down is *incomplete*, not a mistake — a note that
isn't in the chord is what makes it wrong. A wrong answer is counted once and the question stays
until you get it.

**Name › Notes** and **Name › Chords** run the other way round: a pad lights up — several for a chord
— and you name it, choosing with the jog and confirming with a click. The two
wrong options are near misses: a semitone either side for a note, or the same root with a different
quality for a chord (`Cm7` against `C7` against `Cmaj7`), so answering from a rough sense of high or
low will not get you through. Note options carry their octave, because on an isomorphic grid the
same name sits in several places and knowing *which* A♯ you are on is most of the skill.

It is the only drill that goes pad → name, and the only one you can do without playing a note.

### Answering on the pads

Every **Hear** exercise that asks what you heard turns the bottom of the grid into **answer
pads**: one pad per answer, each in its own
colour, and the screen is the legend.

```
screen                       pads (bottom row)
  Major 3rd      blue          ·  ·  B  ·  ·  O  ·  ·
  Minor 3rd      orange
```

| Answers | On the pads | On the screen |
| --- | --- | --- |
| 2–4 | every other pad of the bottom row, centred, so a near miss lands on a dark pad rather than the next answer | each answer with the colour of its pad — blue, orange, cyan, pink |
| 5–8 | the whole bottom row | a map of the row, each pad with its short name (`m2`, `P5`, `TT`), and the chosen answer spelled out below |
| 9–12 | the bottom two rows | the same map, two rows, the bottom row drawn lower as on the grid |

**Press a pad to answer.** An answer pad is a button, not a key: it sounds nothing and sends no MIDI,
and neither do the dark pads between answers. The rest of the grid still plays notes, so you can try
something out before you answer. A right answer flashes green, a wrong one red.

The **jog still works**: turn to choose, click to answer. The answer the jog is on pulses on its
pad, so screen and pads always agree. When a hint strikes an answer out, its pad goes dark.

**Name** keeps the jog. There the lit pads *are* the question, anywhere on the grid, and an answer
bar across the bottom row would cover them.

**Hear** is the same quiz with the notation withheld: you hear the note or chord and play it back,
and the staff shows a `?` until you get it right, then reveals what it was — which is where the
teaching is. **Play** repeats it.

**Play** sounds the prompt. **Record** is help, two presses deep, and what each press does depends
on what the drill is withholding:

| | first press | second press |
| --- | --- | --- |
| **Hear** | names it, staff still hidden | lights the pads |
| **Guess** | sounds the notes | lights the pads |
| **Pick** | strikes out one wrong option | strikes out the other |

A hinted answer still counts and keeps your streak — a hint you are afraid to use is a hint that
does not help you learn — but the round records how many you took, and the result screen shows it.
Record dims once the help is used up, so the button itself tells you whether there is more.

**Back** during a round returns to the list. From a round's result it starts a **fresh round** of
the same drill, so trying again is one press; Back once more for the list.

**The answer is never lit on the pads** outside the top rung of help. Lit pads are a playing aid for
the reading mode, where the music is moving and a hint keeps you with it; in a quiz the hint is the
answer. The only pad feedback here is what you press — green when right, red when wrong.

## Hearing

The **Hearing** exercises train your ear, not your eyes or your hands. You hear something and say
what it was. Nothing is on the staff and nothing is lit, because the skill is recognising a sound.
Find them in **Quiz › Hear**, or work through them in order as the **Hearing** track of the
Learning Program.

### How a question works

1. The prompt plays as soon as the question appears. **Play** repeats it as often as you like.
2. Press the answer's pad (or turn the jog to it and click).
3. **Right:** the pads of what you heard flash, and the screen names the notes (`C-E♭ m3`, `Am`,
   `in G major: B`). Hearing something and then seeing what it was is how the sound sticks.
   **Wrong:** it counts once, and the question stays until you get it.

A few rules hold for every exercise:

- **The answers keep their order.** Major 3rd is always above Minor 3rd, so after a while your hand
  knows where an answer is.
- **The root changes every time.** You can't answer by remembering one note. You have to hear the
  *distance* or the *colour*.
- **Each answer is equally likely.** A drill with more leaps than steps on offer still asks for each
  half the time, so always answering "leap" scores 50%, not 80%.
- **Long lists scroll.** The interval drills name up to twelve answers. A small triangle at the
  right edge shows there are more above or below.

**Record** is help, two presses deep. The first press plays the prompt again, slower, with chords
broken into their notes first. The second strikes out one wrong answer; with only two answers, that
leaves the right one. As in the other quizzes, a hinted answer still counts, but the round records
the hint.

### The exercises, easiest first

Each exercise has levels. They run melodic (one note after the other) before harmonic (together),
upward before downward, and broken chords before block chords.

| # | Exercise | You hear | You answer | Levels |
| --- | --- | --- | --- | --- |
| 1 | Higher or lower | two notes | Higher / Same / Lower | wide, close |
| 2 | Play it back | one note | play it on the pads | in key, chromatic |
| 3 | Step or leap | two notes of a major scale | Step / Leap | — |
| 4 | Melody shape | three notes | Up, up / Up, down / Down, up / Down, down | — |
| 5 | Major or minor 3rd | two notes | Major 3rd / Minor 3rd | up, down, together |
| 6 | Major/minor chord | a triad | Major / Minor | broken, block, inverted |
| 7 | Perfect intervals | two notes | Perfect 4th / Perfect 5th / Octave | up, together |
| 8 | 2nds and 3rds | two notes | Minor 2nd … Major 3rd | up, down |
| 9 | Intervals up | two notes, rising | every interval to the octave | in three groups |
| 10 | Intervals down | two notes, falling | the same | in three groups |
| 11 | Intervals together | two notes at once | the same | in three groups |
| 12 | Four triads | a triad | Major / Minor / Diminished / Augmented | broken, block |
| 13 | Major or minor key | a scale or a short tune | Major key / Minor key | scale, melody |
| 14 | Home or away | the tonic chord, then a phrase | Finished / Unfinished | — |
| 15 | Scale degrees | I–IV–V–I, then one note | 1 do … 7 ti | 1 3 5, all |
| 16 | Seventh chords | a four-note chord | Major 7th / Dominant 7th / Minor 7th / Half-dim 7th | 3 types, 4 types |
| 17 | Chords in a key | the I chord, then another | IV / V / vi | IV V, IV V vi |
| 18 | Play the chord | a chord | play it on the pads | triads, types |

The interval groups add answers a few at a time: first 2nds, 3rds, 4th, 5th and octave, then the
6ths, then the tritone and 7ths.

### The listening courses

At the end of **Quiz › Hear** are three courses, each a numbered list of units that adds a little at
a time. They are also the **Intervals**, **Compare** and **Scales** tracks of the Learning Program.
Answering works as in every Hear exercise: the answer pads, or the jog and a click.

**Identify intervals.** One interval; name it. Each unit offers only its own intervals, usually two
to five, and has three levels: **up**, **down** and **tog** (together).

| # | Unit | Answers |
| --- | --- | --- |
| 1–2 | 2nds · 3rds | m2 M2 · m3 M3 |
| 3 | 2nds and 3rds | m2 M2 m3 M3 |
| 4 | 4th 5th octave | P4 P5 P8 |
| 5 | Up to the 5th | m2 … P5 |
| 6–7 | 6ths · 7ths | m6 M6 · m7 M7 |
| 8 | 6ths 7ths octave | m6 M6 m7 M7 P8 |
| 9 | Up to the octave | all twelve |
| 10–13 | Octave with 9ths and 10ths | P8 M9 M10 · P8 m9 M10 P11 P12 · P8 m9 m10 · P8 m9 m10 P11 P12 |
| 14 | 11th d12 12th | P11 d12 P12 |
| 15 | Octave to 12th | P8 … P12 |
| 16–18 | 13ths, 14ths, two octaves | M13 M14 P15 · m13 m14 P15 · m13 … P15 |

Intervals wider than an octave are *compound*: a 10th is an octave and a 3rd. Hear the octave
first, then what is left over. When an interval is wider than the pads reach at your Octave
setting, it is played over the whole staff instead. You can still hear and name it, but notes off
the grid don't light up when it is revealed.

**Compare intervals.** Two intervals, one after the other. Answer **First bigger**, **Same** or
**Second bigger**. Each unit takes its intervals from a small set. From unit 9 on, every level
comes twice:

- **fix** (fixed root): both intervals start on the same note. Listen to where the second note lands.
- random root: each starts on its own note, three to six semitones apart. The top notes give
  nothing away, only the sizes do.

For example, in **Compare › 9 6ths › fix up** you hear C–A, then C–A♭. The first is bigger. In
**6ths › up** the same sizes might come as C–A, then E–C: still first bigger, but the notes no
longer help.

| # | Unit | Set | Levels |
| --- | --- | --- | --- |
| 1–2 | 2nds · 3rds | m2 M2 · m3 M3 | up, down, tog |
| 3 | M2 and m3 | M2 m3 | mel (up or down) |
| 4 | 5th and 4th | P4 P5 | up, down, tog |
| 5–6 | 4th and tritone · 5th and tritone | P4 TT · P5 TT | mel |
| 7 | 4th TT 5th | P4 TT P5 | any (up, down or together) |
| 8 | Up to the 5th | m2 … P5 | up, down, tog |
| 9–10 | 6ths · 7ths | m6 M6 · m7 M7 | fix and random × up, down, tog |
| 11 | M6 and m7 | M6 m7 | fix and random × mel |
| 12–13 | 6ths and 7ths · Up to the octave | m6 … M7 · all twelve | fix and random × up, down, tog |
| 14–15 | 9ths · 10ths | m9 M9 · m10 M10 | 〃 |
| 16 | M9 and m10 | M9 m10 | fix and random × mel |
| 17 | 11th and 12th | P11 P12 | fix and random × up, down, tog |

**Identify scales.** A scale from a random note, up through the octave or down from it. Name its
type. The root changes every time, so you are naming the pattern of steps, not the notes.

| # | Unit | Answers |
| --- | --- | --- |
| 1 | Minor and major | Major, Natural minor |
| 2 | Major Lydian Mixo | Major, Lydian, Mixolydian |
| 3 | Minor scales | Natural, Harmonic and Melodic minor |
| 4 | Phrygian Locrian | Phrygian, Locrian |
| 5 | Pentatonic | Major and Minor pentatonic |
| 6 | Seven modes | Ionian, Dorian, Phrygian, Lydian, Mixolydian, Aeolian, Locrian |
| 7 | Whole tone + kin | Whole tone, Lydian dominant, Lydian augmented, Mixolydian b6 |
| 8 | Diminished scales | Whole-half, Half-whole |
| 9 | Melodic min modes | the seven modes of melodic minor, Dorian b2 to Altered |
| 10 | Harmonic min modes | the seven modes of harmonic minor, Locrian #6 to Altered bb7 |

To tell scales apart, listen for where the semitones fall, and for the 3rd, 6th and 7th. Melodic
minor is played the same way down as up: the jazz form, not the classical one that comes down as
natural minor.

### What to listen for

- **Major or minor third (5).** A major third is bright and open: the first two notes of *Oh When
  the Saints*. A minor third is darker and softer: the first two notes of *Greensleeves*.
- **Major or minor chord (6).** The same difference, now stacked. Major sounds settled and
  bright, minor sounds sad and inward. The broken level plays the chord a note at a time before
  it sounds whole, so you can hear the third arrive.
- **Perfect intervals (7).** A 4th is the start of *Here Comes the Bride*, a 5th the leap after
  the first two notes of *Twinkle Twinkle*, and an octave the first leap of *Somewhere Over the
  Rainbow*. They sound open and hollow, with nothing sweet or sour in them.
- **Four triads (12).** Diminished is tense and shrinking: a minor chord with its top squeezed
  down. Augmented is unsettled, stretching, almost dreamlike: a major chord with its top pushed up.
- **Home or away (14).** A finished phrase lands on *do* and you could stop there. An unfinished
  one leaves you waiting for the next note.
- **Scale degrees (15).** The cadence sets up the key. Sing down from the note you hear to *do*,
  and count the steps on the way.
- **Chords in a key (17).** IV feels like a step away, warm and open. V leans back towards home.
  vi is the minor turn, where the music drops into shadow.

Every level is a drill of its own for progress and records, with an id like `ear:thirds:up` or
`ear:intervals-down:g2`.

## Results and progress

### After an exercise

A whole run ends on its result:

```
 ODE TO JOY L1                                       ✓ DONE
  93 %                                          56 of 60 hit
                                                     2 wrong
 ·····························●······························  ← 90%
                      ○────●╯
         ○───○───────╯
 ─────────────────────────────────────────────────────────────
                REC again  CLICK next
```

The headline is the share you got right. Under it is **every recent attempt at this exercise**, on a
fixed 0–100% scale so a chart looks the same each time you come back to it: **hollow points are
stage 1, solid ones stage 2**, and the dotted line is the 90% you need to pass.

| On a result | |
| --- | --- |
| **Record** | play it again, same stage |
| **Play** | listen to it |
| **Back** | back to the **start** of the exercise, on the stage it needs, to try again. Back once more for the list |
| **Click** | **next**: stage 2 of the same exercise if you have just passed stage 1, otherwise the next step of the track you came from (or Continue's, if you came from the list) |
| **Shift + click** | **move on** with stage 1 counted as enough, or **skip** — then on to the next step |

### After a quiz round

A quiz is a **round** of 20 prompts (10/20/30 in settings, or `endless` for open practice that
records nothing). The clock starts on your **first press**, not when the screen appears, so the
moment of orientation is not part of the score. Because a prompt waits until you get it right, a
round is always exactly N correct answers — a wrong answer costs you *time* rather than needing a
penalty of its own, the same way a typing test treats a typo.

The result is **correct answers per minute**, with your best for that drill beside it, the round's
**error rate**, and a chart of the drill's recent rounds so the number has something to be measured
against. The round also counts toward the drill's progress, scored as right answers over attempts.

Error rate is wrong answers over *attempts* (`wrong / (correct + wrong)`), not over prompts, so a
10-prompt round and a 30-prompt one sit on the same chart.

Rates only ever compare **within a drill**: hearing seventh chords is not the same task as naming a
white note, so every round is recorded against a drill id (`guess:notes:half`, `hear:chords:types`)
and the plot never mixes them.

### The Progress screen

**Progress**, at the bottom of the list, is the long view. It opens on a list headed with your
overall percentage:

| Row | Its chart |
| --- | --- |
| **Overall** | every stage you have passed, as a line rising by one at each pass, along real time. Flat stretches are time off; steep ones are where it clicked |
| **Reading track** … **Ear track** | the same, for one track of the program |
| then everything you have played, newest first | an exercise: its attempts, as on the result screen. A quiz drill: its rate as a line and its error rate as bars growing under it — a full bar is 50% wrong, a fixed ceiling so two visits are comparable |

Click a row for its chart; the jog walks to the next one. Back returns to the list, and Back again
to the lesson list.

### Where it is kept

Everything is kept beside the module: `progress.json` holds every exercise's two stages, skips and
repetition schedule, and its last 24 attempts; `stats.json` holds the last 200 quiz rounds for the
rate charts. `scripts/install.sh` carries both across updates. A damaged file reads as a fresh start
rather than stopping the module from opening.

## In your browser

The same practice runs in a web browser — the same lessons, scoring, Learning Program and piano —
from a computer keyboard, the keys on screen, a MIDI keyboard, or your Move on its USB cable:

```sh
npm install
npm run web:dev          # http://localhost:47331
```

[docs/web.md](docs/web.md) walks through it. The page is the module itself, not a copy: it runs the
same `src/session.mjs` the Move does. Inside Schwung's web manager it is built to show and steer
the session running on the Move instead; [docs/schwung-web.md](docs/schwung-web.md) says what the
Move's side still needs.

## Requirements

- Ableton Move with [Schwung](https://github.com/charlesvestal/schwung) 1.4.0 or newer installed —
  tested on 1.7.3

Schwung is unofficial software that modifies Move's software. Back up anything you care about and
read Schwung's recovery guidance before installing it.

## Install

```sh
git clone https://github.com/graebe/schwung-piano-practice.git
cd schwung-piano-practice
sh scripts/install.sh
```

`MOVE_HOST` (default `move.local`) and `MOVE_USER` (default `ableton`) override the target. The
install stages beside the live directory and swaps, so a failed transfer cannot leave a
half-installed module behind; your `settings.json` and any exercises you added by hand survive an
update.

Open it from the Schwung Tools menu. If it does not appear, trigger a module rescan from
schwung-manager.

## Hearing it

**The module has its own piano, and it is the default.** Nothing has to be set up: no Move track, no
instrument loaded on it, no MIDI channel to match. It is rendered by the Rust engine in `dsp/` in
the overtake generator slot and *mixed into* Move's audio, so it plays alongside whatever else is
going on rather than replacing it.

It is a synthesised piano, not a recorded one. Each voice is a small stack of partials whose higher
ones decay faster — that property, more than the waveform, is what the ear reads as a struck,
ringing string — and the partials are slightly stretched because real piano strings are stiff and
their overtones sit progressively sharp.

**MIDI out** in settings can send elsewhere instead:

| | |
| --- | --- |
| **piano** | the built-in one. Default |
| **track** | `move_midi_inject_to_move`, into a Move track's instrument, on the **MIDI ch** setting. `all` broadcasts to every channel, so a track listening on any of them will answer — a module cannot read or change what channel a track wants, and a mismatch is silent with no clue on screen |
| **USB** | `move_midi_external_send`, out of the USB-A port to a computer |
| **trk+USB** | both of those |

Closing silences the piano, sends note-offs and All Sound Off on every channel down both MIDI
routes, and waits for Move's inject ring to drain before releasing overtake — injected MIDI is held
back for a few audio frames and three more *after* overtake ends, so exiting on the same tick that
queues the note-offs drops them.

The built-in piano also answers the standard panic messages as MIDI — **CC 120** (All Sound Off)
and **System Reset** cut it dead, **CC 123** (All Notes Off) lets it ring out rather than clicking
— on any channel, since it occupies none. Notes themselves still arrive by parameter, because one
write has to carry a whole chord, so a MIDI note-on here deliberately starts nothing.

## The pads

Everything that describes the *music* is one violet ramp; everything that is a **judgement** keeps
its own hue, because within one family only brightness is left to rank with and right-or-wrong is
the one signal you should never have to read.

| Pad | Means |
| --- | --- |
| dark | out of key |
| dim purple | in key — background, deliberately the dimmest lit value |
| pale lavender | the root; also the lit prompt in **Pick**, and the pulse when a note is missed |
| purple | at **stage 1**, the note is coming |
| bright violet | it is now — and the notes **Play** is sounding |
| yellow | your finger is on it |
| green / red | you got it / you missed it |

## Playing

**Play listens, Record practises** — at an instrument "play" means play it to me, and "record"
means capture what I do. Both pulse when an exercise is armed, in their own colours, and the ready
screen names them; whichever is running goes solid and the other dims. Pads only ever play notes.
Four beats count you in, counted down on screen.

| Control | Does |
| --- | --- |
| **Play** | **listen** — the exercise plays itself and the pads light up as it goes, so you can watch it before trying it. Nothing scored. Press it again to **pause where you are**; again to carry on from wherever you have scrubbed to |
| **Record** | **practice** — you play it, it scores you. Pauses and resumes the same way |
| **Jog turn** | moves the highlight in the exercise list and in settings. On the ready screen it picks the **stage** — right for stage 2, left for stage 1. Nowhere does it change *what* you are playing: to pick something else, Back to the list first |
| **Jog click** | open the highlighted folder or arm the exercise; on a song, open its levels; in settings, edit the selected row; on a result, go on to what is next |
| **Menu** | **Info**: what the thing in front of you is, and its terms. Again to close |
| **Shift + jog click** | settings |
| **Back** | from a running exercise or a result, **back to the start**; from the ready screen, up a level — so twice gets you out, and there is no separate stop button to learn |
| **Shift + Back** | close immediately from anywhere |
| **Knob 1** | **scrub**, whenever the music is not running — on the ready screen, or paused. About a turn and a half per bar, deliberately slow, and continuous rather than jumping bar to bar. The pads light the note the playhead has landed on, at either stage, so you can see where you are on the grid as well as on the staff; they go dark again the moment the music runs. Find your spot, then Play or Record from there |
| **Knob 8** | tempo, 40–200 |

The knobs mean different things in different places, and **only Settings changes settings**: in an
exercise they are the two above, in Settings they are the four rows on screen, and everywhere else
they do nothing. **Touching** a knob in Settings moves the cursor to the row it edits, so the
mapping is something you find rather than memorise.

The ready screen spells all three out — `▶ PLAY listen`, `● REC practice`, `↻ SCRUB view` — and the
box gets out of the way the moment you scrub, because it sits over the middle of the staff you are
scrubbing through. Scroll back to the top and it returns; the header's right corner shows the MIDI
route at the top and your position once you leave it, since only one of the two is worth the space
at a time.

**Starting mid-piece skips the bars behind you rather than failing them**, and there is no count-in
— you have just been looking at the bar you picked, and with Wait on the scroll halts at the first
note anyway. Back returns to the top.

Scrubbing backward puts the notes you pass back, so the bar can be played again. Hits and misses
already counted stay counted — a run you have scrubbed around in has no meaningful score, so it is
not recorded: when it ends you are back on the ready screen.

Changing tempo, key or octave rebuilds the armed exercise straight away, so the staff always shows
what you have dialled in. Hand-written exercises are left alone — they are fixed notes, not a recipe
to re-run in another key.

Pads use Move's native isomorphic layout: one semitone right, five semitones up, so the same pitch
appears on several pads and any of them counts. The grid is transposed **+12** by default, which puts
A3–G5 under your hands — untransposed it sits almost entirely below the treble staff.

### Settings

Click a row to edit it, turn the jog to change the value, click again when done — knobs 1–4 are
shortcuts to the first four.

| Setting | Default | |
| --- | --- | --- |
| Any octave | off | accept the right note in the wrong register |
| Quiz sounds | **on** | a chime for a right answer, a soft uh-oh for a wrong one |
| Auto info | **on** | a practice's Info page shows by itself the first time you open it |
| Half tones | **on** | the note guesser asks about the black notes too, not just the seven of the key. They are the hard ones to find on an isomorphic grid |
| Chords | **triads** | `triads` asks the diatonic triads of the key. `types` asks a deliberately chosen quality — maj, min, dim, aug, sus2, sus4, 6, m6, 7, maj7, m7, m7b5, dim7, add9. `advanced` adds ninths and altered dominants on top — 9, maj9, m9, 6/9, 7b5, 7#5, 7b9, 7#9, 7sus4, 9sus4, mMaj7, madd9. Roots follow Half tones: chromatic when it is on, the notes of the key when it is off |
| Scale | **Major** | all 22 of Move's own scales, taken from the device's firmware so the pads light the way Move would |
| Click | on | MIDI metronome (see the caveat above) |
| Reference | **on** | plays the exercise as it crosses the hit line, softer than your pads, so you can play along. Off for unaided reading |
| Wait | **on** | stop the scroll at a note until it is played. A note waited for still scores a miss — you get the ✗ and you still have to play it |
| Grace | **1** | how late you may play a note and still be scored in time, in beats, so the tolerance scales with tempo. A beat is 750 ms at 80bpm — long enough to find the key. Raise it to 2 or 4 while a piece is new; drop it to 1/4 once the rhythm is the point. Never shorter than the 180 ms scoring window. It does **not** move where the scroll stops: that is always the note itself, so you can see what is being asked for. Play later than Grace and the scroll still releases — it just scores a miss |
| Count in | 4 | beats before the first note |
| MIDI ch | 1 | which channel the Move track listens on |

## Writing your own exercises

Drop a JSON file in `exercises/` and add a line to `exercises/index.json`. There is no
directory-listing call in the host, which is why the manifest exists. A row's `category` is one of
the `categories` the manifest declares — `classics`, `electronic`, `techno`, `styles`. A row
without one, or with one the manifest does not declare, is listed under **Other**, so a file you add
is never lost. An update replaces `index.json`, so Other is where your own files land after one.

```json
{
  "id": "my-etude",
  "name": "My etude",
  "bpm": 72,
  "timeSig": [4, 4],
  "keySig": -1,
  "events": [
    { "beat": 0, "durBeats": 4, "hand": "l", "pitches": [53] },
    { "beat": 0, "durBeats": 1, "hand": "r", "pitches": [65] },
    { "beat": 1, "durBeats": 1, "hand": "r", "pitches": [69] },
    { "beat": 2, "durBeats": 2, "hand": "r", "pitches": [65, 69, 72] }
  ]
}
```

`hand` is `"l"` or `"r"`, and defaults to `"r"` — so a melody-only file written before this existed
still reads, and simply offers one level. Tag both hands and you get all four for free: the right
hand's top note is L1, the left hand is L1 LH, the right hand as written is L2, and everything
together is L3. Nothing is transposed between them.

Two events on the same beat become one at L3, which is what lets a held bass note sit under several
melody notes. The merged event takes the longer duration, so in **Listen** a melody note under a
held bass note rings as long as the bass note does — inaudible on a decaying piano, and the only
thing the merge gives up.

Write the file in beat order, both hands interleaved. Beats must run forwards; two events may share
a beat.

An event may carry `"symbol": "C/E"`. That is the chord's name, shown when the scroll stops on
it, for the chords that cannot be named from their notes: a slash chord, or a voicing without its
root. Otherwise the name is worked out from the pitches, lowest note as the root.

`keySig` is the signature in fifths (`-1` = F major, `2` = D major). It sets how black notes are
**spelled** — sharp keys read `A#`, flat keys read `Bb`. No key signature is drawn on the staff:
there is no room at 128×64, and for a reading trainer an accidental on the note itself is more use
than one you have to remember. Beats must run forwards; pitches are MIDI note numbers. A piece that
changes key part-way can say so with `"keyChanges": [{ "beat": 16, "keySig": -2 }]`: the spelling
from that beat on.

`beat` and `durBeats` are always **quarter notes**, whatever the time signature — an eighth is
`0.5`, a dotted quarter `1.5`. `timeSig` only decides where the bar lines fall, so `[6, 8]` is
three quarter-beats to the bar. There is no rest event: a gap in the beat numbers is a rest, and
a piece with a pickup simply starts at a later beat so its downbeats stay on the bar lines.

A file exercise keeps its own `bpm` — the tempo knob only drives the generated ones — so pick a
tempo the piece is actually playable at. A note more than 180 ms late is gone, which makes
sixteenths at anything past walking pace a losing fight; write them as eighths and halve the bpm.

### The one-screen rule

Keep every pitch between **57 and 79 (A3–G5)**. That is what the 32 pads reach at the default
octave, so a piece inside it plays without ever touching the octave knob, and it sits inside the
staff's A3–C6 window too.

With two hands that budget is the whole design, not a guideline: 23 semitones is barely two octaves,
and at L3 the bass line and the tune share it. In practice the left hand lives around 57–67 and the
right around 64–79, they may meet in the middle, and **they must never cross** — on one staff a
crossed voice reads as a mistake rather than as counterpoint. `npm test` asserts all of this for
every bundled song at every level, which is what stops a comfortable-looking arrangement shipping
with a bass note no pad can play.

The classics are public-domain melodies transcribed to fit, with harmonisations written for this
module. Everything else bundled is original, or takes only a track's chords.

## Development

```sh
npm run test:quick    # seconds: tokens, the wasm piano, every unit test, the Rust tests
npm run test:full     # minutes: + the C suites, the device build in Docker, the tarball,
                      #   the web build, Chrome end to end, coverage against its 80% floor
npm test              # the unit tiers below, in order — no Move, no browser
npm run preview       # dump the screens as ASCII art in the terminal
npm run web:dev       # the browser page, http://localhost:47331
```

Every stage of the two tiers is timed into the shared build-timing log (`scripts/timing.sh`).

| | |
| --- | --- |
| `test:js` | unit, rendering, contract and layout tests for the JavaScript, the device's and the page's |
| `test:dsp` | `tests/dsp/test_piano.c` against the engine, through the C ABI the Move calls. Kept in C deliberately: it is the only caller that exercises the engine the way the Move does |
| `test:rust` | the Rust unit tests (`cargo test --no-default-features`) |
| `test:package` | what the tarball must contain and what the install must not destroy |
| `test:e2e` | the browser page in Chrome, at desktop and phone sizes (`web/e2e`) |
| `coverage` | node, cargo-llvm-cov and Chrome coverage in one report, `build/coverage/` |

`tests/ui_trace.test.mjs` records everything `ui.js` tells the Move — DSP params, MIDI, file writes,
announcements, a digest of each frame's drawing and LEDs — over eight scripted sessions, and holds
it to the recording. A change meant to be seen on the device re-records it (`UPDATE_TRACE=1`) and
says so; any other change must leave it untouched.

### The DSP

The piano is Rust, in `dsp/`, and the browser plays the same one the Move does. Four crates:

| crate | what it is |
| --- | --- |
| `piano-engine` | the synthesis — voices, tables, the event ring, the `n` note-list parser. `no_std`, no allocation, `#![forbid(unsafe_code)]`, and no dependency but libm. Renders f32 at any sample rate; at the Move's 44100 its arithmetic is the C's, operation for operation |
| `piano` | the device plugin, `dsp.so`: maps Schwung's `set_param`/`on_midi`/`render_block` onto the engine and scales its f32 into the host's i16. No `unsafe` of its own |
| `schwung-plugin` | the reusable Schwung plugin-API binding, where every FFI hazard is paid for once |
| `piano-wasm` | the browser build, `piano.wasm`: the engine behind eleven raw `extern "C"` exports, no wasm-bindgen, ~17KB. Its one `unsafe` is the module's single-threaded global state |

`scripts/build-wasm.sh` builds `build/wasm/piano.wasm` (it needs the `wasm32-unknown-unknown` target
installed, and says so if it is not). In the browser, `web/src/audio/piano-worklet.js` runs it in an
AudioWorklet and `web/src/audio/engine.js` drives it with the device's own `n` lists, one per task.

That the two hosts sound alike is tested, not hoped: `dsp/piano-engine/tests/golden.txt` is a
scenario both replay at 44100 — the native engine in `cargo test`, the wasm in
`tests/wasm_piano.test.mjs` — against the same `golden-44100.f32`, bit for bit. The device's own
i16 output is pinned by a checksum taken before the engine was split out of `piano`.

The device build is `no_std` over libc. Not for elegance: the Move runs **glibc 2.35** and the build image is
Debian bookworm at **2.36**, so `std` could reference a symbol that links here and fails to load
there. `no_std` removes the hazard instead of guarding it — the shipped object needs only
`GLIBC_2.17` and `libc.so.6`, and comes to 67KB. `scripts/build-dsp.sh` refuses any build that is
not aarch64, needs a glibc above the ceiling, or has ballooned in size.

`panic = "abort"`, a `#[panic_handler]` that calls `abort()`, and
`#![deny(clippy::indexing_slicing, unwrap_used, expect_used, panic)]` on every crate. `render_block`
runs on the SPI callback: unwinding out through `extern "C"` is undefined behaviour and a fault
there takes Move's firmware down with it, so a Rust panic has to be unreachable rather than merely
unlikely.

Building it needs Docker (or a local `aarch64-unknown-linux-gnu` Rust toolchain plus
`aarch64-linux-gnu-gcc` as its linker); `scripts/build.sh` picks whichever is present.

It replaced a C engine, which was deleted in 1.0.0 once the Rust matched it. The 33 assertions in
`tests/dsp/test_piano.c` were written against the C and run unaltered against the Rust, and a
sample-by-sample comparison of the two — before the C was removed — held at a peak difference of 16
in 32767 with a correlation of 1.000000. Both halves of that comparison are in the history at
`af4cba9` if it ever needs re-running.

`tools/preview.mjs` renders the real drawing code into a 128×64 byte buffer and prints it. Because
every frame is a pure function of `(chart, run, songBeats)`, any instant of any exercise can be
dumped and looked at:

```sh
npm run preview -- --view clef
npm run preview -- --exercise triads --film 0,1,2,3
npm run preview -- --beats 2.5 --px 36
```

That is also how the rendering tests work: they draw into the same buffer and assert on pixels,
because the interesting failures in a 1-bit staff are geometric — a ledger line one step out, a
notehead that does not read as a ring, a note that scrolls into the clef instead of vanishing
before it.

### Layout

| File | |
| --- | --- |
| `src/ui.js` | the Move: lifecycle, MIDI out, the piano's mailbox, pads and LEDs, buttons, the panel |
| `src/session.mjs` | what the module does — lessons, transport, scoring, quizzes, progress, settings — with no host in it |
| `src/view_model.mjs` | a session as plain data, for a page to render |
| `src/actions.mjs` | what a page may ask of a session, and how it is carried out |
| `src/layout.mjs` | every screen coordinate, in one leaf module |
| `src/notation.mjs` | pitch spelling and staff placement |
| `src/staff_render.mjs` | clef, staff, noteheads, ledgers, accidentals, bar lines |
| `src/view.mjs` | whole screens, composed from the above |
| `src/chart.mjs` | the scroll engine — beat to x, and what is on screen |
| `src/scoring.mjs` | hit windows and run state |
| `src/generator.mjs` | seeded procedural exercises |
| `src/exercise_io.mjs` | JSON loading and validation |
| `src/padmap.mjs` | the isomorphic pad grid |

Everything except `ui.js` is pure and runs under plain `node`.

| `web/` | the browser page |
| --- | --- |
| `src/session/` | the page's two sessions: `local.js` runs `session.mjs` in the page; `schwung.js` watches one on a Move |
| `src/app/` | the screens, the keys panel, the charts |
| `src/music/` | the grand staff, keyboard and pad grid, ported from the Neon Ingvy plugins' JUCE components |
| `src/kit/` | the Ultraviolet Solid kit, from neon-ingvy-audio-plugins |
| `src/audio/` | the Move's piano as wasm, in an AudioWorklet |
| `src/input/` | the computer keyboard and Web MIDI |
| `design/` | the Ultraviolet design system's tokens, vendored; `scripts/gen-tokens.mjs` makes the CSS |
| `e2e/` | the end-to-end suite |

## AI assistance disclaimer

This module was developed with AI assistance. Architecture and release decisions are reviewed by a
human maintainer. Please validate functionality and licence compatibility before relying on it.

## Licence

**GPL-3.0-or-later**, copyright © 2026 Torben Gräber. See [LICENSE](LICENSE).

Piano Practice is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. It is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE.

Up to 1.8.1 the module was released under MIT; those releases keep that licence.

The one third-party dependency compiled into `dsp.so` is
[`libm`](https://crates.io/crates/libm), taken under **MIT**; its notice ships in
the tarball as [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
