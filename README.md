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
- **Generates its own material.** Scales, intervals, triad progressions and random reading lines in
  any key and mode, seeded so you can re-attempt the exact drill you just fluffed.
- **Teaches a piece in four steps.** Fourteen public-domain tunes, each arranged for two hands and
  playable at four levels: right hand alone, left hand alone, right hand with its chords, then both
  together. Pick the song, then pick the level.
- **Takes hand-written exercises** as JSON, interchangeable with the generated ones.
- **Sounds like a piano, with no setup** — the module renders its own polyphonic piano and mixes it
  into Move's audio. No track, no instrument, no MIDI channel to match. MIDI out to a track or a
  computer is there if you want it.
- **Rescues you when you are stuck.** Miss a note and the scroll stops, names it large on screen,
  and — with Guide pads on — pulses the pad you need. The missed note itself stays pinned by the hit
  line whatever your read-ahead, so you can always see what you are being asked for.
- **Gets out of your way.** Target-pad lighting exists, but it is off by default: this is a reading
  trainer first.

## Levels

Every bundled tune is one file with both hands written into it, and the four levels are cut out of
that one file. Click a song in the exercise list and you get its ladder:

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

A file with nothing to split — the three technique drills — shows only the levels it actually has,
and arms straight away if that is one. `Triads I-IV-V-I` keeps two: the top line of its triads is a
genuinely different exercise from the triads.

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

Marys Lamb, Frere Jacques and The Saints are the easy end of L3; Fur Elise, Rising Sun and the
Minuet the hard end.

## Note guesser and ear training

Two extra modes at the top of the exercise list — **Guess: notes**, **Guess: chords**, **Hear:
notes**, **Hear: chords**. Which entry you open is also how you pick.

One note or chord sits still on the staff with its name below it, and it waits until you play it.
No clock, no scrolling, nothing timed. This drills a different skill from the reading mode: the
Move's grid is isomorphic — one semitone right, five up — so the same pitch appears on several pads
and nothing resembles a keyboard. Finding a pitch is its own problem, and the scrolling mode can
never isolate it because the note is always moving.

A chord has to be **held all at once**. Part of it down is *incomplete*, not a mistake — a note that
isn't in the chord is what makes it wrong. A wrong answer is counted once and the question stays
until you get it.

**Pick: notes** and **Pick: chords** run the other way round: a pad lights up — several for a chord
— and you name it, choosing one of three options with the jog and confirming with a click. The two
wrong options are near misses: a semitone either side for a note, or the same root with a different
quality for a chord (`Cm7` against `C7` against `Cmaj7`), so answering from a rough sense of high or
low will not get you through. Note options carry their octave, because on an isomorphic grid the
same name sits in several places and knowing *which* A♯ you are on is most of the skill.

It is the only drill that goes pad → name, and the only one you can do without playing a note.

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

**Back** returns to the list.

**The answer is never lit on the pads**, not even with **Guide pads** on. That setting is a playing
aid for the reading mode, where the music is moving and a hint keeps you with it; in a quiz the hint
is the answer. The only pad feedback here is what you press — green when right, red when wrong.

## Rounds and progress

A quiz is a **round** of 20 prompts (10/20/30 in settings, or `endless` for open practice that
records nothing). The clock starts on your **first press**, not when the screen appears, so the
moment of orientation is not part of the score. Because a prompt waits until you get it right, a
round is always exactly N correct answers — a wrong answer costs you *time* rather than needing a
penalty of its own, the same way a typing test treats a typo.

The result is **correct answers per minute**, with your best for that drill beside it, the round's
**error rate**, and a chart of the drill's recent rounds so the number has something to be measured
against.

**Progress**, at the top of the exercise list, plots how one drill has developed: the rate as a
line, and the **error rate** as bars growing under it, so you can see whether speed came at the cost
of accuracy. A full-height bar is 50% wrong — a fixed ceiling, so two visits are comparable. The jog
changes drill.

Error rate is wrong answers over *attempts* (`wrong / (correct + wrong)`), not over prompts, so a
10-prompt round and a 30-prompt one sit on the same chart.

Rates only ever compare **within a drill**: hearing seventh chords is not the same task as naming a
white note, so every round is recorded against a drill id (`guess:notes:half`, `hear:chords:types`)
and the plot never mixes them.

