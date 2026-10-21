// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * The voices. V of them over a pack the caller lends per call.
 *
 * A note-on picks one zone: the one whose key and velocity ranges hold the
 * note and whose round robin position is next for that key. The voice copies
 * the zone, so nothing re-reads the table while it plays, and resamples it to
 * the output rate and the note's pitch with 4-point Hermite interpolation —
 * exact at a ratio of 1, so an unpitched drum at the pack's own rate comes out
 * as recorded.
 *
 * Level is SFZ's amp_veltrack: the zone's gain, scaled by velocity squared as
 * far as its `veltrack` says, on top of whichever velocity layer was picked.
 *
 * Endings are fades, never cuts, except for panic and for stealing when every
 * voice is taken:
 *   note-off           release_ms, unless the zone is one-shot (a drum)
 *   choked / masked    off_ms: an open hi-hat when a closed one is struck
 *                      (group / off_by), or under Retrigger::Release the
 *                      previous strike of the same key
 * A fade is exponential, -60 dB over its time, and the voice retires once it
 * is 80 dB down.
 */
use crate::pack::{Pack, Zone};
use libm::powf;

/// What a new strike of a key does to the one still sounding.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Retrigger {
    /// Fade the old strike out over its zone's off_ms. A piano: one string
    /// per key, struck again.
    Release,
    /// Leave it ringing. Drums: a flam's two strokes both sound.
    Stack,
}

/// Below this a fading voice is inaudible (-80 dB) and retires.
const SILENT: f32 = 1e-4;

#[derive(Clone, Copy, Debug, Default)]
struct Voice {
    active: bool,
    key: u8,
    zone: Zone,
    /// Integer frame within the zone, and the fraction past it.
    pos: u32,
    frac: f32,
    /// Frames of source per output sample.
    step: f32,
    gain: f32,
    /// Fade state: `level` multiplies the output and is multiplied by
    /// `decay` every sample; 1 and 1 while the voice sustains.
    level: f32,
    decay: f32,
    fading: bool,
    age: u32,
}

impl Voice {
    #[inline]
    fn tick(&mut self, pack: &Pack) -> f32 {
        let z = &self.zone;
        let at = z.offset.wrapping_add(self.pos);
        let frame = |i: u32, ok: bool| if ok { pack.frame(i) } else { 0.0 };
        let xm1 = frame(at.wrapping_sub(1), self.pos > 0);
        let x0 = pack.frame(at);
        let x1 = frame(at.wrapping_add(1), self.pos + 1 < z.len);
        let x2 = frame(at.wrapping_add(2), self.pos + 2 < z.len);
        let f = self.frac;
        let c1 = 0.5 * (x1 - xm1);
        let c2 = xm1 - 2.5 * x0 + 2.0 * x1 - 0.5 * x2;
        let c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
        let y = ((c3 * f + c2) * f + c1) * f + x0;

        let out = y * self.gain * self.level;
        self.level *= self.decay;
        self.frac += self.step;
        let whole = self.frac as u32;
        self.frac -= whole as f32;
        self.pos = self.pos.saturating_add(whole);
        if self.pos >= z.len || (self.fading && self.level < SILENT) {
            self.active = false;
        }
        out
    }
}

pub struct Sampler<const V: usize> {
    voices: [Voice; V],
    out_rate: f32,
    retrigger: Retrigger,
    /// Strikes so far per key: the next round robin position is this modulo
    /// the cell's seq_len.
    strikes: [u8; 128],
    counter: u32,
}

impl<const V: usize> Sampler<V> {
    /// A silent sampler rendering at `out_rate` Hz (positive and finite; the
    /// caller validates, as piano-engine's does).
    pub fn new(out_rate: f32, retrigger: Retrigger) -> Self {
        Sampler { voices: [Voice::default(); V], out_rate, retrigger, strikes: [0; 128], counter: 0 }
    }

    pub fn active_voices(&self) -> usize {
        self.voices.iter().filter(|v| v.active).count()
    }

