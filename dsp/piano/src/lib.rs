// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * piano — the built-in piano for Piano Practice, as a Schwung v2 DSP plugin.
 *
 * An adapter, and only that. The synthesis is piano-engine, shared with the
 * browser build; this crate maps the plugin API onto it — set_param's `n`,
 * `panic` and `gain`, the panic CCs, `ping` and `voices` — and scales the
 * engine's f32 into the host's i16. It also keeps the mailbox between ui.js
 * and a browser page on Schwung's web manager (remote.rs), which is why the
 * tool's DSP answers `module_id`, `state` and `rui_poll`. The FFI boundary lives entirely in
 * schwung-plugin, so this crate has no unchecked code of its own.
 *
 * EVERYTHING HERE RUNS ON THE SPI CALLBACK. No allocation after `create`, no
 * locks, no I/O, and — see the denies below — no reachable Rust panic: a fault
 * on that thread takes MoveOriginal down with it.
 */
#![cfg_attr(feature = "rt", no_std)]
#![deny(clippy::indexing_slicing, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

extern crate alloc;

mod remote;

use piano_engine::{parse, Engine};
use remote::Remote;
use schwung_plugin::{schwung_plugin, SchwungPlugin, MOVE_SAMPLE_RATE};

/// Answered by get_param("ping"), so the UI can tell the engine loaded.
const ENGINE_VERSION: &[u8] = b"1";
/// Full scale for the engine's -1..=1, a little under i16::MAX for headroom.
const FULL_SCALE: f32 = 26000.0;

/// The id Schwung's web manager asks for to offer the Tool tab's page.
const MODULE_ID: &[u8] = b"piano-practice";

pub struct Piano {
    engine: Engine,
    /// The browser page's mailbox; see remote.rs.
    remote: Remote,
}

/// The engine's sample as the host's: scaled, truncated toward zero, clamped.
fn to_i16_range(sample: f32) -> i32 {
    ((sample * FULL_SCALE) as i32).clamp(-32768, 32767)
}

