// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * The worst case the device will see, timed: every recorded voice sounding,
 * rendered in the Move's 128-frame blocks.
 *
 *   bench <piano.nisp> [seconds]
 *
 * Prints the mean and worst time per block against the block's own length
 * (2.9 ms at 44.1 kHz). Built for aarch64 and run on the Move to show the
 * sampler fits the SPI callback's budget; never shipped.
 */
use piano_engine::{Engine, SAMPLED_VOICES};
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let pack = std::fs::read(args.get(1).expect("usage: bench <piano.nisp> [seconds]")).expect("read the pack");
    let seconds: f32 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(10.0);
    let mut e: Engine<Vec<u8>> = Engine::with_storage(44100.0);
    e.load_piano(pack).expect("a valid pack");
    let mut block = [0.0f32; 128];
    let blocks = (seconds * 44100.0 / 128.0) as usize;
    let (mut total, mut worst) = (0.0f64, 0.0f64);
    for b in 0..blocks {
        /* Keep every voice busy: a new chord each quarter second. */
        if b % 86 == 0 {
            let base = 36 + (b / 86 % 24) as u8;
            let list: Vec<String> = (0..SAMPLED_VOICES as u8).map(|i| format!("{}:{}", base + i * 2, 60 + i)).collect();
            e.set_notes(list.join(",").as_bytes());
        }
        let t = Instant::now();
        e.render_f32(&mut block);
        let dt = t.elapsed().as_secs_f64() * 1e6;
        total += dt;
        worst = worst.max(dt);
    }
    let budget = 128.0 / 44100.0 * 1e6;
    println!(
        "{} voices, {blocks} blocks: mean {:.1} us, worst {:.1} us per block of {:.0} us ({:.1}% mean)",
        e.active_voices(),
        total / blocks as f64,
        worst,
        budget,
        100.0 * total / blocks as f64 / budget
    );
}
