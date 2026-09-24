/*
 * piano — the built-in piano for Piano Practice, as a Schwung v2 DSP plugin.
 *
 * Ported from src/dsp/piano.c. The synthesis is unchanged by design: the
 * constants were tuned by ear on the hardware, so an A/B test against the C
 * fails if any of them drifts. What changed is the language, and with it the
 * indexing, the parser and the FFI boundary — which lives entirely in
 * schwung-plugin, so there is no `unsafe` in this crate at all.
 *
 * EVERYTHING HERE RUNS ON THE SPI CALLBACK. No allocation after `create`, no
 * locks, no I/O, and — see the denies below — no reachable Rust panic: a fault
 * on that thread takes MoveOriginal down with it.
 */
#![cfg_attr(feature = "rt", no_std)]
#![deny(clippy::indexing_slicing, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

extern crate alloc;

mod parse;
mod ring;
mod voice;

use alloc::boxed::Box;
use libm::{powf, sinf};
use ring::{Event, Ring};
use schwung_plugin::{schwung_plugin, SchwungPlugin};
use voice::{Voice, SINE_SIZE};

/// Answered by get_param("ping"), so the UI can tell the engine loaded.
const ENGINE_VERSION: &[u8] = b"1";
const MAX_VOICES: usize = 16;

pub struct Piano {
    sine: [f32; SINE_SIZE],
    freq: [f32; 128],
    voices: [Voice; MAX_VOICES],
    counter: u32,
    gain: f32,
    ring: Ring,
}

impl Piano {
    /// Retrigger the same pitch first so repeated notes do not stack, then any
    /// free voice, then steal the one that has been going longest.
    fn pick(&mut self, pitch: u8) -> Option<&mut Voice> {
        if let Some(i) = self
            .voices
            .iter()
            .position(|v| v.active && v.pitch == pitch)
            .or_else(|| self.voices.iter().position(|v| !v.active))
        {
            return self.voices.get_mut(i);
        }
        let oldest = self
            .voices
            .iter()
            .enumerate()
            .min_by_key(|(_, v)| v.age)
            .map(|(i, _)| i)?;
        self.voices.get_mut(oldest)
    }

    fn apply(&mut self, e: Event) {
        match e {
            Event::None => {}
            Event::Panic => {
                for v in self.voices.iter_mut() {
                    v.active = false;
                }
            }
            Event::ReleaseAll => {
                for v in self.voices.iter_mut() {
                    if v.active {
                        v.release();
                    }
                }
            }
            Event::NoteOn { pitch, vel } => {
                self.counter = self.counter.wrapping_add(1);
                let age = self.counter;
                let f0 = self.freq.get(pitch as usize & 127).copied().unwrap_or(0.0);
                /* Velocity 0 arrives as a note-off elsewhere; a note-on that
                 * still carries 0 is floored at 1, as the C did. */
                let vel = if vel == 0 { 1 } else { vel };
                if let Some(v) = self.pick(pitch) {
                    v.start(f0, pitch, vel, age);
                }
            }
            Event::NoteOff { pitch } => {
                for v in self.voices.iter_mut() {
                    if v.active && v.pitch == pitch {
                        v.release();
                    }
                }
            }
        }
    }

    fn set_notes(&mut self, list: &[u8]) {
        /*
         * A list rather than one note per call because the overtake parameter
         * channel is a single-slot mailbox — three calls in a row for a chord
         * would overwrite each other and two of the notes would never arrive.
         * One write carries the whole frame's worth.
         */
        for entry in parse::notes(list) {
            let Some((pitch, vel)) = parse::note(entry) else {
                continue;
            };
            self.ring.push(if vel > 0 {
                Event::NoteOn { pitch, vel }
            } else {
                Event::NoteOff { pitch }
            });
        }
    }
}

impl SchwungPlugin for Piano {
    fn create(_module_dir: Option<&[u8]>, _json_defaults: Option<&[u8]>) -> Option<Self> {
        /*
         * Zeroed on the heap and filled in place. `Box::new(Piano { .. })`
         * would build ~10KB of tables on the stack first and then copy — on
         * the SPI callback, where the frame is not ours to spend.
         */
        let mut p: Box<Piano> = unsafe {
            let layout = alloc::alloc::Layout::new::<Piano>();
            let raw = alloc::alloc::alloc_zeroed(layout).cast::<Piano>();
            if raw.is_null() {
                return None;
            }
            raw.write(Piano {
                sine: [0.0; SINE_SIZE],
                freq: [0.0; 128],
                voices: [Voice::default(); MAX_VOICES],
                counter: 0,
                gain: 0.22,
                ring: Ring::new(),
            });
            Box::from_raw(raw)
        };

        for (i, s) in p.sine.iter_mut().enumerate() {
            *s = sinf(6.283_185_3 * i as f32 / SINE_SIZE as f32);
        }
        for (i, f) in p.freq.iter_mut().enumerate() {
            *f = 440.0 * powf(2.0, (i as f32 - 69.0) / 12.0);
        }
        /* The trait owns the box; hand back the value. */
        Some(*p)
    }

