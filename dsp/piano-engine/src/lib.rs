// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * piano-engine — the Piano Practice piano, and nothing but the piano.
 *
 * One synthesis, two hosts. The Move reaches it through `piano` (a Schwung
 * plugin that scales to i16); the browser through `piano-wasm` (an
 * AudioWorklet that takes the f32 as it is). Both feed it the same `n` note
 * list and get the same samples back, which is the whole point of the split:
 * a lesson practised in the browser sounds like the instrument on the device.
 *
 * Ported from src/dsp/piano.c. The constants were tuned by ear on the
 * hardware; they and the order of every operation are kept verbatim, so at
 * 44100 the device's output is bit-identical to the C-derived engine it
 * replaced (dsp/piano's tests hold that to a checksum).
 *
 * no_std, no alloc, no unsafe. EVERYTHING HERE RUNS ON AN AUDIO THREAD — the
 * Move's SPI callback or the browser's render quantum — so no allocation, no
 * locks, no I/O, and, through the denies below, no reachable Rust panic.
 */
#![no_std]
#![forbid(unsafe_code)]
#![deny(clippy::indexing_slicing, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

pub mod parse;
mod ring;
mod voice;

use core::f32::consts::TAU;
use libm::{powf, sinf};
use ring::{Event, Ring};
use voice::{damper_for, Voice, SINE_SIZE};

pub use voice::REFERENCE_RATE;

pub const MAX_VOICES: usize = 16;
/// The level a new engine starts at; `set_gain` moves it within 0..=1.
pub const DEFAULT_GAIN: f32 = 0.22;

pub struct Engine {
    sine: [f32; SINE_SIZE],
    freq: [f32; 128],
    voices: [Voice; MAX_VOICES],
    counter: u32,
    gain: f32,
    ring: Ring,
    sample_rate: f32,
    /// The damper's per-sample factor at `sample_rate`, computed once.
    damper: f32,
}

impl Engine {
    /// A silent engine at `sample_rate` Hz (positive and finite — the caller
    /// validates; the Move passes 44100, the browser its AudioContext rate).
    pub fn new(sample_rate: f32) -> Self {
        let mut e = Self {
            sine: [0.0; SINE_SIZE],
            freq: [0.0; 128],
            voices: [Voice::default(); MAX_VOICES],
            counter: 0,
            gain: DEFAULT_GAIN,
            ring: Ring::new(),
            sample_rate,
            damper: damper_for(sample_rate),
        };
        for (i, s) in e.sine.iter_mut().enumerate() {
            /* TAU is the f32 the C's 6.2831853 rounded to; same bits. */
            *s = sinf(TAU * i as f32 / SINE_SIZE as f32);
        }
        for (i, f) in e.freq.iter_mut().enumerate() {
            *f = 440.0 * powf(2.0, (i as f32 - 69.0) / 12.0);
        }
        e
    }

    pub fn sample_rate(&self) -> f32 {
        self.sample_rate
    }

    /// Queue a comma-separated `pitch:velocity` list — the device's `n`
    /// parameter. Velocity 0 is a release. A malformed entry loses only
    /// itself. Applied, in order, at the start of the next block.
    ///
    /// A list rather than one note per call because the Move's overtake
    /// parameter channel is a single-slot mailbox — three calls in a row for a
    /// chord would overwrite each other and two of the notes would never
    /// arrive. One write carries the whole frame's worth.
    pub fn set_notes(&mut self, list: &[u8]) {
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

    /// Queue a cut: every voice silent at the next block, tails included.
    pub fn panic(&mut self) {
        self.ring.push(Event::Panic);
    }

    /// Queue a release of every voice, so each rings out through the damper.
    pub fn release_all(&mut self) {
        self.ring.push(Event::ReleaseAll);
    }

    /// Set the output gain. Values outside 0..=1 (and NaN) are refused and
    /// leave it unchanged; returns whether it was taken.
    pub fn set_gain(&mut self, g: f32) -> bool {
        if (0.0..=1.0).contains(&g) {
            self.gain = g;
            true
        } else {
            false
        }
    }

    pub fn gain(&self) -> f32 {
        self.gain
    }

    pub fn active_voices(&self) -> usize {
        self.voices.iter().filter(|v| v.active).count()
    }

    /// Apply everything queued since the last block. Call once per block,
    /// before its first `next_sample` — `render_f32` does.
    pub fn apply_pending(&mut self) {
        while let Some(e) = self.ring.pop() {
            self.apply(e);
        }
    }

    /// One mono sample in -1..=1: the voices mixed, gained and soft-limited.
    /// Does not apply queued events; see `apply_pending`.
    pub fn next_sample(&mut self) -> f32 {
        let mut mix = 0.0f32;
        for v in self.voices.iter_mut() {
            if !v.active {
                continue;
            }
            mix += v.tick(&self.sine, self.damper);
        }

        mix *= self.gain;
        /* Soft knee rather than a hard clip: a stacked chord should
         * compress, not buzz. */
        if mix > 1.0 {
            1.0
        } else if mix < -1.0 {
            -1.0
        } else {
            mix - (mix * mix * mix) / 3.0
        }
    }

    /// One block: apply what is queued, then fill `out` with mono samples.
    pub fn render_f32(&mut self, out: &mut [f32]) {
        self.apply_pending();
        for s in out.iter_mut() {
            *s = self.next_sample();
        }
    }

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
                let sample_rate = self.sample_rate;
                if let Some(v) = self.pick(pitch) {
                    v.start(f0, pitch, vel, age, sample_rate);
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
}

/* Tests may index and panic: a failed assertion is how they report. */
#[cfg(test)]
#[allow(clippy::indexing_slicing, clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;

    fn run(e: &mut Engine, frames: usize) -> f32 {
        let mut buf = [0.0f32; 512];
        let mut peak = 0.0f32;
        let mut left = frames;
        while left > 0 {
            let n = left.min(buf.len());
            let Some(block) = buf.get_mut(..n) else { break };
            e.render_f32(block);
            for s in block.iter() {
                peak = peak.max(s.abs());
            }
            left -= n;
        }
        peak
    }

    /// Mean period, in samples, between rising zero crossings of one note.
    fn period(sample_rate: f32, note: &[u8]) -> f32 {
        let mut e = Engine::new(sample_rate);
        e.set_notes(note);
        let mut buf = [0.0f32; 16384];
        e.render_f32(&mut buf);
        let (mut first, mut last, mut count) = (None, 0usize, 0usize);
        for i in 1..buf.len() {
            if buf[i - 1] < 0.0 && buf[i] >= 0.0 {
                first.get_or_insert(i);
                last = i;
                count += 1;
            }
        }
        let first = first.expect("the note crosses zero");
        (last - first) as f32 / (count - 1) as f32
    }

    #[test]
    fn silent_until_played() {
        let mut e = Engine::new(44100.0);
        assert_eq!(run(&mut e, 4096), 0.0);
        assert_eq!(e.active_voices(), 0);
    }

    #[test]
    fn a_note_sounds_decays_and_releases() {
        let mut e = Engine::new(44100.0);
        e.set_notes(b"60:100");
        let attack = run(&mut e, 4096);
        assert!(attack > 0.05, "audible: {attack}");
        assert!(attack < 1.0);
        assert_eq!(e.active_voices(), 1);
        run(&mut e, 44100);
        let later = run(&mut e, 4096);
        assert!(later < attack * 0.8, "decays: {later} against {attack}");
        e.set_notes(b"60:0");
        run(&mut e, 44100);
        assert_eq!(e.active_voices(), 0, "the damper retires it");
    }

    #[test]
    fn a_chord_in_one_write_takes_one_voice_per_note() {
        let mut e = Engine::new(44100.0);
        e.set_notes(b"60:100,64:100,67:100");
        run(&mut e, 128);
        assert_eq!(e.active_voices(), 3);
        e.set_notes(b"60:100");
        run(&mut e, 128);
        assert_eq!(e.active_voices(), 3, "a repeated pitch retriggers, not stacks");
    }

    #[test]
    fn more_notes_than_voices_steal_the_oldest() {
        let mut e = Engine::new(44100.0);
        for p in 40..60u8 {
            let list = [b'0' + p / 10, b'0' + p % 10, b':', b'9', b'0'];
            e.set_notes(&list);
        }
        run(&mut e, 128);
        assert_eq!(e.active_voices(), MAX_VOICES);
    }

    #[test]
    fn panic_cuts_and_release_all_rings_out() {
        let mut e = Engine::new(44100.0);
        e.set_notes(b"48:127,60:127,72:127");
        run(&mut e, 1024);
        e.panic();
        assert_eq!(run(&mut e, 128), 0.0, "silent from the very next block");
        assert_eq!(e.active_voices(), 0);

        e.set_notes(b"48:127,60:127");
        run(&mut e, 1024);
        e.release_all();
        let tail = run(&mut e, 128);
        assert!(tail > 0.0, "a release is not a cut");
        run(&mut e, 44100);
        assert_eq!(e.active_voices(), 0);
    }

    #[test]
    fn gain_is_held_to_its_range() {
        let mut e = Engine::new(44100.0);
        assert!(e.set_gain(0.5));
        assert!(!e.set_gain(1.5));
        assert!(!e.set_gain(-0.1));
        assert!(!e.set_gain(f32::NAN));
        assert_eq!(e.gain(), 0.5);
        assert!(e.set_gain(0.0));
        e.set_notes(b"60:127");
        assert_eq!(run(&mut e, 1024), 0.0);
    }

    #[test]
    fn a_stacked_chord_compresses_rather_than_clips() {
        let mut e = Engine::new(44100.0);
        assert!(e.set_gain(1.0));
        e.set_notes(b"36:127,40:127,43:127,48:127,52:127,55:127,60:127,64:127");
        let peak = run(&mut e, 8192);
        assert!(peak <= 1.0, "{peak}");
    }

    #[test]
    fn pitch_follows_the_sample_rate() {
        /* A4: the period in samples scales with the rate, so the pitch in Hz
         * does not move. */
        let p44 = period(44100.0, b"69:100");
        let p48 = period(48000.0, b"69:100");
        let hz44 = 44100.0 / p44;
        let hz48 = 48000.0 / p48;
        assert!((hz44 - 440.0).abs() < 1.0, "{hz44} Hz at 44.1k");
        assert!((hz48 - 440.0).abs() < 1.0, "{hz48} Hz at 48k");
        let ratio = p48 / p44;
        assert!((ratio - 48000.0 / 44100.0).abs() < 0.002, "period ratio {ratio}");
    }

    #[test]
    fn the_release_takes_the_same_time_at_any_rate() {
        fn release_seconds(rate: f32) -> f32 {
            let mut e = Engine::new(rate);
            e.set_notes(b"40:100");
            run(&mut e, 256);
            e.set_notes(b"40:0");
            let mut frames = 0usize;
            let mut buf = [0.0f32; 64];
            while e.active_voices() > 0 && frames < 10 * rate as usize {
                e.render_f32(&mut buf);
                frames += buf.len();
            }
            frames as f32 / rate
        }
        let a = release_seconds(44100.0);
        let b = release_seconds(48000.0);
        assert!((a - b).abs() < 0.01, "{a}s vs {b}s");
        assert_eq!(damper_for(44100.0), 0.99975, "exact at the tuned rate");
    }

    #[test]
    fn render_f32_is_apply_pending_then_next_sample() {
        let mut a = Engine::new(44100.0);
        let mut b = Engine::new(44100.0);
        a.set_notes(b"60:100,67:80");
        b.set_notes(b"60:100,67:80");
        let mut block = [0.0f32; 300];
        a.render_f32(&mut block);
        b.apply_pending();
        for s in block.iter() {
            assert_eq!(s.to_bits(), b.next_sample().to_bits());
        }
    }
}
