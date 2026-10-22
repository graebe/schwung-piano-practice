// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * piano-engine — the Piano Practice piano, and nothing but the piano.
 *
 * Two voices for one instrument. With a pack loaded (load_piano) it plays a
 * recorded grand through ni-sampler; without one — no file, a broken file —
 * it plays the additive synthesis it always had, so a bad install is a
 * plainer piano, never silence. The metronome is the same: recorded claves
 * from load_click, or high piano notes when there are none.
 *
 * The packs are borrowed bytes of whatever storage the host keeps them in
 * (`S`: a Vec on the Move, a slice of linear memory in the browser); the
 * engine reads them in place and never copies or allocates.
 *
 * One synthesis, two hosts. The Move reaches it through `piano` (a Schwung
 * plugin that scales to i16); the browser through `piano-wasm` (an
 * AudioWorklet that takes the f32 as it is). Both feed it the same `n` note
 * list and get the same samples back, which is the whole point of the split:
 * a lesson practised in the browser sounds like the instrument on the device.
 *
 * The synthesis is ported from src/dsp/piano.c. Its constants were tuned by
 * ear on the hardware; they and the order of every operation are kept
 * verbatim, so without a pack, at 44100, the device's output is bit-identical
 * to the C-derived engine it replaced (dsp/piano's tests hold that to a
 * checksum).
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
use ni_sampler::{Pack, PackError, Retrigger, Sampler};
use ring::{Event, Ring};
use voice::{damper_for, Voice, SINE_SIZE};

pub use voice::REFERENCE_RATE;

pub const MAX_VOICES: usize = 16;
/// The recorded piano's voices: more than the synth's, because a sampled
/// key fades out over its off time when struck again rather than restarting.
pub const SAMPLED_VOICES: usize = 24;
/// The level a new engine starts at; `set_gain` moves it within 0..=1.
pub const DEFAULT_GAIN: f32 = 0.22;
/// The recorded piano against the synth, before the shared gain: chosen so
/// a mid-range chord at velocity 100 is as loud either way
/// (tests::the_recording_is_as_loud_as_the_synth holds it there).
pub const SAMPLED_TRIM: f32 = 4.0;
/// The claves against the piano, before the shared gain.
pub const CLICK_TRIM: f32 = 1.0;
/// Without a click pack the metronome is the piano, as it always was: these
/// notes (pitch, velocity), released after CLICK_GATE_MS.
const CLICK_BEAT: (u8, u8) = (91, 55);
const CLICK_DOWNBEAT: (u8, u8) = (96, 90);
const CLICK_GATE_MS: f32 = 60.0;

/// Which piano is playing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Synth,
    Sampled,
}

/// The engine without packs, whose storage type nothing ever needs to name.
pub type SynthEngine = Engine<&'static [u8]>;

pub struct Engine<S = &'static [u8]> {
    sine: [f32; SINE_SIZE],
    freq: [f32; 128],
    voices: [Voice; MAX_VOICES],
    counter: u32,
    gain: f32,
    ring: Ring,
    sample_rate: f32,
    /// The damper's per-sample factor at `sample_rate`, computed once.
    damper: f32,
    /// Validated packs, read in place, and the voices that play them.
    piano: Option<S>,
    click: Option<S>,
    sampler: Sampler<SAMPLED_VOICES>,
    clicker: Sampler<2>,
    /// Samples until the synthesized click's notes are released; 0 idle.
    click_gate: u32,
}

impl Engine {
    /// A silent engine at `sample_rate` Hz that will never hold a pack: the
    /// synthesized piano. See `with_storage` for one that can.
    pub fn new(sample_rate: f32) -> Self {
        Self::with_storage(sample_rate)
    }
}

