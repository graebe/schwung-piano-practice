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
- **Takes hand-written exercises** as JSON, interchangeable with the generated ones.
- **Sounds like a piano, with no setup** — the module renders its own polyphonic piano and mixes it
  into Move's audio. No track, no instrument, no MIDI channel to match. MIDI out to a track or a
  computer is there if you want it.
- **Rescues you when you are stuck.** Miss a note and the scroll stops, names it large on screen,
  and — with Guide pads on — pulses the pad you need. The missed note itself stays pinned by the hit
  line whatever your read-ahead, so you can always see what you are being asked for.
- **Gets out of your way.** Target-pad lighting exists, but it is off by default: this is a reading
  trainer first.

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

**Hear** is the same quiz with the notation withheld: you hear the note or chord and play it back,
and the staff shows a `?` until you get it right, then reveals what it was — which is where the
teaching is. **Play** repeats it.

**Play** sounds the answer, **Record** skips it, **Back** returns to the list.

**The answer is never lit on the pads**, not even with **Guide pads** on. That setting is a playing
aid for the reading mode, where the music is moving and a hint keeps you with it; in a quiz the hint
is the answer. The only pad feedback here is what you press — green when right, red when wrong.

## Rounds and progress

A quiz is a **round** of 20 prompts (10/20/30 in settings, or `endless` for open practice that
records nothing). The clock starts on your **first press**, not when the screen appears, so the
moment of orientation is not part of the score. Because a prompt waits until you get it right, a
round is always exactly N correct answers — a wrong answer costs you *time* rather than needing a
penalty of its own, the same way a typing test treats a typo.

The result is **correct answers per minute**, with your best for that drill beside it.

**Progress**, at the top of the exercise list, plots how one drill has developed — a sparkline of
recent rounds with best, average and latest. The jog changes drill.

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
git clone https://github.com/graebe/schwung-pinao-practice.git
cd schwung-pinao-practice
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
instrument loaded on it, no MIDI channel to match. It is rendered by `src/dsp/piano.c` in the
overtake generator slot and *mixed into* Move's audio, so it plays alongside whatever else is going
on rather than replacing it.

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

## Playing

**Play listens, Record practises** — at an instrument "play" means play it to me, and "record"
means capture what I do. Both pulse when an exercise is armed, in their own colours, and the ready
screen names them; whichever is running goes solid and the other dims. Pads only ever play notes.
Four beats count you in, counted down on screen.

| Control | Does |
| --- | --- |
| **Play** | **listen** — the exercise plays itself and the pads light up as it goes, so you can watch it before trying it. Nothing scored |
| **Record** | **practice** — you play it, it scores you |
| **Jog turn** | moves the highlight in the exercise list and in settings, and does nothing anywhere else — a knock cannot change what you are playing. To pick something else, Back to the list first |
| **Jog click** | open the list / pick an exercise; in settings, edit the selected row |
| **Menu** | open the exercise list |
| **Shift + jog click** | settings |
| **Back** | up a level, then out of the module |
| **Shift + Back** | close immediately from anywhere |
| **Knob 1** | tempo, 40–200 |
| **Knob 2** | read ahead — pixels per beat, 12–48 |
| **Knob 3** | key |
| **Knob 4** | octave |

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
| Chords | **triads** | `triads` asks the diatonic triads of the key. `types` asks a deliberately chosen quality — maj, min, dim, aug, sus2, sus4, 6, m6, 7, maj7, m7, m7b5, dim7, add9 — and names it on screen as a chord symbol, so you read `Cm7` and play it. Roots follow Half tones: chromatic when it is on, the notes of the key when it is off |
| Click | on | MIDI metronome (see the caveat above) |
| Reference | **on** | plays the exercise as it crosses the hit line, softer than your pads, so you can play along. Off for unaided reading |
| Wait | **on** | stop the scroll at a note until it is played. A note waited for still scores a miss — you get the ✗ and you still have to play it |
| Grace | **1/3** | how late still counts as in time, as a fraction of a beat, so the tolerance scales with tempo. Never shorter than the 180 ms scoring window |
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
    { "beat": 0, "durBeats": 1, "pitches": [65] },
    { "beat": 1, "durBeats": 1, "pitches": [69] },
    { "beat": 2, "durBeats": 2, "pitches": [65, 69, 72] }
  ]
}
```

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
staff's A3–C6 window too. The bundled tunes — Ode to Joy, Twinkle, Mary Had a Lamb, Frere
Jacques, Jingle Bells, Greensleeves, Fur Elise and a Minuet in G — are all transcribed to fit it,
melody only apart from a few block chords at the cadences.

## Development

```sh
npm test              # unit, rendering, contract and package tests — no Move needed
npm run preview       # dump the screens as ASCII art in the terminal
```

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

MIT