History lives in `stats.json` beside the module, capped at 200 rounds, and `scripts/install.sh`
carries it across updates.

## Requirements

- Ableton Move with [Schwung](https://github.com/charlesvestal/schwung) installed
- A Move track with an instrument, so there is something to hear

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
| purple | with **Guide pads** on, the note is coming |
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
| **Jog turn** | moves the highlight in the exercise list and in settings, and does nothing anywhere else — a knock cannot change what you are playing. To pick something else, Back to the list first |
| **Jog click** | open the list / pick an exercise; on a song, open its levels; in settings, edit the selected row |
| **Menu** | open the exercise list |
| **Shift + jog click** | settings |
| **Back** | from a running exercise, **restart it**; from the ready screen, up a level — so twice gets you out, and there is no separate stop button to learn |
| **Shift + Back** | close immediately from anywhere |
| **Knob 1** | **scrub** — about half a turn per bar, deliberately slow. Works while playing and while paused, so you can drop on a bar and take it again |
| **Knob 8** | tempo, 40–200 |

The knobs mean different things in different places, and **only Settings changes settings**: in an
exercise they are the two above, in Settings they are the four rows on screen, and everywhere else
they do nothing. **Touching** a knob in Settings moves the cursor to the row it edits, so the
mapping is something you find rather than memorise.

Scrubbing backward puts the notes you pass back, so the bar can be played again. Hits and misses
already counted stay counted — a run you have scrubbed around in has no meaningful score, and songs
show no scorecard.

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
| Guide pads | **off** | lights the pad you need next while reading, brightening as it approaches. Has no effect in the guessing and hearing modes |
| Any octave | off | accept the right note in the wrong register |
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
directory-listing call in the host, which is why the manifest exists.

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

`keySig` is the signature in fifths (`-1` = F major, `2` = D major). It sets how black notes are
**spelled** — sharp keys read `A#`, flat keys read `Bb`. No key signature is drawn on the staff:
there is no room at 128×64, and for a reading trainer an accidental on the note itself is more use
than one you have to remember. Beats must run forwards; pitches are MIDI note numbers.

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

The fourteen bundled tunes are all public-domain melodies transcribed to fit, with harmonisations
written for this module.

## Development

```sh
npm test              # everything below, in order — no Move needed
npm run preview       # dump the screens as ASCII art in the terminal
```

| | |
| --- | --- |
| `test:js` | unit, rendering, contract and layout tests for the JavaScript |
| `test:dsp` | `tests/dsp/test_piano.c` against the engine, through the C ABI the Move calls. Kept in C deliberately: it is the only caller that exercises the engine the way the Move does |
| `test:rust` | the Rust unit tests (`cargo test --no-default-features`) |
| `test:package` | what the tarball must contain and what the install must not destroy |

### The DSP

The piano is Rust, in `dsp/`, as two crates: `schwung-plugin` — the reusable Schwung plugin-API
binding, where every FFI hazard is paid for once — and `piano`, the synth, which contains no
`unsafe` at all.

It is `no_std` over libc. Not for elegance: the Move runs **glibc 2.35** and the build image is
Debian bookworm at **2.36**, so `std` could reference a symbol that links here and fails to load
there. `no_std` removes the hazard instead of guarding it — the shipped object needs only
`GLIBC_2.17` and `libc.so.6`, and comes to 67KB. `scripts/build-dsp.sh` refuses any build that is
not aarch64, needs a glibc above the ceiling, or has ballooned in size.

`panic = "abort"`, a `#[panic_handler]` that calls `abort()`, and
`#![deny(clippy::indexing_slicing, unwrap_used, expect_used, panic)]` on both crates. `render_block`
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
| `src/ui.js` | host glue only: lifecycle, MIDI, LEDs, settings, state machine |
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

## AI assistance disclaimer

This module was developed with AI assistance. Architecture and release decisions are reviewed by a
human maintainer. Please validate functionality and licence compatibility before relying on it.

## Licence

**MIT**, copyright © 2026 Torben Gräber. See [LICENSE](LICENSE).

Nothing in this module needs anything stronger. The one third-party dependency
is [`libm`](https://crates.io/crates/libm), taken under **MIT**, compiled into
`dsp.so`; its notice ships in the tarball as
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). There are no JavaScript
dependencies at all.