    /// Start `key` at `vel` (1..=127; 0 is a note-off). A key the pack has no
    /// zone for is silence.
    pub fn note_on(&mut self, pack: &Pack, key: u8, vel: u8) {
        if vel == 0 {
            self.note_off(key);
            return;
        }
        let Some(zone) = self.pick_zone(pack, key, vel) else { return };
        let step = powf(2.0, ((key as f32 - zone.root as f32) * 100.0 + zone.tune as f32) / 1200.0)
            * (pack.rate() as f32 / self.out_rate);
        if !step.is_finite() || step <= 0.0 {
            return;
        }

        let out_rate = self.out_rate;
        for v in self.voices.iter_mut().filter(|v| v.active) {
            let choked = zone.group != 0 && v.zone.off_by == zone.group;
            let masked = self.retrigger == Retrigger::Release && v.key == key && !v.fading;
            if choked || masked {
                v.fade(v.zone.off_ms, out_rate);
            }
        }

        self.counter = self.counter.wrapping_add(1);
        let age = self.counter;
        let t = zone.veltrack as f32 / 100.0;
        let v = vel.min(127) as f32 / 127.0;
        let gain = zone.gain * (1.0 - t + t * v * v);
        if let Some(slot) = self.free_voice() {
            *slot = Voice {
                active: true,
                key,
                zone,
                pos: 0,
                frac: 0.0,
                step,
                gain,
                level: 1.0,
                decay: 1.0,
                fading: false,
                age,
            };
        }
    }

    /// Release every sustaining strike of `key`. One-shot zones ignore it.
    pub fn note_off(&mut self, key: u8) {
        let out_rate = self.out_rate;
        for v in self.voices.iter_mut() {
            if v.active && v.key == key && !v.fading && !v.zone.one_shot() {
                v.fade(v.zone.release_ms, out_rate);
            }
        }
    }

    /// All notes off: what note_off does, for every key.
    pub fn release_all(&mut self) {
        let out_rate = self.out_rate;
        for v in self.voices.iter_mut() {
            if v.active && !v.fading && !v.zone.one_shot() {
                v.fade(v.zone.release_ms, out_rate);
            }
        }
    }

    /// Silence now, tails included.
    pub fn panic(&mut self) {
        for v in self.voices.iter_mut() {
            v.active = false;
        }
    }

    /// One mono sample: every voice, summed. Unscaled and unlimited; the
    /// host applies its own gain and limiter.
    #[inline]
    pub fn next(&mut self, pack: &Pack) -> f32 {
        let mut mix = 0.0f32;
        for v in self.voices.iter_mut() {
            if v.active {
                mix += v.tick(pack);
            }
        }
        mix
    }

    /// The zone for this strike: the first that holds key and velocity
    /// decides the cell's round robin length; then the one at the key's next
    /// position, or that first one if the cell has no such position.
    fn pick_zone(&mut self, pack: &Pack, key: u8, vel: u8) -> Option<Zone> {
        let zones = (0..pack.zone_count()).filter_map(|i| pack.zone(i));
        let first = zones.clone().find(|z| z.matches(key, vel))?;
        let strikes = self.strikes.get_mut(key as usize)?;
        let want = (*strikes % first.seq_len.max(1)) + 1;
        *strikes = strikes.wrapping_add(1);
        Some(zones.filter(|z| z.matches(key, vel)).find(|z| z.seq == want).unwrap_or(first))
    }

    /// A free voice; else the quietest one already fading; else the oldest.
    fn free_voice(&mut self) -> Option<&mut Voice> {
        let i = self
            .voices
            .iter()
            .position(|v| !v.active)
            .or_else(|| {
                self.voices
                    .iter()
                    .enumerate()
                    .filter(|(_, v)| v.fading)
                    .min_by(|(_, a), (_, b)| a.level.total_cmp(&b.level))
                    .map(|(i, _)| i)
            })
            .or_else(|| self.voices.iter().enumerate().min_by_key(|(_, v)| v.age).map(|(i, _)| i))?;
        self.voices.get_mut(i)
    }
}