impl SchwungPlugin for Piano {
    fn create(_module_dir: Option<&[u8]>, _json_defaults: Option<&[u8]>) -> Option<Self> {
        Some(Piano {
            engine: Engine::new(MOVE_SAMPLE_RATE as f32),
            remote: Remote::new(),
        })
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
            [0xFF, ..] => self.engine.panic(),
            [status, cc, _, ..] if status & 0xF0 == 0xB0 => match cc {
                120 => self.engine.panic(),
                123 => self.engine.release_all(),
                _ => {}
            },
            _ => {}
        }
    }

    fn set_param(&mut self, key: &[u8], val: Option<&[u8]>) {
        match key {
            b"n" => {
                if let Some(v) = val {
                    self.engine.set_notes(v);
                }
            }
            b"panic" => self.engine.panic(),
            b"vm" => {
                if let Some(v) = val {
                    self.remote.set_state(v);
                }
            }
            b"stale" => self.remote.touch(),
            b"action" => {
                if let Some(v) = val {
                    self.remote.push_action(v);
                }
            }
            b"gain" => {
                if let Some(g) = val.and_then(parse::float) {
                    self.engine.set_gain(g);
                }
            }
            _ => {}
        }
    }

    fn get_param(&mut self, key: &[u8], out: &mut [u8]) -> usize {
        match key {
            b"ping" => write_bytes(out, ENGINE_VERSION),
            b"module_id" => write_bytes(out, MODULE_ID),
            b"state" => self.remote.read_state(out),
            b"rui_poll" => self.remote.poll(out),
            b"inbox" => self.remote.drain_inbox(out),
            b"voices" => write_u32(out, self.engine.active_voices() as u32),
            _ => 0,
        }
    }

    fn render(&mut self, out: &mut [i16]) {
        self.remote.tick();
        self.engine.apply_pending();
        for frame in out.as_chunks_mut::<2>().0 {
            let s = to_i16_range(self.engine.next_sample());
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

/* Tests may index and panic: a failed assertion is how they report. */
#[cfg(test)]
#[allow(clippy::indexing_slicing, clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    extern crate std;
    use super::*;
    use std::format;
    use std::vec::Vec;

    const FRAMES: usize = 128;

    fn piano() -> Piano {
        Piano::create(Some(b"/tmp"), Some(b"{}")).expect("create")
    }

    /// `blocks` host blocks into `sink`, each zeroed first as the host does.
    fn blocks(p: &mut Piano, n: usize, sink: &mut Vec<i16>) {
        let mut buf = [0i16; FRAMES * 2];
        for _ in 0..n {
            buf.fill(0);
            p.render(&mut buf);
            sink.extend_from_slice(&buf);
        }
    }

    fn fnv1a(samples: &[i16]) -> u64 {
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        for b in samples.iter().flat_map(|s| s.to_le_bytes()) {
            h ^= b as u64;
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
        h
    }

    /*
     * The device's output, pinned to what it was before the synthesis moved
     * into piano-engine. The checksum was taken from the previous build through
     * the C ABI (217344 samples); a change here is a change to the instrument
     * on every Move, and has to be one somebody meant.
     */
    #[test]
    fn the_device_output_is_unchanged_by_the_engine_split() {
        let mut p = piano();
        let mut out = Vec::new();
        p.set_param(b"n", Some(b"60:100"));
        blocks(&mut p, 40, &mut out);
        p.set_param(b"n", Some(b"64:80,67:60,72:127,21:30,108:127"));
        blocks(&mut p, 60, &mut out);
        p.set_param(b"n", Some(b"60:0,64:0"));
        blocks(&mut p, 60, &mut out);
        p.set_param(b"gain", Some(b"0.9"));
        for pitch in (30..100).step_by(4) {
            p.set_param(b"n", Some(format!("{pitch}:{pitch}").as_bytes()));
            blocks(&mut p, 3, &mut out);
        }
        blocks(&mut p, 100, &mut out);
        p.on_midi(&[0xB0, 123, 0], 0);
        blocks(&mut p, 80, &mut out);
        p.set_param(b"n", Some(b"48:127,52:127,55:127,60:127,64:127,67:127,72:127,76:127"));
        blocks(&mut p, 50, &mut out);
        p.set_param(b"panic", Some(b"1"));
        blocks(&mut p, 5, &mut out);
        p.set_param(b"gain", Some(b"1"));
        p.set_param(b"n", Some(b"100:127,105:127,110:127,115:127,120:127,127:127"));
        blocks(&mut p, 400, &mut out);

        assert_eq!(out.len(), 217_344);
        assert_eq!(fnv1a(&out), 0xd1d6_9f72_8ca2_e9cd);
    }

    #[test]
    fn the_device_is_the_engine_scaled_to_i16() {
        let mut p = piano();
        let mut e = Engine::new(44100.0);
        let list = b"36:127,48:90,60:100,64:70,67:60,72:127,84:40";
        p.set_param(b"n", Some(list));
        e.set_notes(list);

        let mut f = [0.0f32; FRAMES];
        let mut i = [0i16; FRAMES * 2];
        for _ in 0..200 {
            e.render_f32(&mut f);
            i.fill(0);
            p.render(&mut i);
            for (frame, s) in i.as_chunks::<2>().0.iter().zip(f.iter()) {
                let want = (*s * 26000.0) as i32;
                assert_eq!(*frame, [want as i16, want as i16]);
            }
        }
    }

    #[test]
    fn render_adds_into_the_buffer() {
        let mut p = piano();
        p.set_param(b"n", Some(b"60:127"));
        let mut a = [0i16; FRAMES * 2];
        p.render(&mut a);
        let mut q = piano();
        q.set_param(b"n", Some(b"60:127"));
        let mut b = [100i16; FRAMES * 2];
        q.render(&mut b);
        for (x, y) in a.iter().zip(b.iter()) {
            assert_eq!(*x as i32 + 100, *y as i32);
        }
    }

    #[test]
    fn get_param_answers_ping_and_voices() {
        let mut p = piano();
        let mut out = [0u8; 16];
        assert_eq!(p.get_param(b"ping", &mut out), 1);
        assert_eq!(&out[..1], b"1");
        p.set_param(b"n", Some(b"60:100,64:100,67:100"));
        p.render(&mut [0i16; FRAMES * 2]);
        assert_eq!(p.get_param(b"voices", &mut out), 1);
        assert_eq!(&out[..1], b"3");
        assert_eq!(p.get_param(b"nope", &mut out), 0);
        assert_eq!(write_u32(&mut out, 4_294_967_295), 10);
        assert_eq!(&out[..10], b"4294967295");
        assert_eq!(write_u32(&mut out[..2], 12345), 2, "truncates");
    }

    /* The Tool tab's whole path through this crate: the manager finds the
     * module by id, ui.js leaves the picture, the page reads it and asks for
     * something, ui.js collects the ask. */
    #[test]
    fn the_remote_page_reaches_ui_js_through_the_params() {
        let mut p = piano();
        let mut out = [0u8; 256];
        let n = p.get_param(b"module_id", &mut out);
        assert_eq!(&out[..n], b"piano-practice");
        let n = p.get_param(b"rui_poll", &mut out);
        assert_eq!(&out[..n], b"0:0:0:0");

        p.set_param(b"vm", Some(br#"{"screen":""menu""}"#));
        p.set_param(b"stale", None);
        let n = p.get_param(b"rui_poll", &mut out);
        assert_eq!(&out[..n], b"2:0:0:0");
        let n = p.get_param(b"state", &mut out);
        assert_eq!(&out[..n], br#"{"screen":""menu""}"#);

        p.set_param(b"action", Some(br#"{"type":"back"}"#));
        p.set_param(b"action", None);
        let n = p.get_param(b"inbox", &mut out);
        assert_eq!(&out[..n], b"w\n{\"type\":\"back\"}");
        p.render(&mut [0i16; FRAMES * 2]);
        let n = p.get_param(b"inbox", &mut out);
        assert_eq!(&out[..n], b"w", "drained, and the page still counts as open");
    }

    /* A page that never opened leaves the instrument exactly as it was. */
    #[test]
    fn the_remote_params_do_not_touch_the_sound() {
        let mut a = piano();
        let mut b = piano();
        b.set_param(b"vm", Some(b"{}"));
        b.set_param(b"action", Some(b"{}"));
        for p in [&mut a, &mut b] {
            p.set_param(b"n", Some(b"60:100,67:90"));
        }
        let (mut x, mut y) = (Vec::new(), Vec::new());
        blocks(&mut a, 20, &mut x);
        blocks(&mut b, 20, &mut y);
        assert_eq!(x, y);
    }

    #[test]
    fn gain_out_of_range_is_ignored() {
        let mut p = piano();
        p.set_param(b"gain", Some(b"2"));
        p.set_param(b"gain", Some(b"junk"));
        p.set_param(b"gain", None);
        assert_eq!(p.engine.gain(), piano_engine::DEFAULT_GAIN);
        p.set_param(b"gain", Some(b"0.5"));
        assert_eq!(p.engine.gain(), 0.5);
    }
}
