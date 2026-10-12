// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * The engine's output, pinned. Replays golden.txt at 44100 and compares every
 * sample, by bit pattern, with golden-44100.f32 (little-endian f32, mono).
 *
 * The same file is the reference for the wasm build, so this test is half of
 * the proof that the browser plays the Move's piano; tests/wasm_piano.test.mjs
 * is the other half.
 *
 * A deliberate change to the sound regenerates it:
 *     PIANO_ENGINE_BLESS=1 cargo test -p piano-engine --test golden
 */
use piano_engine::Engine;
use std::path::PathBuf;

const QUANTUM: usize = 128;

fn here(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join(name)
}

fn replay(script: &str) -> Vec<f32> {
    let mut e = Engine::new(44100.0);
    let mut out = Vec::new();
    for line in script.lines().map(str::trim) {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (op, arg) = line.split_once(' ').unwrap_or((line, ""));
        match op {
            "n" => e.set_notes(arg.as_bytes()),
            "g" => assert!(e.set_gain(arg.parse().expect("gain")), "gain {arg}"),
            "p" => e.panic(),
            "a" => e.release_all(),
            "r" => {
                let frames: usize = arg.parse().expect("frame count");
                assert_eq!(frames % QUANTUM, 0, "r takes whole quanta");
                let mut block = [0.0f32; QUANTUM];
                for _ in 0..frames / QUANTUM {
                    e.render_f32(&mut block);
                    out.extend_from_slice(&block);
                }
            }
            _ => panic!("unknown step: {line}"),
        }
    }
    out
}

#[test]
fn the_engine_matches_its_golden_render() {
    let script = std::fs::read_to_string(here("golden.txt")).expect("golden.txt");
    let got = replay(&script);
    let bytes: Vec<u8> = got.iter().flat_map(|s| s.to_le_bytes()).collect();
    let path = here("golden-44100.f32");

    if std::env::var_os("PIANO_ENGINE_BLESS").is_some() {
        std::fs::write(&path, &bytes).expect("write golden");
        return;
    }

    let want = std::fs::read(&path).expect("golden-44100.f32 (PIANO_ENGINE_BLESS=1 makes it)");
    assert_eq!(want.len(), bytes.len(), "golden length");
    let first_diff = want
        .as_chunks::<4>()
        .0
        .iter()
        .zip(got.iter())
        .position(|(w, g)| *w != g.to_le_bytes());
    assert_eq!(first_diff, None, "first differing sample");
    assert!(got.iter().any(|s| *s != 0.0), "the scenario makes sound");
}