impl Voice {
    /// Begin an exponential fade, -60 dB over `ms` (0: gone next sample).
    fn fade(&mut self, ms: u16, out_rate: f32) {
        let samples = ms as f32 * 0.001 * out_rate;
        self.decay = if samples >= 1.0 { powf(0.001, 1.0 / samples) } else { 0.0 };
        self.fading = true;
    }
}

/* Tests may index and panic: a failed assertion is how they report. */
#[cfg(test)]
#[allow(clippy::indexing_slicing, clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;
    use crate::pack::{PackWriter, FLAG_ONE_SHOT};

    fn zone(lokey: u8, hikey: u8, root: u8) -> Zone {
        Zone { lokey, hikey, root, lovel: 1, hivel: 127, seq: 1, seq_len: 1, gain: 1.0, ..Default::default() }
    }

    /// A pack of `frames` at 44.1k behind one zone.
    fn one(z: Zone, frames: &[i16]) -> Vec<u8> {
        let mut w = PackWriter::new(44100);
        w.push(z, frames).unwrap();
        w.to_bytes()
    }

    fn ramp(n: usize) -> Vec<i16> {
        (0..n).map(|i| (i as i32 * 7 - 3000) as i16).collect()
    }

    fn render<const V: usize>(s: &mut Sampler<V>, p: &Pack, n: usize) -> Vec<f32> {
        (0..n).map(|_| s.next(p)).collect()
    }

    #[test]
    fn at_ratio_one_the_recording_comes_out_as_recorded() {
        let data = ramp(500);
        let bytes = one(zone(36, 36, 36), &data);
        let p = Pack::new(&bytes).unwrap();
        let mut s = Sampler::<4>::new(44100.0, Retrigger::Stack);
        s.note_on(&p, 36, 127);
        let out = render(&mut s, &p, 510);
        for (i, want) in data.iter().enumerate() {
            assert_eq!(out[i], *want as f32 / 32768.0, "frame {i}");
        }
        assert!(out[500..].iter().all(|&x| x == 0.0), "and stops at its end");
        assert_eq!(s.active_voices(), 0);
    }

    #[test]
    fn an_octave_up_plays_twice_as_fast() {
        let bytes = one(zone(0, 127, 60), &ramp(1000));
        let p = Pack::new(&bytes).unwrap();
        let mut s = Sampler::<2>::new(44100.0, Retrigger::Stack);
        s.note_on(&p, 72, 127);
        let mut n = 0;
        while s.active_voices() > 0 {
            s.next(&p);
            n += 1;
        }
        assert_eq!(n, 500);
    }

    #[test]
    fn the_pack_rate_and_the_output_rate_are_both_honoured() {
        let mut w = PackWriter::new(48000);
        w.push(zone(0, 127, 60), &ramp(4800)).unwrap();
        let bytes = w.to_bytes();
        let p = Pack::new(&bytes).unwrap();
        let mut s = Sampler::<2>::new(44100.0, Retrigger::Stack);
        s.note_on(&p, 60, 100);
        let mut n = 0;
        while s.active_voices() > 0 {
            s.next(&p);
            n += 1;
        }
        assert_eq!(n, 4410, "0.1 s of source is 0.1 s of output");
    }

    #[test]
    fn tune_in_cents_moves_the_pitch() {
        let mut z = zone(0, 127, 60);
        z.tune = 1200;
        let bytes = one(z, &ramp(1000));
        let p = Pack::new(&bytes).unwrap();
        let mut s = Sampler::<1>::new(44100.0, Retrigger::Stack);
        s.note_on(&p, 60, 100);
        let n = std::iter::from_fn(|| (s.active_voices() > 0).then(|| s.next(&p))).count();
        assert_eq!(n, 500);
    }

    #[test]
    fn velocity_picks_the_layer_and_veltrack_scales_within_it() {
        let mut w = PackWriter::new(44100);
        let mut soft = zone(60, 60, 60);
        soft.hivel = 63;
        soft.veltrack = 100;
        w.push(soft, &[10_000; 8]).unwrap();
        let mut loud = zone(60, 60, 60);
        loud.lovel = 64;
        loud.veltrack = 0;
        w.push(loud, &[20_000; 8]).unwrap();
        let bytes = w.to_bytes();
        let p = Pack::new(&bytes).unwrap();
        let mut s = Sampler::<2>::new(44100.0, Retrigger::Stack);

        s.note_on(&p, 60, 127);
        let x = s.next(&p);
        assert_eq!(x, 20_000.0 / 32768.0, "veltrack 0: the layer as recorded");
        s.panic();
        s.note_on(&p, 60, 127 / 2);
        let y = s.next(&p);
        let v = (127 / 2) as f32 / 127.0;
        assert!((y - 10_000.0 / 32768.0 * v * v).abs() < 1e-6, "veltrack 100: velocity squared");
    }

    #[test]
    fn round_robins_cycle_in_order_and_never_repeat_back_to_back() {
        let mut w = PackWriter::new(44100);
        for seq in 1..=3u8 {
            let mut z = zone(38, 38, 38);
            z.seq = seq;
            z.seq_len = 3;
            w.push(z, &[seq as i16 * 1000; 4]).unwrap();
        }
        let bytes = w.to_bytes();
        let p = Pack::new(&bytes).unwrap();
        let mut s = Sampler::<1>::new(44100.0, Retrigger::Stack);
        let mut heard = Vec::new();
        for _ in 0..7 {
            s.panic();
            s.note_on(&p, 38, 127);
            heard.push((s.next(&p) * 32768.0).round() as i32);
        }
        assert_eq!(heard, [1000, 2000, 3000, 1000, 2000, 3000, 1000]);
    }

    #[test]
    fn a_closed_hat_chokes_the_open_one_but_not_itself() {
        let mut w = PackWriter::new(44100);
        let mut open = zone(46, 46, 46);
        open.off_by = 1;
        open.off_ms = 5;
        open.flags = FLAG_ONE_SHOT;
        w.push(open, &[8000; 44100]).unwrap();
        let mut closed = zone(42, 42, 42);
        closed.group = 1;
        closed.flags = FLAG_ONE_SHOT;
        w.push(closed, &[8000; 44100]).unwrap();
        let bytes = w.to_bytes();
        let p = Pack::new(&bytes).unwrap();
        let mut s = Sampler::<4>::new(44100.0, Retrigger::Stack);
        s.note_on(&p, 46, 127);
        render(&mut s, &p, 100);
        s.note_on(&p, 42, 127);
        s.note_on(&p, 42, 127);
        render(&mut s, &p, 2000);
        assert_eq!(s.active_voices(), 2, "the open hat is gone, both closed strokes ring");
    }

    #[test]
    fn note_off_releases_sustained_zones_and_leaves_one_shots() {
        let mut w = PackWriter::new(44100);
        let mut held = zone(60, 60, 60);
        held.release_ms = 10;
        w.push(held, &[8000; 44100]).unwrap();
        let mut hit = zone(36, 36, 36);
        hit.flags = FLAG_ONE_SHOT;
        w.push(hit, &[8000; 44100]).unwrap();
        let bytes = w.to_bytes();
        let p = Pack::new(&bytes).unwrap();
        let mut s = Sampler::<4>::new(44100.0, Retrigger::Stack);
        s.note_on(&p, 60, 127);
        s.note_on(&p, 36, 127);
        s.note_off(60);
        s.note_off(36);
        let out = render(&mut s, &p, 1000);
        assert!(out[1] < out[0], "a fade, not a cut");
        assert_eq!(s.active_voices(), 1, "the piano note is released, the drum rings");
        s.note_on(&p, 60, 127);
        s.release_all();
        render(&mut s, &p, 1000);
        assert_eq!(s.active_voices(), 1);
        s.panic();
        assert_eq!(s.active_voices(), 0);
        assert_eq!(s.next(&p), 0.0);
    }

    #[test]
    fn retrigger_release_masks_the_old_strike_and_stack_keeps_it() {
        let mut z = zone(60, 60, 60);
        z.off_ms = 2;
        let bytes = one(z, &[8000; 44100]);
        let p = Pack::new(&bytes).unwrap();
        let mut piano = Sampler::<4>::new(44100.0, Retrigger::Release);
        let mut drums = Sampler::<4>::new(44100.0, Retrigger::Stack);
        for s in [&mut piano, &mut drums] {
            s.note_on(&p, 60, 100);
            s.next(&p);
            s.note_on(&p, 60, 100);
            render(s, &p, 1000);
        }
        assert_eq!(piano.active_voices(), 1);
        assert_eq!(drums.active_voices(), 2);
    }

    #[test]
    fn when_every_voice_is_taken_the_oldest_is_stolen() {
        let mut w = PackWriter::new(44100);
        for k in 0..4u8 {
            w.push(zone(k, k, k), &[(k as i16 + 1) * 1000; 1000]).unwrap();
        }
        let bytes = w.to_bytes();
        let p = Pack::new(&bytes).unwrap();
        let mut s = Sampler::<3>::new(44100.0, Retrigger::Stack);
        for k in 0..4u8 {
            s.note_on(&p, k, 127);
        }
        assert_eq!(s.active_voices(), 3);
        let sum = (s.next(&p) * 32768.0).round() as i32;
        assert_eq!(sum, 2000 + 3000 + 4000, "key 0 was stolen");
    }

    #[test]
    fn a_fading_voice_is_stolen_before_the_oldest() {
        let mut w = PackWriter::new(44100);
        for k in 0..3u8 {
            let mut z = zone(k, k, k);
            z.release_ms = 1000;
            w.push(z, &[(k as i16 + 1) * 1000; 1000]).unwrap();
        }
        let bytes = w.to_bytes();
        let p = Pack::new(&bytes).unwrap();
        let mut s = Sampler::<2>::new(44100.0, Retrigger::Stack);
        s.note_on(&p, 0, 127);
        s.note_on(&p, 1, 127);
        s.note_off(1);
        s.note_on(&p, 2, 127);
        let sum = (s.next(&p) * 32768.0).round() as i32;
        assert_eq!(sum, 1000 + 3000, "the released key 1 went, the older key 0 stayed");
    }

    #[test]
    fn unknown_keys_zero_velocity_and_absurd_pitches_are_silence() {
        let bytes = one(zone(60, 60, 60), &[8000; 100]);
        let p = Pack::new(&bytes).unwrap();
        let mut s = Sampler::<2>::new(44100.0, Retrigger::Stack);
        s.note_on(&p, 61, 100);
        assert_eq!(s.active_voices(), 0);
        s.note_on(&p, 60, 100);
        s.note_on(&p, 60, 0);
        assert_eq!(s.active_voices(), 1, "velocity 0 is a note-off, and this zone sustains");
        let mut z = zone(0, 127, 0);
        z.tune = i16::MAX;
        let bytes = one(z, &[8000; 100]);
        let p = Pack::new(&bytes).unwrap();
        let mut s = Sampler::<2>::new(0.0, Retrigger::Stack);
        s.note_on(&p, 127, 100);
        assert_eq!(s.active_voices(), 0, "an infinite step is refused");
    }

    #[test]
    fn a_zero_ms_fade_is_gone_on_the_next_sample() {
        let bytes = one(zone(60, 60, 60), &[8000; 100]);
        let p = Pack::new(&bytes).unwrap();
        let mut s = Sampler::<1>::new(44100.0, Retrigger::Stack);
        s.note_on(&p, 60, 127);
        s.note_off(60);
        assert!(s.next(&p) > 0.0);
        assert_eq!(s.next(&p), 0.0);
        assert_eq!(s.active_voices(), 0);
    }
}