    /*
     * The panic messages, and deliberately nothing else.
     *
     * Notes arrive through set_param("n", ...) because the parameter channel
     * is a single-slot mailbox and one write has to carry a whole chord.
     * Starting a voice from a MIDI note-on as well would sound every note
     * twice. What MIDI is for here is the thing the parameter channel cannot
     * express: somebody ELSE asking for silence.
     *
     *   CC 120  All Sound Off   cut now
     *   CC 123  All Notes Off   release
     *   0xFF    System Reset    cut now
     *
     * Never channel-scoped. This instrument occupies no channel, so honouring
     * one and ignoring another would make the silence conditional on a number
     * nobody set — and a panic that works on 1 of 16 channels is worse than
     * none, because it looks like it should have worked.
     */
    fn on_midi(&mut self, msg: &[u8], _source: i32) {
        match msg {
            [0xFF, ..] => self.ring.push(Event::Panic),
            [status, cc, _, ..] if status & 0xF0 == 0xB0 => match cc {
                120 => self.ring.push(Event::Panic),
                123 => self.ring.push(Event::ReleaseAll),
                _ => {}
            },
            _ => {}
        }
    }

    fn set_param(&mut self, key: &[u8], val: Option<&[u8]>) {
        match key {
            b"n" => {
                if let Some(v) = val {
                    self.set_notes(v);
                }
            }
            b"panic" => self.ring.push(Event::Panic),
            b"gain" => {
                if let Some(g) = val.and_then(parse::float) {
                    if (0.0..=1.0).contains(&g) {
                        self.gain = g;
                    }
                }
            }
            _ => {}
        }
    }

    fn get_param(&mut self, key: &[u8], out: &mut [u8]) -> usize {
        match key {
            b"ping" => write_bytes(out, ENGINE_VERSION),
            b"voices" => {
                let n = self.voices.iter().filter(|v| v.active).count();
                write_u32(out, n as u32)
            }
            _ => 0,
        }
    }

    fn render(&mut self, out: &mut [i16]) {
        while let Some(e) = self.ring.pop() {
            self.apply(e);
        }

        /* Split the borrow: the voices need the sine table while being ticked. */
        let (sine, voices, gain) = (&self.sine, &mut self.voices, self.gain);

        for frame in out.chunks_exact_mut(2) {
            let mut mix = 0.0f32;
            for v in voices.iter_mut() {
                if !v.active {
                    continue;
                }
                mix += v.tick(sine);
            }

            mix *= gain;
            /* Soft knee rather than a hard clip: a stacked chord should
             * compress, not buzz. */
            mix = if mix > 1.0 {
                1.0
            } else if mix < -1.0 {
                -1.0
            } else {
                mix - (mix * mix * mix) / 3.0
            };

            let s = (mix * 26000.0) as i32;
            let s = s.clamp(-32768, 32767);

            /* The host zeroes this buffer before the call; ADD so we stay
             * correct even if that ever changes — and because an overtake
             * generator is mixed into the deferred buffer, so assigning would
             * silence whatever else is in it. */
            for sample in frame.iter_mut() {
                *sample = (*sample as i32 + s) as i16;
            }
        }
    }
}

/// Copy `src` into `dst`, truncating. Returns bytes written.
fn write_bytes(dst: &mut [u8], src: &[u8]) -> usize {
    let n = core::cmp::min(dst.len(), src.len());
    let (Some(d), Some(s)) = (dst.get_mut(..n), src.get(..n)) else {
        return 0;
    };
    d.copy_from_slice(s);
    n
}

/// Decimal, without a formatter — core::fmt would pull in machinery this has
/// no business carrying onto the audio thread.
fn write_u32(dst: &mut [u8], mut v: u32) -> usize {
    let mut tmp = [0u8; 10];
    let mut n = 0usize;
    loop {
        let d = (v % 10) as u8;
        if let Some(slot) = tmp.get_mut(n) {
            *slot = b'0' + d;
        }
        n += 1;
        v /= 10;
        if v == 0 {
            break;
        }
    }
    let written = core::cmp::min(dst.len(), n);
    for i in 0..written {
        if let (Some(d), Some(s)) = (dst.get_mut(i), tmp.get(n - 1 - i)) {
            *d = *s;
        }
    }
    written
}

schwung_plugin!(Piano);