impl<S: AsRef<[u8]>> Engine<S> {
    /// A silent engine at `sample_rate` Hz (positive and finite — the caller
    /// validates; the Move passes 44100, the browser its AudioContext rate),
    /// synthesized until a pack is loaded.
    pub fn with_storage(sample_rate: f32) -> Self {
        let mut e = Self {
            sine: [0.0; SINE_SIZE],
            freq: [0.0; 128],
            voices: [Voice::default(); MAX_VOICES],
            counter: 0,
            gain: DEFAULT_GAIN,
            ring: Ring::new(),
            sample_rate,
            damper: damper_for(sample_rate),
            piano: None,
            click: None,
            sampler: Sampler::new(sample_rate, Retrigger::Release),
            clicker: Sampler::new(sample_rate, Retrigger::Stack),
            click_gate: 0,
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

    /// Play the piano from this pack from now on. A pack that does not
    /// validate is refused and the engine keeps what it had. Call between
    /// blocks (from the thread that renders); not for the audio callback on
    /// the Move, where `create` is the place.
    pub fn load_piano(&mut self, pack: S) -> Result<(), PackError> {
        Pack::validate(pack.as_ref())?;
        self.sampler.panic();
        self.piano = Some(pack);
        Ok(())
    }

    /// The metronome's pack: key 1 the downbeat, key 0 every other beat.
    pub fn load_click(&mut self, pack: S) -> Result<(), PackError> {
        Pack::validate(pack.as_ref())?;
        self.clicker.panic();
        self.click = Some(pack);
        Ok(())
    }

    pub fn source(&self) -> Source {
        if self.piano.is_some() {
            Source::Sampled
        } else {
            Source::Synth
        }
    }

    pub fn has_click(&self) -> bool {
        self.click.is_some()
    }

    /// Queue one metronome tick: the claves, or without them two high piano
    /// notes. Applied with the notes at the next block.
    pub fn click(&mut self, downbeat: bool) {
        self.ring.push(Event::Click { downbeat });
    }

    /// Queue a comma-separated `pitch:velocity` list — the device's `n`
    /// parameter. Velocity 0 is a release; `c:1` / `c:0` is a metronome tick
    /// (see `click`). A malformed entry loses only itself. Applied, in order,
    /// at the start of the next block.
    ///
    /// A list rather than one note per call because the Move's overtake
    /// parameter channel is a single-slot mailbox — three calls in a row for a
    /// chord would overwrite each other and two of the notes would never
    /// arrive. One write carries the whole frame's worth.
    pub fn set_notes(&mut self, list: &[u8]) {
        for entry in parse::notes(list) {
            if let Some(downbeat) = parse::click(entry) {
                self.click(downbeat);
                continue;
            }
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

    /// Sounding piano voices, synthesized and recorded; the click's are not
    /// counted.
    pub fn active_voices(&self) -> usize {
        self.voices.iter().filter(|v| v.active).count() + self.sampler.active_voices()
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
        if let Some(p) = self.piano.as_ref().and_then(|b| Pack::new(b.as_ref()).ok()) {
            mix += self.sampler.next(&p) * SAMPLED_TRIM;
        }
        if let Some(p) = self.click.as_ref().and_then(|b| Pack::new(b.as_ref()).ok()) {
            mix += self.clicker.next(&p) * CLICK_TRIM;
        }
        if self.click_gate > 0 {
            self.click_gate -= 1;
            if self.click_gate == 0 {
                for (pitch, _) in [CLICK_BEAT, CLICK_DOWNBEAT] {
                    self.apply(Event::NoteOff { pitch });
                }
            }
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
                self.sampler.panic();
                self.clicker.panic();
                self.click_gate = 0;
            }
            Event::ReleaseAll => {
                for v in self.voices.iter_mut() {
                    if v.active {
                        v.release();
                    }
                }
                self.sampler.release_all();
            }
            Event::Click { downbeat } => match self.click.as_ref().and_then(|b| Pack::new(b.as_ref()).ok()) {
                Some(p) => self.clicker.note_on(&p, downbeat as u8, 127),
                None => {
                    let (pitch, vel) = if downbeat { CLICK_DOWNBEAT } else { CLICK_BEAT };
                    self.apply(Event::NoteOn { pitch, vel });
                    self.click_gate = (CLICK_GATE_MS * 0.001 * self.sample_rate).max(1.0) as u32;
                }
            },
            Event::NoteOn { pitch, vel } => {
                self.counter = self.counter.wrapping_add(1);
                let age = self.counter;
                let f0 = self.freq.get(pitch as usize & 127).copied().unwrap_or(0.0);
                /* Velocity 0 arrives as a note-off elsewhere; a note-on that
                 * still carries 0 is floored at 1, as the C did. */
                let vel = if vel == 0 { 1 } else { vel };
                if let Some(p) = self.piano.as_ref().and_then(|b| Pack::new(b.as_ref()).ok()) {
                    self.sampler.note_on(&p, pitch, vel);
                    return;
                }
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
                self.sampler.note_off(pitch);
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

    /* ---- the recorded piano ---- */

    extern crate std;
    use ni_sampler::{PackWriter, Zone, FLAG_ONE_SHOT};
    use std::vec::Vec;

    fn shipped(name: &str) -> Vec<u8> {
        let path = std::format!("{}/../../samples/{name}.nisp", env!("CARGO_MANIFEST_DIR"));
        std::fs::read(&path).expect("the committed pack (git lfs pull if this is a pointer)")
    }

    fn sampled() -> Engine<Vec<u8>> {
        let mut e = Engine::with_storage(44100.0);
        e.load_piano(shipped("piano")).unwrap();
        e
    }

    fn rms<S: AsRef<[u8]>>(e: &mut Engine<S>, frames: usize) -> f32 {
        let mut buf = std::vec![0.0f32; frames];
        e.render_f32(&mut buf);
        libm::sqrtf(buf.iter().map(|s| s * s).sum::<f32>() / frames as f32)
    }

    /// One zone over every key: a held tone at 44.1k.
    fn tiny_pack(flags: u8) -> Vec<u8> {
        let mut w = PackWriter::new(44100);
        let z = Zone { lokey: 0, hikey: 127, root: 60, lovel: 1, hivel: 127, seq: 1, seq_len: 1, gain: 1.0, release_ms: 20, off_ms: 5, flags, ..Default::default() };
        let tone: Vec<i16> = (0..44100).map(|i| if (i / 50) % 2 == 0 { 8000 } else { -8000 }).collect();
        w.push(z, &tone).unwrap();
        w.to_bytes()
    }

    #[test]
    fn the_recording_is_as_loud_as_the_synth() {
        let chord = b"60:100,64:100,67:100";
        let mut synth = Engine::new(44100.0);
        let mut rec = sampled();
        synth.set_notes(chord);
        rec.set_notes(chord);
        let (a, b) = (rms(&mut synth, 44100), rms(&mut rec, 44100));
        let db = 20.0 * libm::log10f(b / a);
        assert!(db.abs() < 1.5, "the recorded chord is {db:+.1} dB against the synth's");
    }

    #[test]
    fn a_pack_switches_the_piano_and_a_bad_one_is_refused() {
        let mut e: Engine<Vec<u8>> = Engine::with_storage(44100.0);
        assert_eq!(e.source(), Source::Synth);
        assert!(e.load_piano(b"not a pack".to_vec()).is_err());
        assert_eq!(e.source(), Source::Synth, "and the synth stays");
        e.load_piano(tiny_pack(0)).unwrap();
        assert_eq!(e.source(), Source::Sampled);
        e.set_notes(b"60:100");
        assert!(rms(&mut e, 1024) > 0.01);
        assert_eq!(e.active_voices(), 1);
        assert!(e.voices.iter().all(|v| !v.active), "no synth voice took it");
    }

    #[test]
    fn note_off_release_all_and_panic_reach_the_recorded_piano() {
        let mut e: Engine<Vec<u8>> = Engine::with_storage(44100.0);
        e.load_piano(tiny_pack(0)).unwrap();
        e.set_notes(b"60:100,64:100");
        rms(&mut e, 128);
        e.set_notes(b"60:0");
        rms(&mut e, 4410);
        assert_eq!(e.active_voices(), 1, "a note-off releases its key only");
        e.release_all();
        rms(&mut e, 4410);
        assert_eq!(e.active_voices(), 0);
        e.set_notes(b"60:100");
        rms(&mut e, 128);
        e.panic();
        assert_eq!(rms(&mut e, 128), 0.0);
    }

    #[test]
    fn the_shipped_piano_plays_every_key_and_masks_a_restruck_one() {
        let mut e = sampled();
        for k in 21..=108u8 {
            e.set_notes(std::format!("{k}:90").as_bytes());
        }
        assert!(rms(&mut e, 256) > 0.0);
        assert_eq!(e.active_voices(), SAMPLED_VOICES, "88 keys, the voices full");
        e.panic();
        e.set_notes(b"60:100");
        rms(&mut e, 128);
        e.set_notes(b"60:100");
        rms(&mut e, 44100);
        assert_eq!(e.active_voices(), 1, "the first strike faded under the second");
    }

    #[test]
    fn the_click_is_the_claves_when_there_are_some() {
        let mut e: Engine<Vec<u8>> = Engine::with_storage(44100.0);
        e.load_click(shipped("click")).unwrap();
        assert!(e.has_click());
        assert!(e.load_click(Vec::new()).is_err());
        assert!(e.has_click(), "a bad pack leaves the good one");
        e.set_notes(b"c:1");
        let down = rms(&mut e, 4410);
        assert_eq!(e.active_voices(), 0, "the click is not a piano voice");
        rms(&mut e, 44100);
        e.set_notes(b"60:0, c:0 ,c:2");
        let beat = rms(&mut e, 4410);
        assert!(down > beat * 1.2, "the downbeat stands out: {down} against {beat}");
        assert!(beat > 0.0);
        e.click(true);
        e.panic();
        assert_eq!(rms(&mut e, 128), 0.0);
    }

    #[test]
    fn without_claves_the_click_is_two_piano_notes_released_after_a_moment() {
        let mut e = Engine::new(44100.0);
        assert!(!e.has_click());
        e.click(true);
        rms(&mut e, 128);
        let v = e.voices.iter().find(|v| v.active).copied().unwrap();
        assert_eq!((v.pitch, v.releasing), (96, false));
        rms(&mut e, 44100 / 10);
        assert!(e.voices.iter().filter(|v| v.active).all(|v| v.releasing), "released by the gate");
        e.click(false);
        rms(&mut e, 128);
        assert!(e.voices.iter().any(|v| v.active && v.pitch == 91 && !v.releasing));
        e.panic();
        rms(&mut e, 128);
        assert_eq!(e.click_gate, 0);
    }

    #[test]
    fn a_one_shot_pack_ignores_note_off() {
        let mut e: Engine<Vec<u8>> = Engine::with_storage(44100.0);
        e.load_piano(tiny_pack(FLAG_ONE_SHOT)).unwrap();
        e.set_notes(b"60:100");
        rms(&mut e, 128);
        e.set_notes(b"60:0");
        rms(&mut e, 4410);
        assert_eq!(e.active_voices(), 1);
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
